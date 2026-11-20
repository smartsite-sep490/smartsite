import { HttpException, Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { invalid, missing, uuid } from '../../common/configuration/commands.js';
import type { BackendEnvironment } from '../../config/environment.js';
import { AuthService } from '../auth/auth.service.js';
import { UserRole } from '../../database/entities/user.entity.js';
import { CameraConfigurationService } from './camera-configuration.service.js';
import {
  sourceCapabilitiesSchema,
  sourceDraftSchema,
  sourceHostsSchema,
  sourceProbeSchema,
} from './camera-source-contract.js';

export const CAMERA_SOURCE_FETCH = Symbol('CAMERA_SOURCE_FETCH');
const unavailable = (): never => {
  throw new PublicHttpException(503, {
    code: 'SERVICE_UNAVAILABLE',
    message: 'Camera source host is unavailable',
  });
};

async function boundedBody(response: Response, signal: AbortSignal): Promise<unknown> {
  if (
    !response.body ||
    response.headers.get('content-type')?.split(';')[0] !== 'application/json'
  ) {
    void response.body?.cancel().catch(() => {});
    unavailable();
  }
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > 400000)) {
    void response.body?.cancel().catch(() => {});
    unavailable();
  }
  const reader = response.body!.getReader(),
    chunks: Uint8Array[] = [];
  let total = 0;
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(new Error('Source operation cancelled'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    if (signal.aborted) unavailable();
    while (true) {
      const next = await Promise.race([reader.read(), aborted]);
      if (next.done) break;
      total += next.value.length;
      if (total > 400000) unavailable();
      chunks.push(next.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally {
    signal.removeEventListener('abort', onAbort);
    void reader.cancel().catch(() => {});
  }
}

@Injectable()
export class CameraSourceService {
  constructor(
    private readonly config: ConfigService<BackendEnvironment, true>,
    private readonly auth: AuthService,
    private readonly cameras: CameraConfigurationService,
    @Optional()
    @Inject(CAMERA_SOURCE_FETCH)
    private readonly fetcher: typeof fetch = globalThis.fetch,
  ) {}

  private async authorize(token: string, siteId: string, write: boolean) {
    const { user } = await this.auth.authenticate(token);
    if (
      user.mustChangePassword ||
      !user.roleAssignments.some(
        (r) =>
          (r.siteId?.toLowerCase() === siteId &&
            (r.role === UserRole.SITE_MANAGER || (!write && r.role === UserRole.SAFETY_OFFICER))) ||
          (!write && r.siteId === null && r.role === UserRole.ADMIN),
      )
    )
      throw new PublicHttpException(403, { code: 'FORBIDDEN', message: 'Forbidden' });
  }

  private hosts(siteId: string) {
    try {
      const configured = this.config.get('SMARTSITE_AI_SOURCE_HOSTS', { infer: true });
      const hosts = sourceHostsSchema.parse(configured ? JSON.parse(configured) : []);
      if (new Set(hosts.map((h) => h.id)).size !== hosts.length) unavailable();
      for (const host of hosts) {
        const url = new URL(host.origin);
        const local = ['127.0.0.1', '[::1]'].includes(url.hostname);
        if (
          url.username ||
          url.password ||
          url.pathname !== '/' ||
          url.search ||
          url.hash ||
          !(
            url.protocol === 'https:' ||
            (url.protocol === 'http:' &&
              local &&
              this.config.get('NODE_ENV', { infer: true }) !== 'production')
          )
        )
          unavailable();
      }
      return hosts.filter((h) => h.siteIds.some((id) => id.toLowerCase() === siteId));
    } catch {
      return unavailable();
    }
  }

  private async call(origin: string, path: string, body: unknown, signal: AbortSignal) {
    if (signal.aborted) unavailable();
    const token = this.config.get('SMARTSITE_AI_SERVICE_TOKEN', { infer: true });
    if (!token) unavailable();
    const response = await this.fetcher(new URL(path, origin), {
      method: body === undefined ? 'GET' : 'POST',
      redirect: 'error',
      signal,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      if ([400, 409, 504].includes(response.status))
        throw new PublicHttpException(response.status, {
          code:
            response.status === 400
              ? 'BAD_REQUEST'
              : response.status === 409
                ? 'CONFLICT'
                : 'SERVICE_UNAVAILABLE',
          message: 'Camera source could not be tested',
        });
      unavailable();
    }
    return boundedBody(response, signal);
  }

  async list(token: string, siteValue: string, cameraValue: string, signal?: AbortSignal) {
    const siteId = uuid(siteValue),
      cameraId = uuid(cameraValue);
    await this.authorize(token, siteId, false);
    const camera = await this.cameras.get(siteId, cameraId);
    if (camera.siteId !== siteId) missing();
    const hosts = await Promise.all(
      this.hosts(siteId).map(async (host) => {
        try {
          const budget = signal
            ? AbortSignal.any([signal, AbortSignal.timeout(5000)])
            : AbortSignal.timeout(5000);
          const parsed = sourceCapabilitiesSchema.parse(
            await this.call(
              host.origin,
              `/v1/source-control/${siteId}/${encodeURIComponent(camera.externalId)}/capabilities`,
              undefined,
              budget,
            ),
          );
          if (parsed.hostId !== host.id) unavailable();
          return { id: host.id, label: host.label, available: true as const, capabilities: parsed };
        } catch {
          return {
            id: host.id,
            label: host.label,
            available: false as const,
            reason: 'AGENT_UNAVAILABLE' as const,
          };
        }
      }),
    );
    await this.authorize(token, siteId, false);
    return { hosts };
  }

  async probe(
    token: string,
    siteValue: string,
    cameraValue: string,
    hostId: string,
    input: unknown,
    signal?: AbortSignal,
  ) {
    const siteId = uuid(siteValue),
      cameraId = uuid(cameraValue);
    await this.authorize(token, siteId, true);
    const camera = await this.cameras.get(siteId, cameraId);
    if (camera.siteId !== siteId) missing();
    const host = this.hosts(siteId).find((h) => h.id === hostId);
    if (!host) missing();
    const draft = sourceDraftSchema.safeParse(input);
    if (!draft.success) invalid('Invalid camera source');
    try {
      const budget = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000);
      const value = sourceProbeSchema.parse(
        await this.call(
          host.origin,
          `/v1/source-control/${siteId}/${encodeURIComponent(camera.externalId)}/probe`,
          draft.data,
          budget,
        ),
      );
      if (
        value.frame.width * value.frame.height > 8000000 ||
        (draft.data.kind === 'VIDEO' ? value.sourceKind !== 'REPLAY' : value.sourceKind !== 'LIVE')
      )
        unavailable();
      await this.authorize(token, siteId, true);
      return value;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      return unavailable();
    }
  }
}
