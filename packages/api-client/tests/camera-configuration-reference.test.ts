import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, SmartSiteManagementClient, type RequestOptions } from '../src/index';

const siteId = '11111111-1111-4111-8111-111111111111';
const otherSiteId = '99999999-9999-4999-8999-999999999999';
const cameraId = '22222222-2222-4222-8222-222222222222';
const otherCameraId = '88888888-8888-4888-8888-888888888888';
const sessionId = '33333333-3333-4333-8333-333333333333';
const otherSessionId = '77777777-7777-4777-8777-777777777777';
const referenceId = '44444444-4444-4444-8444-444444444444';

// Marker-only synthetic JPEG (120x80) matching contract tests.
const syntheticJpeg = Buffer.from([
  255, 216, 255, 192, 0, 17, 8, 0, 80, 0, 120, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0, 255, 217,
]);

function createConfigurationImageFixture(overrides: Record<string, unknown> = {}) {
  const baseFrame = {
    cameraExternalId: 'gate-01',
    sessionId,
    sequenceNumber: '9223372036854775807',
    capturedAt: '2026-10-26T05:00:00.000Z',
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
    referenceExpiresAt: '2026-10-26T05:05:00.000Z',
    ...overrides,
    frame: { ...baseFrame, ...frameOverrides },
  };
}

function createConfigurationReferenceMetadataFixture(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: '1.0.0' as const,
    purpose: 'REGION_CONFIGURATION' as const,
    sourceKind: 'LIVE' as 'LIVE' | 'REPLAY',
    referenceId,
    siteId,
    cameraId,
    sessionId,
    imageSha256: 'a'.repeat(64),
    width: 120,
    height: 80,
    capturedAt: '2026-10-26T05:00:00.000Z',
    issuedAt: '2026-10-26T05:00:01.000Z',
    expiresAt: '2026-10-26T05:05:00.000Z',
    configurationVersion: 4,
    viewRevision: 2,
    ...overrides,
  };
}

function createConfigurationReferenceResponseFixture(
  overrides: {
    image?: Record<string, unknown>;
    reference?: Record<string, unknown>;
    viewValidity?: unknown;
    extra?: Record<string, unknown>;
  } = {},
) {
  return {
    image: createConfigurationImageFixture(overrides.image),
    reference: createConfigurationReferenceMetadataFixture(overrides.reference),
    viewValidity: (overrides.viewValidity ?? 'UNCONFIRMED') as 'UNCONFIRMED',
    ...(overrides.extra ?? {}),
  };
}

type ConfigurationReferenceResponseFixture = ReturnType<
  typeof createConfigurationReferenceResponseFixture
>;
type ClientWithConfigurationReference = SmartSiteManagementClient & {
  getCameraConfigurationReference?: (
    token: string,
    siteId: string,
    cameraId: string,
    options?: RequestOptions,
  ) => Promise<ConfigurationReferenceResponseFixture>;
};

