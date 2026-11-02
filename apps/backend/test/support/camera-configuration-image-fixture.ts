import { createHash } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import type { CameraConfigurationImageResponse } from '@smartsite/contracts/camera-configuration-image';

export const siteId = '11111111-1111-4111-8111-111111111111';
export const cameraId = '22222222-2222-4222-8222-222222222222';
export const otherId = '99999999-9999-4999-8999-999999999999';
export const baseNowMs = Date.parse('2026-10-15T08:00:01.000Z');

// Marker-only synthetic JPEG (120x80) from canonical contract tests.
export const jpeg = Buffer.from([
  255, 216, 255, 192, 0, 17, 8, 0, 80, 0, 120, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0, 255, 217,
]);
export const jpegSha256 = createHash('sha256').update(jpeg).digest('hex');
export const jpegDataUrl = `data:image/jpeg;base64,${jpeg.toString('base64')}`;

interface RoleAssignmentFixture {
  role: string;
  siteId: string | null;
}

export function buildSourcePayload(options?: {
  sourceKind?: 'LIVE' | 'REPLAY';
  capturedAt?: string;
  frame?: Record<string, unknown>;
  extra?: Record<string, unknown>;
}) {
  return {
    schemaVersion: 1,
    purpose: 'REGION_CONFIGURATION',
    sourceKind: options?.sourceKind ?? 'LIVE',
    frame: {
      cameraExternalId: 'camera-a',
      sessionId: '33333333-3333-4333-8333-333333333333',
      sequenceNumber: '7',
      capturedAt: options?.capturedAt ?? new Date(baseNowMs - 500).toISOString(),
      width: 120,
      height: 80,
      imageDataUrl: jpegDataUrl,
      imageSha256: jpegSha256,
      ...options?.frame,
    },
    ...options?.extra,
  };
}

export async function fixture() {
  const { CameraConfigurationImageService } = (await import(
    new URL('../../src/modules/cameras/camera-configuration-image.service.js', import.meta.url).href
  )) as {
    CameraConfigurationImageService: new (
      config: unknown,
      auth: unknown,
      cameras: unknown,
      fetcher: (url: string, options: RequestInit) => Promise<Response>,
      clock: () => number,
    ) => {
      read(
        token: string,
        siteId: string,
        cameraId: string,
        signal?: AbortSignal,
      ): Promise<CameraConfigurationImageResponse>;
      onModuleDestroy(): void;
    };
  };

  const state = {
    now: baseNowMs,
    authCalls: 0,
    cameraReads: 0,
    upstreamCalls: 0,
    revoked: false,
    userActive: true,
    mustChangePassword: false,
    roleAssignments: [{ role: 'ADMIN', siteId: null }] as RoleAssignmentFixture[],
    inactive: false,
    cameraSite: siteId,
    cameraEntityId: cameraId,
    cameraExternalId: 'camera-a',
    configurationVersion: 4,
    origin: 'http://127.0.0.1:8001',
    unmappedSource: false,
  };

  let fetcher: (url: string, options: RequestInit) => Promise<Response> = async () =>
    Response.json(buildSourcePayload({ capturedAt: new Date(state.now - 500).toISOString() }));
  let onAuthorize: (call: number) => void | Promise<void> = () => {};
  let onCameraRead: (read: number) => void | Promise<void> = () => {};

  const auth = {
    async authenticate() {
      state.authCalls++;
      await onAuthorize(state.authCalls);
      if (state.revoked) throw new UnauthorizedException();
      return {
        user: {
          id: '44444444-4444-4444-8444-444444444444',
          isActive: state.userActive,
          mustChangePassword: state.mustChangePassword,
          roleAssignments: state.roleAssignments,
        },
      };
    },
  };

  const cameras = {
    async get() {
      await onCameraRead(++state.cameraReads);
      return {
        id: state.cameraEntityId,
        siteId: state.cameraSite,
        externalId: state.cameraExternalId,
        status: state.inactive ? 'INACTIVE' : 'ACTIVE',
        configurationVersion: state.configurationVersion,
      };
    },
  };

  const config = {
    get(key: string) {
      if (key === 'SMARTSITE_AI_PREVIEW_SOURCES') {
        return state.unmappedSource ? {} : { 'camera-a': state.origin };
      }
      return 'fake-service-token';
    },
  };

  const clock = Object.assign(() => state.now, { now: () => state.now });

  const service = new CameraConfigurationImageService(
    config,
    auth,
    cameras,
    (url: string, options: RequestInit) => {
      state.upstreamCalls++;
      return fetcher(url, options);
    },
    clock,
  );

  return {
    state,
    service,
    setFetch(next: typeof fetcher) {
      fetcher = next;
    },
    onAuthorize(next: typeof onAuthorize) {
      onAuthorize = next;
    },
    onCameraRead(next: typeof onCameraRead) {
      onCameraRead = next;
    },
  };
}

export const status =
  (
    code: number,
    forbidden: string[] = ['fake-service-token', 'private-sentinel', 'secret-canary'],
  ) =>
  (error: unknown) => {
    if (
      typeof error !== 'object' ||
      error === null ||
      typeof (error as { getStatus?: () => number }).getStatus !== 'function' ||
      (error as { getStatus(): number }).getStatus() !== code
    ) {
      return false;
    }
    const serialized = JSON.stringify({
      message: (error as Error).message,
      response: (error as { getResponse?: () => unknown }).getResponse?.(),
    });
    return forbidden.every((sentinel) => !serialized.includes(sentinel));
  };
