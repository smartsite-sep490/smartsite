import { getEventListeners } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  SmartSiteManagementClient,
  registerSessionCredential,
  unregisterSessionCredential,
  type RequestOptions,
} from '../src/index';

const siteId = '11111111-1111-4111-8111-111111111111';
const otherSiteId = '99999999-9999-4999-8999-999999999999';
const cameraId = '22222222-2222-4222-8222-222222222222';
const otherCameraId = '88888888-8888-4888-8888-888888888888';

// Canonical marker-only synthetic JPEG (120x80) from contract tests.
const syntheticJpeg = Buffer.from([
  255, 216, 255, 192, 0, 17, 8, 0, 80, 0, 120, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0, 255, 217,
]);

function createConfigurationImageResponse(overrides: Record<string, unknown> = {}) {
  const baseFrame = {
    cameraExternalId: 'gate-01',
    sessionId: '33333333-3333-4333-8333-333333333333',
    sequenceNumber: '9223372036854775807',
    capturedAt: '2026-10-15T08:00:00.000Z',
    width: 120,
    height: 80,
    imageDataUrl: `data:image/jpeg;base64,${syntheticJpeg.toString('base64')}`,
    imageSha256: 'a'.repeat(64),
  };
  const frameOverrides = (overrides.frame as Record<string, unknown> | undefined) ?? {};
  return {
    schemaVersion: 1 as const,
    purpose: 'REGION_CONFIGURATION' as const,
    sourceKind: 'LIVE' as 'LIVE' | 'REPLAY',
    siteId,
    cameraId,
    configurationVersion: 4,
    referenceExpiresAt: '2026-10-15T08:05:00.000Z',
    ...overrides,
    frame: { ...baseFrame, ...frameOverrides },
  };
}

type ConfigurationImageResponseFixture = ReturnType<typeof createConfigurationImageResponse>;
type ClientWithConfigurationImage = SmartSiteManagementClient & {
  getCameraConfigurationImage?: (
    token: string,
    siteId: string,
    cameraId: string,
    options?: RequestOptions,
  ) => Promise<ConfigurationImageResponseFixture>;
};

function getCameraConfigurationImage(
  client: SmartSiteManagementClient,
  token: string,
  requestedSiteId: string,
  requestedCameraId: string,
  options?: RequestOptions,
): Promise<ConfigurationImageResponseFixture> {
  const candidate = (client as ClientWithConfigurationImage).getCameraConfigurationImage;
  expect(typeof candidate).toBe('function');
  return candidate!.call(client, token, requestedSiteId, requestedCameraId, options);
}