function getCameraConfigurationReference(
  client: SmartSiteManagementClient,
  token: string,
  requestedSiteId: string,
  requestedCameraId: string,
  options?: RequestOptions,
): Promise<ConfigurationReferenceResponseFixture> {
  const candidate = (client as ClientWithConfigurationReference).getCameraConfigurationReference;
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

describe('SmartSiteManagementClient.getCameraConfigurationReference', () => {
  it('calls GET /sites/:siteId/cameras/:cameraId/configuration-reference with no-store, error redirect, case-insensitive scope/instant coherence, cancellation, and byte bounds', async () => {
    const fixture = createConfigurationReferenceResponseFixture({
      image: {
        siteId: siteId.toLowerCase(),
        cameraId: cameraId.toLowerCase(),
        referenceExpiresAt: '2026-10-26T05:05:00.000Z',
        frame: {
          sessionId: sessionId.toUpperCase(),
          capturedAt: '2026-10-26T05:00:00.000Z',
        },
      },
      reference: {
        siteId: siteId.toUpperCase(),
        cameraId: cameraId.toUpperCase(),
        sessionId: sessionId.toLowerCase(),
        capturedAt: '2026-10-26T12:00:00+07:00',
        issuedAt: '2026-10-26T12:00:01+07:00',
        expiresAt: '2026-10-26T12:05:00+07:00',
      },
    });
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(fixture));
    vi.stubGlobal('fetch', fetchMock);

    const client = new SmartSiteManagementClient('https://api.example.test/');
    const upperSite = siteId.toUpperCase();
    const upperCamera = cameraId.toUpperCase();
    const result = await getCameraConfigurationReference(
      client,
      'config-token',
      upperSite,
      upperCamera,
    );

    expect(result).toEqual(fixture);
    result.image.frame.width = 999;
    result.reference.width = 999;
    expect(fixture.image.frame.width).toBe(120);
    expect(fixture.reference.width).toBe(120);

    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(
      `https://api.example.test/api/v1/sites/${encodeURIComponent(upperSite)}/cameras/${encodeURIComponent(upperCamera)}/configuration-reference`,
    );
    expect(calledInit).toMatchObject({
      method: 'GET',
      cache: 'no-store',
      redirect: 'error',
      headers: expect.objectContaining({
        Accept: 'application/json',
        Authorization: 'Bearer config-token',
      }),
    });

    const preAborted = new AbortController();
    preAborted.abort();
    await expect(
      getCameraConfigurationReference(client, 'config-token', siteId, cameraId, {
        signal: preAborted.signal,
      }),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const cancelSpy = vi.fn();
    const jsonSpy = vi.fn(() => {
      throw new Error('response.json() must not run on oversized configuration-reference payload');
    });
    const oversizedResponse = new Response(
      new ReadableStream<Uint8Array>({ cancel: cancelSpy }, { highWaterMark: 0 }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Content-Length': '2000000' },
      },
    );
    oversizedResponse.json = jsonSpy as typeof oversizedResponse.json;
    fetchMock.mockResolvedValueOnce(oversizedResponse);
    await expect(
      getCameraConfigurationReference(client, 'config-token', siteId, cameraId),
    ).rejects.toMatchObject({ code: 'invalid-response' });
    expect(jsonSpy).not.toHaveBeenCalled();
    expect(cancelSpy).toHaveBeenCalled();
  });

  it.each([
    ['unknown-outer-key', createConfigurationReferenceResponseFixture({ extra: { extra: true } })],
    [
      'invalid-viewValidity',
      createConfigurationReferenceResponseFixture({ viewValidity: 'CONFIRMED' }),
    ],
    [
      'foreign-site-scope',
      createConfigurationReferenceResponseFixture({
        image: { siteId: otherSiteId },
        reference: { siteId: otherSiteId },
      }),
    ],
    [
      'foreign-camera-scope',
      createConfigurationReferenceResponseFixture({
        image: { cameraId: otherCameraId },
        reference: { cameraId: otherCameraId },
      }),
    ],
    [
      'mismatched-reference-siteId',
      createConfigurationReferenceResponseFixture({ reference: { siteId: otherSiteId } }),
    ],
    [
      'mismatched-reference-cameraId',
      createConfigurationReferenceResponseFixture({ reference: { cameraId: otherCameraId } }),
    ],
    [
      'mismatched-sessionId',
      createConfigurationReferenceResponseFixture({ reference: { sessionId: otherSessionId } }),
    ],
    [
      'mismatched-sourceKind',
      createConfigurationReferenceResponseFixture({ reference: { sourceKind: 'REPLAY' } }),
    ],
    [
      'mismatched-imageSha256',
      createConfigurationReferenceResponseFixture({ reference: { imageSha256: 'b'.repeat(64) } }),
    ],
    [
      'mismatched-width',
      createConfigurationReferenceResponseFixture({ reference: { width: 128 } }),
    ],
    [
      'mismatched-height',
      createConfigurationReferenceResponseFixture({ reference: { height: 96 } }),
    ],
    [
      'mismatched-configurationVersion',
      createConfigurationReferenceResponseFixture({ reference: { configurationVersion: 5 } }),
    ],
    [
      'mismatched-capturedAt',
      createConfigurationReferenceResponseFixture({
        reference: { capturedAt: '2026-10-26T05:00:00.500Z' },
      }),
    ],
    [
      'mismatched-expiresAt',
      createConfigurationReferenceResponseFixture({
        reference: { expiresAt: '2026-10-26T05:04:59.000Z' },
      }),
    ],
  ])(
    'maps invalid or incoherent payload (%s) to ApiError invalid-response',
    async (_label, payload) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(payload)));
      const client = new SmartSiteManagementClient('https://api.example.test');
      const promise = getCameraConfigurationReference(client, 'config-token', siteId, cameraId);
      await expect(promise).rejects.toBeInstanceOf(ApiError);
      await expect(promise).rejects.toMatchObject({ code: 'invalid-response' });
    },
  );
});
