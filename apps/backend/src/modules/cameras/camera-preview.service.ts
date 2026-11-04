import { createHash } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Optional, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseCameraPreviewResponse, type CameraPreviewResponse } from '@smartsite/contracts';
import { parseCameraMediaFrame, type CameraMediaFrame } from '@smartsite/contracts/camera-preview';
import type { BackendEnvironment } from '../../config/environment.js';
import { conflict, missing, uuid } from '../../common/configuration/commands.js';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { CameraStatus } from '../../database/entities/enums.js';
import { AuthService } from '../auth/auth.service.js';
import { assertSafetySiteAccess } from '../safety/alerts/safety-alert-access.guard.js';
import { CameraConfigurationService } from './camera-configuration.service.js';

export const CAMERA_PREVIEW_FETCH = Symbol('CAMERA_PREVIEW_FETCH');
const unavailable = (): never => {
  throw new PublicHttpException(HttpStatus.SERVICE_UNAVAILABLE, {
    code: 'SERVICE_UNAVAILABLE',
    message: 'Camera preview is unavailable',
  });
};

async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  const rejectBody = (): never => {
    void response.body?.cancel().catch(() => {});
    return unavailable();
  };
  if (
    !response.ok ||
    response.headers.get('content-type')?.split(';', 1)[0]?.trim() !== 'application/json' ||
    !response.body
  )
    rejectBody();
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > 2_000_000)) rejectBody();
  const body = response.body;
  if (!body) return unavailable();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new Error('Preview request cancelled'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    if (signal.aborted) throw new Error('Preview request cancelled');
    while (true) {
      const result = await Promise.race([reader.read(), aborted]);
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > 2_000_000) unavailable();
      chunks.push(result.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally {
    signal.removeEventListener('abort', onAbort);
    void reader.cancel().catch(() => {});
  }
}

@Injectable()
export class CameraPreviewService implements OnModuleDestroy {
  private readonly mediaViewers = new Map<string, number>();
  private readonly activeMediaControllers = new Set<AbortController>();
  private shuttingDown = false;
  constructor(
    private readonly config: ConfigService<BackendEnvironment, true>,
    private readonly auth: AuthService,
    private readonly cameras: CameraConfigurationService,
    @Optional()
    @Inject(CAMERA_PREVIEW_FETCH)
    private readonly fetcher: typeof fetch = globalThis.fetch,
  ) {}

  onModuleDestroy(): void {
    this.shuttingDown = true;
    for (const controller of this.activeMediaControllers) controller.abort();
  }

  private async authorize(token: string, siteId: string) {
    if (this.shuttingDown) unavailable();
    const { user } = await this.auth.authenticate(token);
    if (this.shuttingDown) unavailable();
    assertSafetySiteAccess(user, siteId, 'GET');
  }

  private async camera(siteId: string, cameraId: string) {
    const camera = await this.cameras.get(siteId, cameraId);
    if (camera.siteId.toLowerCase() !== siteId || camera.id.toLowerCase() !== cameraId) missing();
    if (camera.status !== CameraStatus.ACTIVE) unavailable();
    return camera;
  }

  async *video(
    token: string,
    requestedSite: string,
    requestedCamera: string,
    signal?: AbortSignal,
  ): AsyncGenerator<CameraMediaFrame> {
    const siteId = uuid(requestedSite).toLowerCase();
    const cameraId = uuid(requestedCamera).toLowerCase();
    await this.authorize(token, siteId);
    const camera = await this.camera(siteId, cameraId);
    const sources = this.config.get('SMARTSITE_AI_PREVIEW_SOURCES', { infer: true });
    if (!Object.hasOwn(sources, camera.externalId)) unavailable();
    if (this.shuttingDown) unavailable();
    const origin = sources[camera.externalId]!;
    const count = this.mediaViewers.get(cameraId) ?? 0;
    if (count >= 2 || [...this.mediaViewers.values()].reduce((a, b) => a + b, 0) >= 4) {
      throw new PublicHttpException(HttpStatus.TOO_MANY_REQUESTS, {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Camera stream viewer limit reached',
      });
    }
    this.mediaViewers.set(cameraId, count + 1);
    const controller = new AbortController();
    this.activeMediaControllers.add(controller);
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const deadline = setTimeout(abort, 600_000);
    let idle = setTimeout(abort, 2000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let abortRead: (() => void) | undefined;
    try {
      const url = new URL('/v1/realtime/video-stream', origin);
      url.searchParams.set('cameraExternalId', camera.externalId);
      let response: Response;
      try {
        response = await this.fetcher(url.href, {
          headers: {
            Authorization: `Bearer ${this.config.get('SMARTSITE_AI_SERVICE_TOKEN', { infer: true })}`,
            Accept: 'application/x-ndjson',
          },
          redirect: 'error',
          cache: 'no-store',
          signal: controller.signal,
        });
      } catch {
        return unavailable();
      }
      clearTimeout(idle);
      if (
        !response.ok ||
        !response.body ||
        response.headers.get('content-type')?.split(';', 1)[0]?.trim() !== 'application/x-ndjson'
      ) {
        void response.body?.cancel().catch(() => {});
        unavailable();
      }
      reader = response.body!.getReader();
      const aborted = new Promise<never>((_resolve, reject) => {
        abortRead = () => reject(new Error('Camera stream cancelled'));
        controller.signal.addEventListener('abort', abortRead, { once: true });
      });
      let pending = Buffer.alloc(0);
      let lastSession = '';
      let lastSequence = -1n;
      const decoder = new TextDecoder('utf-8', { fatal: true });
      while (!controller.signal.aborted) {
        idle = setTimeout(abort, 2000);
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await Promise.race([reader.read(), aborted]);
        } catch {
          return unavailable();
        } finally {
          clearTimeout(idle);
        }
        if (chunk.done) {
          if (pending.length !== 0) unavailable();
          return;
        }
        if (chunk.value.byteLength > 1_048_576) unavailable();
        pending = Buffer.concat([pending, chunk.value]);
        let end = pending.indexOf(10);
        while (end !== -1) {
          if (end === 0 || end > 262_144) unavailable();
          let frame: CameraMediaFrame;
          try {
            frame = parseCameraMediaFrame(JSON.parse(decoder.decode(pending.subarray(0, end))));
          } catch {
            return unavailable();
          }
          pending = pending.subarray(end + 1);
          if (frame.cameraExternalId !== camera.externalId) unavailable();
          const sequence = BigInt(frame.sequenceNumber);
          if (frame.sessionId === lastSession && sequence <= lastSequence) unavailable();
          await this.authorize(token, siteId);
          const current = await this.camera(siteId, cameraId);
          // Preserve the camera recheck after auth, then refuse revocation during its I/O.
          await this.authorize(token, siteId);
          const currentSources = this.config.get('SMARTSITE_AI_PREVIEW_SOURCES', { infer: true });
          const age = Date.now() - Date.parse(frame.capturedAt);
          if (
            current.externalId !== camera.externalId ||
            !Object.hasOwn(currentSources, current.externalId) ||
            currentSources[current.externalId] !== origin ||
            age >= 2000 ||
            age < -1000 ||
            controller.signal.aborted
          )
            unavailable();
          lastSession = frame.sessionId;
          lastSequence = sequence;
          yield frame;
          end = pending.indexOf(10);
        }
        if (pending.length > 262_144) unavailable();
      }
    } finally {
      clearTimeout(idle);
      clearTimeout(deadline);
      if (abortRead) controller.signal.removeEventListener('abort', abortRead);
      controller.abort();
      this.activeMediaControllers.delete(controller);
      signal?.removeEventListener('abort', abort);
      void reader?.cancel().catch(() => {});
      const remaining = (this.mediaViewers.get(cameraId) ?? 1) - 1;
      if (remaining > 0) this.mediaViewers.set(cameraId, remaining);
      else this.mediaViewers.delete(cameraId);
    }
  }

  async recordedVideo(
    token: string,
    requestedSite: string,
    requestedCamera: string,
    signal?: AbortSignal,
  ): Promise<{ bytes: Buffer; externalId: string; sha256: string }> {
    const siteId = uuid(requestedSite).toLowerCase(),
      cameraId = uuid(requestedCamera).toLowerCase();
    await this.authorize(token, siteId);
    const camera = await this.camera(siteId, cameraId);
    const sources = this.config.get('SMARTSITE_AI_PREVIEW_SOURCES', { infer: true });
    if (!Object.hasOwn(sources, camera.externalId)) unavailable();
    const origin = sources[camera.externalId]!;
    const url = new URL('/v1/realtime/recorded-video', origin);
    url.searchParams.set('cameraExternalId', camera.externalId);
    const budget = AbortSignal.any([AbortSignal.timeout(5000), ...(signal ? [signal] : [])]);
    let bytes: Buffer, sha256: string;
    try {
      const response = await this.fetcher(url.href, {
        headers: {
          Authorization: `Bearer ${this.config.get('SMARTSITE_AI_SERVICE_TOKEN', { infer: true })}`,
          Accept: 'video/mp4',
        },
        redirect: 'error',
        cache: 'no-store',
        signal: budget,
      });
      if (
        !response.ok ||
        response.headers.get('content-type')?.split(';', 1)[0]?.trim() !== 'video/mp4' ||
        response.headers.get('x-camera-external-id') !== camera.externalId ||
        !response.body
      ) {
        void response.body?.cancel().catch(() => {});
        unavailable();
      }
      const expectedSha = response.headers.get('x-source-sha256');
      if (!expectedSha || !/^[a-f0-9]{64}$/.test(expectedSha)) {
        void response.body!.cancel().catch(() => {});
        unavailable();
      }
      const reader = response.body!.getReader(),
        chunks: Uint8Array[] = [];
      let size = 0;
      let onAbort = () => {};
      const abort = new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error('Recorded request cancelled'));
        budget.addEventListener('abort', onAbort, { once: true });
      });
      try {
        if (budget.aborted) unavailable();
        while (true) {
          const row = await Promise.race([reader.read(), abort]);
          if (row.done) break;
          size += row.value.byteLength;
          if (size > 2_000_000) unavailable();
          chunks.push(row.value);
        }
      } finally {
        budget.removeEventListener('abort', onAbort);
        void reader.cancel().catch(() => {});
      }
      bytes = Buffer.concat(chunks);
      if (bytes.length < 12 || bytes.subarray(4, 8).toString('ascii') !== 'ftyp' || budget.aborted)
        unavailable();
      sha256 = createHash('sha256').update(bytes).digest('hex');
      if (sha256 !== expectedSha) unavailable();
    } catch {
      return unavailable();
    }
    await this.authorize(token, siteId);
    const current = await this.camera(siteId, cameraId);
    await this.authorize(token, siteId);
    if (
      current.externalId !== camera.externalId ||
      this.config.get('SMARTSITE_AI_PREVIEW_SOURCES', { infer: true })[camera.externalId] !==
        origin ||
      budget.aborted
    )
      unavailable();
    return { bytes, externalId: camera.externalId, sha256 };
  }

  async read(
    token: string,
    requestedSite: string,
    requestedCamera: string,
    signal?: AbortSignal,
  ): Promise<CameraPreviewResponse> {
    const siteId = uuid(requestedSite).toLowerCase();
    const cameraId = uuid(requestedCamera).toLowerCase();
    await this.authorize(token, siteId);
    const camera = await this.camera(siteId, cameraId);
    const sources = this.config.get('SMARTSITE_AI_PREVIEW_SOURCES', { infer: true });
    if (!Object.hasOwn(sources, camera.externalId)) unavailable();
    const origin = sources[camera.externalId]!;
    const url = new URL('/v1/realtime/preview/latest', origin);
    url.searchParams.set('cameraExternalId', camera.externalId);
    let result: CameraPreviewResponse;
    try {
      const budget = AbortSignal.any([AbortSignal.timeout(2000), ...(signal ? [signal] : [])]);
      const response = await this.fetcher(url.href, {
        headers: {
          Authorization: `Bearer ${this.config.get('SMARTSITE_AI_SERVICE_TOKEN', { infer: true })}`,
          Accept: 'application/json',
        },
        redirect: 'error',
        cache: 'no-store',
        signal: budget,
      });
      const payload = await boundedJson(response, budget);
      if (
        !payload ||
        typeof payload !== 'object' ||
        Array.isArray(payload) ||
        Object.keys(payload).some((key) => !['sourceKind', 'frame'].includes(key))
      )
        unavailable();
      result = parseCameraPreviewResponse({
        ...(payload as object),
        siteId,
        cameraId,
        cameraExternalId: camera.externalId,
      });
      const age = Date.now() - Date.parse(result.frame.capturedAt);
      if (age > 5000 || age < -30_000) unavailable();
      if (budget.aborted) unavailable();
    } catch {
      return unavailable();
    }
    await this.authorize(token, siteId);
    const current = await this.camera(siteId, cameraId);
    await this.authorize(token, siteId);
    const currentSources = this.config.get('SMARTSITE_AI_PREVIEW_SOURCES', { infer: true });
    if (
      current.externalId !== camera.externalId ||
      !Object.hasOwn(currentSources, current.externalId) ||
      currentSources[current.externalId] !== origin ||
      signal?.aborted
    )
      unavailable();
    const finalAge = Date.now() - Date.parse(result.frame.capturedAt);
    if (finalAge > 5000 || finalAge < -30_000) unavailable();
    return result;
  }

  async observationZones(
    token: string,
    requestedSite: string,
    requestedCamera: string,
    offset: number,
    limit: number,
  ) {
    const siteId = uuid(requestedSite).toLowerCase();
    const cameraId = uuid(requestedCamera).toLowerCase();
    await this.authorize(token, siteId);
    try {
      const result = await this.cameras.observationZones(siteId, cameraId, offset, limit);
      const current = await this.cameras.get(siteId, cameraId);
      if (current.configurationVersion !== result.configurationVersion)
        conflict('Camera configuration changed; refresh observation context');
      return result;
    } finally {
      // Revocation wins even when the projection/revision lookup itself failed.
      await this.authorize(token, siteId);
    }
  }

  async list(token: string, requestedSite: string, offset: number, limit: number) {
    const siteId = uuid(requestedSite).toLowerCase();
    await this.authorize(token, siteId);
    const page = await this.cameras.list(siteId, offset, limit);
    await this.authorize(token, siteId);
    return {
      ...page,
      items: page.items.map((c) => ({
        id: c.id,
        siteId: c.siteId,
        externalId: c.externalId,
        code: c.code,
        name: c.name,
        status: c.status,
        configurationVersion: c.configurationVersion,
        createdAt: c.createdAt,
      })),
    };
  }
}