const jsonResponse = (payload: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('SmartSiteManagementClient.getCameraConfigurationImage', () => {
  it('calls GET /sites/:siteId/cameras/:cameraId/configuration-image with encoded path segments, no query string, no-store, and error redirect', async () => {
    const fixture = createConfigurationImageResponse();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(fixture))
      .mockResolvedValueOnce(jsonResponse({ code: 'NOT_FOUND', message: 'Camera not found' }, 404));
    vi.stubGlobal('fetch', fetchMock);

    const client = new SmartSiteManagementClient('https://api.example.test/');
    const upperSiteId = siteId.toUpperCase();
    const upperCameraId = cameraId.toUpperCase();
    const result = await getCameraConfigurationImage(
      client,
      'config-token',
      upperSiteId,
      upperCameraId,
    );

    expect(result).toEqual(fixture);
    result.frame.width = 999;
    expect(fixture.frame.width).toBe(120);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(
      `https://api.example.test/api/v1/sites/${encodeURIComponent(upperSiteId)}/cameras/${encodeURIComponent(upperCameraId)}/configuration-image`,
    );
    expect(calledUrl).not.toContain('?');
    expect(calledInit).toMatchObject({
      method: 'GET',
      cache: 'no-store',
      redirect: 'error',
      headers: expect.objectContaining({
        Accept: 'application/json',
        Authorization: 'Bearer config-token',
      }),
    });

    await expect(
      getCameraConfigurationImage(client, 'config-token', 'site/a b', 'camera/c#d'),
    ).rejects.toMatchObject({ code: 'http', status: 404 });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://api.example.test/api/v1/sites/site%2Fa%20b/cameras/camera%2Fc%23d/configuration-image',
    );
  });

  it('preserves sourceKind REPLAY without spoofing LIVE', async () => {
    const replayFixture = createConfigurationImageResponse({ sourceKind: 'REPLAY' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(replayFixture)));

    const client = new SmartSiteManagementClient('https://api.example.test');
    const result = await getCameraConfigurationImage(client, 'config-token', siteId, cameraId);

    expect(result.sourceKind).toBe('REPLAY');
    expect(result).toEqual(replayFixture);
  });

  it('rejects mismatched scope, malformed JPEG/dimensions/hash/purpose/expiry, and leaked source URLs as invalid-response', async () => {
    const privateSourceUrl = 'rtsp://camera-secret.internal/live-stream';
    const invalidPayloads: unknown[] = [
      createConfigurationImageResponse({ siteId: otherSiteId }),
      createConfigurationImageResponse({ cameraId: otherCameraId }),
      createConfigurationImageResponse({ purpose: 'AI_EVIDENCE' }),
      createConfigurationImageResponse({ schemaVersion: 2 }),
      createConfigurationImageResponse({ sourceKind: 'UNKNOWN' }),
      createConfigurationImageResponse({ configurationVersion: 0 }),
      { ...createConfigurationImageResponse(), sourceUrl: privateSourceUrl },
      createConfigurationImageResponse({ frame: { sourceUrl: privateSourceUrl } }),
      { ...createConfigurationImageResponse(), detections: [] },
      createConfigurationImageResponse({
        frame: { imageDataUrl: 'data:image/png;base64,/9j/2Q==' },
      }),
      createConfigurationImageResponse({
        frame: { imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==' },
      }),
      createConfigurationImageResponse({ frame: { width: 121 } }),
      createConfigurationImageResponse({ frame: { width: 63 } }),
      createConfigurationImageResponse({ frame: { height: 1281 } }),
      createConfigurationImageResponse({ frame: { imageSha256: 'A'.repeat(64) } }),
      createConfigurationImageResponse({ frame: { imageSha256: 'bad-sha256' } }),
      createConfigurationImageResponse({ referenceExpiresAt: '2026-10-15T08:00:00.000Z' }),
      createConfigurationImageResponse({ referenceExpiresAt: '2026-10-15T07:59:59.000Z' }),
      createConfigurationImageResponse({ referenceExpiresAt: '2026-10-15T08:05:00.001Z' }),
    ];

    const fetchMock = vi.fn();
    for (const payload of invalidPayloads) fetchMock.mockResolvedValueOnce(jsonResponse(payload));
    vi.stubGlobal('fetch', fetchMock);

    const client = new SmartSiteManagementClient('https://api.example.test');
    for (let index = 0; index < invalidPayloads.length; index++) {
      let caughtError: unknown;
      try {
        await getCameraConfigurationImage(client, 'config-token', siteId, cameraId);
      } catch (error) {
        caughtError = error;
      }
      expect(caughtError).toBeInstanceOf(ApiError);
      expect(caughtError).toMatchObject({ code: 'invalid-response' });
      expect((caughtError as Error).message).not.toContain(privateSourceUrl);
    }
    expect(fetchMock).toHaveBeenCalledTimes(invalidPayloads.length);
  });

  it('uses the 3s default transport budget and honors valid or invalid timeoutMs', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal('fetch', fetchMock);

    const client = new SmartSiteManagementClient('https://api.example.test');
    let defaultSettled = false;
    const defaultPending = getCameraConfigurationImage(client, 'config-token', siteId, cameraId);
    const defaultAssertion = expect(defaultPending).rejects.toMatchObject({ code: 'timeout' });
    void defaultPending.then(
      () => (defaultSettled = true),
      () => (defaultSettled = true),
    );

    await vi.advanceTimersByTimeAsync(2999);
    expect(defaultSettled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    await defaultAssertion;

    const customPending = getCameraConfigurationImage(client, 'config-token', siteId, cameraId, {
      timeoutMs: 1200,
    });
    const customAssertion = expect(customPending).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(1201);
    await customAssertion;

    vi.useRealTimers();
    fetchMock.mockClear();

    const invalidTimeouts = [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      2_147_483_648,
    ];
    for (const timeoutMs of invalidTimeouts) {
      await expect(
        getCameraConfigurationImage(client, 'config-token', siteId, cameraId, { timeoutMs }),
      ).rejects.toThrow(RangeError);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('enforces the 1.5MB response size bound before response.json() allocation for oversized content-length and chunked streams', async () => {
    const client = new SmartSiteManagementClient('https://api.example.test');

    for (const badContentLength of ['1572865', '2000000', 'invalid']) {
      const pullSpy = vi.fn();
      const cancelSpy = vi.fn();
      const jsonSpy = vi.fn(() => {
        throw new Error('response.json() must not be called for oversized content-length');
      });
      const response = new Response(
        new ReadableStream<Uint8Array>({ pull: pullSpy, cancel: cancelSpy }, { highWaterMark: 0 }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Content-Length': badContentLength },
        },
      );
      response.json = jsonSpy as typeof response.json;
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

      await expect(
        getCameraConfigurationImage(client, 'config-token', siteId, cameraId),
      ).rejects.toMatchObject({ code: 'invalid-response' });
      expect(jsonSpy).not.toHaveBeenCalled();
      expect(pullSpy).not.toHaveBeenCalled();
      expect(cancelSpy).toHaveBeenCalled();
    }

    for (const lyingHeader of [undefined, '128']) {
      let pullCount = 0;
      const cancelSpy = vi.fn();
      const jsonSpy = vi.fn(() => {
        throw new Error('response.json() must not be called for oversized chunked stream');
      });
      const chunks = [
        new Uint8Array(1_000_000).fill(0x20),
        new Uint8Array(600_000).fill(0x20),
        new Uint8Array(100_000).fill(0x20),
      ];
      const stream = new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            const next = chunks[pullCount++];
            if (next) controller.enqueue(next);
            else controller.close();
          },
          cancel: cancelSpy,
        },
        { highWaterMark: 0 },
      );
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (lyingHeader !== undefined) headers['Content-Length'] = lyingHeader;
      const response = new Response(stream, { status: 200, headers });
      response.json = jsonSpy as typeof response.json;
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

      await expect(
        getCameraConfigurationImage(client, 'config-token', siteId, cameraId),
      ).rejects.toMatchObject({ code: 'invalid-response' });
      expect(pullCount).toBe(2);
      expect(jsonSpy).not.toHaveBeenCalled();
      expect(cancelSpy).toHaveBeenCalled();
    }
  });

  it('honors caller AbortSignal before fetch, during stalled fetch, and during a held response body', async () => {
    const client = new SmartSiteManagementClient('https://api.example.test');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const preAborted = new AbortController();
    preAborted.abort();
    await expect(
      getCameraConfigurationImage(client, 'config-token', siteId, cameraId, {
        signal: preAborted.signal,
      }),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockImplementationOnce(() => new Promise<Response>(() => undefined));
    const duringFetch = new AbortController();
    const stalledFetchPromise = getCameraConfigurationImage(
      client,
      'config-token',
      siteId,
      cameraId,
      {
        signal: duringFetch.signal,
      },
    );
    duringFetch.abort();
    await expect(stalledFetchPromise).rejects.toMatchObject({ code: 'cancelled' });
    expect(getEventListeners(duringFetch.signal, 'abort')).toEqual([]);

    let markHeldBodyStarted: () => void = () => undefined;
    const heldBodyStarted = new Promise<void>((resolve) => (markHeldBodyStarted = resolve));
    let chunkIndex = 0;
    fetchMock.mockImplementationOnce(async () => {
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (chunkIndex++ === 0) {
            controller.enqueue(new TextEncoder().encode('{"schemaVersion":1,'));
            return;
          }
          markHeldBodyStarted();
          return new Promise<void>(() => undefined);
        },
      });
      const response = new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
      response.json = (() => {
        markHeldBodyStarted();
        return new Promise(() => undefined);
      }) as typeof response.json;
      return response;
    });

    const duringBody = new AbortController();
    const heldBodyPromise = getCameraConfigurationImage(client, 'config-token', siteId, cameraId, {
      signal: duringBody.signal,
    });
    const started = await Promise.race([
      heldBodyStarted.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 250)),
    ]);
    expect(started).toBe(true);

    duringBody.abort();
    const outcome = await Promise.race([
      heldBodyPromise.then(
        () => 'resolved',
        (error: unknown) => error,
      ),
      new Promise((resolve) => setTimeout(() => resolve('hung'), 250)),
    ]);
    expect(outcome).toMatchObject({ code: 'cancelled' });
    expect(getEventListeners(duringBody.signal, 'abort')).toEqual([]);
  });

  it('dispatches session expiry for the active credential on 401, ignores late 401 from superseded credentials, and preserves 403/404/409/429/503 HTTP errors', async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { dispatchEvent });
    vi.stubGlobal(
      'CustomEvent',
      class {
        detail: { sessionScopes?: readonly string[] };
        constructor(
          public type: string,
          init?: { detail?: { sessionScopes?: readonly string[] } },
        ) {
          this.detail = init?.detail ?? {};
        }
      },
    );

    const client = new SmartSiteManagementClient('https://api.example.test');
    registerSessionCredential('active-token', 'scope-active');
    try {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse({ code: 'UNAUTHORIZED', message: 'Expired' }, 401)),
      );
      await expect(
        getCameraConfigurationImage(client, 'active-token', siteId, cameraId),
      ).rejects.toMatchObject({
        code: 'http',
        status: 401,
      });
      expect(dispatchEvent).toHaveBeenCalledTimes(1);
      expect(dispatchEvent.mock.calls[0]?.[0]).toMatchObject({
        type: 'smartsite:session-expired',
        detail: { sessionScopes: ['scope-active'] },
      });
    } finally {
      unregisterSessionCredential('active-token', 'scope-active');
    }

    dispatchEvent.mockClear();
    let resolveLate401: ((response: Response) => void) | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((resolve) => (resolveLate401 = resolve))),
    );

    registerSessionCredential('stale-token', 'scope-old');
    try {
      const lateRequest = getCameraConfigurationImage(client, 'stale-token', siteId, cameraId);
      unregisterSessionCredential('stale-token', 'scope-old');
      registerSessionCredential('fresh-token', 'scope-new');
      registerSessionCredential('stale-token', 'scope-reused-later');

      resolveLate401?.(jsonResponse({ code: 'UNAUTHORIZED', message: 'Late 401' }, 401));
      await expect(lateRequest).rejects.toMatchObject({ code: 'http', status: 401 });
      const revokedScopes = dispatchEvent.mock.calls.flatMap(
        (call) =>
          (call[0] as { detail?: { sessionScopes?: readonly string[] } }).detail?.sessionScopes ??
          [],
      );
      expect(revokedScopes).not.toContain('scope-new');
      expect(revokedScopes).not.toContain('scope-reused-later');
    } finally {
      unregisterSessionCredential('stale-token', 'scope-old');
      unregisterSessionCredential('stale-token', 'scope-reused-later');
      unregisterSessionCredential('fresh-token', 'scope-new');
    }

    dispatchEvent.mockClear();
    for (const status of [403, 404, 409, 429, 503] as const) {
      const extraHeaders: Record<string, string> =
        status === 429 || status === 503 ? { 'Retry-After': '12' } : {};
      const codes = {
        403: 'FORBIDDEN',
        404: 'NOT_FOUND',
        409: 'CONFLICT',
        429: 'RATE_LIMIT_EXCEEDED',
        503: 'SERVICE_UNAVAILABLE',
      };
      const errBody = {
        success: false,
        statusCode: status,
        code: codes[status],
        message: `Backend returned ${status}`,
        requestId: 'config-image-test',
        timestamp: '2026-10-15T08:00:00.000Z',
        path: `/api/v1/sites/${siteId}/cameras/${cameraId}/configuration-image`,
      };
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse(errBody, status, extraHeaders)),
      );
      await expect(
        getCameraConfigurationImage(client, 'config-token', siteId, cameraId),
      ).rejects.toMatchObject({
        code: 'http',
        status,
        message: `Backend returned ${status}`,
        ...(status === 429 || status === 503 ? { retryAfterSeconds: 12 } : {}),
      });
    }
    expect(dispatchEvent).not.toHaveBeenCalled();
  });
});
