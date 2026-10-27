import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CreateReferenceRegionCommand,
  UpdateReferenceRegionPolygonCommand,
} from '@smartsite/contracts/camera-region-reference';
import type {
  ConfirmedRegionGeometryConfirmation,
  ReferenceRegionMutationResponse,
} from '@smartsite/contracts/camera-region-geometry-confirmation';
import { SmartSiteManagementClient, type BackendErrorCode } from '../src/index';

type FetchMock = (url: string, init: RequestInit) => Promise<Response>;

function createFetchMock(responseFactory: () => Response | Promise<Response>) {
  return vi.fn<FetchMock>(async () => responseFactory());
}

const siteId = '11111111-1111-4111-8111-111111111111';
const cameraId = 'b2222222-2222-4222-8222-22222222222b';
const otherCameraId = '88888888-8888-4888-8888-888888888888';
const regionId = 'c3333333-3333-4333-8333-33333333333c';
const otherRegionId = '77777777-7777-4777-8777-777777777777';
const zoneId = '22222222-3333-4444-8555-666666666662';
const otherZoneId = '66666666-6666-4666-8666-666666666666';
const referenceId = 'a1111111-2222-4333-8444-55555555555a';
const otherReferenceId = '55555555-5555-4555-8555-555555555555';
const confirmedByUserId = '44444444-5555-4666-8777-888888888884';

const validPolygon = {
  coordinates: [
    [0.1, 0.1],
    [0.9, 0.1],
    [0.5, 0.9],
  ] as const,
};

function createUpdateCommandFixture(
  overrides: Partial<UpdateReferenceRegionPolygonCommand> = {},
): UpdateReferenceRegionPolygonCommand {
  return {
    expectedConfigurationVersion: 3,
    referenceId,
    viewRevision: 2,
    confirmReferenceView: true,
    polygon: {
      coordinates: validPolygon.coordinates.map(([x, y]) => [x, y] as const),
    },
    ...overrides,
  };
}

function createCreateCommandFixture(
  overrides: Partial<CreateReferenceRegionCommand> = {},
): CreateReferenceRegionCommand {
  return {
    ...createUpdateCommandFixture(),
    zoneId,
    ...overrides,
  };
}

function createGeometryConfirmationFixture(
  overrides: Partial<ConfirmedRegionGeometryConfirmation> = {},
): ConfirmedRegionGeometryConfirmation {
  return {
    status: 'MANUALLY_CONFIRMED',
    referenceId,
    viewRevision: 2,
    confirmedByUserId,
    confirmedAt: '2026-10-26T14:30:00.000Z',
    ...overrides,
  };
}

function createReferenceRegionMutationResponseFixture(
  overrides: {
    region?: Record<string, unknown>;
    geometryConfirmation?: unknown;
    configurationVersion?: unknown;
  } = {},
): ReferenceRegionMutationResponse {
  const confirmation =
    'geometryConfirmation' in overrides
      ? overrides.geometryConfirmation
      : createGeometryConfirmationFixture();
  return {
    region: {
      id: regionId,
      cameraId,
      zoneId,
      polygon: {
        coordinates: [
          [0.1, 0.1],
          [0.9, 0.1],
          [0.5, 0.9],
        ],
      },
      coordinateSpace: 'NORMALIZED_0_1',
      version: 1,
      isActive: true,
      createdAt: '2026-10-26T12:00:00.000Z',
      geometryConfirmation: confirmation as ConfirmedRegionGeometryConfirmation,
      ...(overrides.region ?? {}),
    },
    configurationVersion: (overrides.configurationVersion ?? 4) as number,
  };
}

function createBackendErrorEnvelope(
  statusCode: number,
  code: BackendErrorCode,
  message: string,
  path: string,
) {
  return {
    success: false as const,
    statusCode,
    code,
    message,
    requestId: 'req-c03-test-1',
    timestamp: '2026-10-26T14:30:00.000Z',
    path,
  };
}

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('SmartSiteManagementClient reference-bound region commands', () => {
  it('posts createReferenceRegion to /sites/:siteId/cameras/:cameraId/reference-regions with encoded site path, valid UUID scope bindings, and confirmed provenance', async () => {
    const responseFixture = createReferenceRegionMutationResponseFixture();
    const fetchMock = createFetchMock(() => jsonResponse(responseFixture, 201));
    vi.stubGlobal('fetch', fetchMock);

    const client = new SmartSiteManagementClient('https://api.example.test/');
    const command = createCreateCommandFixture();
    const result = await client.createReferenceRegion(
      'manager-token',
      'site/1',
      cameraId.toUpperCase(),
      command,
    );

    expect(result).toEqual(responseFixture);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `https://api.example.test/api/v1/sites/site%2F1/cameras/${cameraId.toUpperCase()}/reference-regions`,
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: 'Bearer manager-token',
      },
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1].body))).toEqual(command);
  });

  it('patches updateReferencePolygon to /sites/:siteId/cameras/:cameraId/regions/:regionId/reference-polygon with encoded site path, valid UUID scope bindings, and confirmed provenance', async () => {
    const responseFixture = createReferenceRegionMutationResponseFixture();
    const fetchMock = createFetchMock(() => jsonResponse(responseFixture, 200));
    vi.stubGlobal('fetch', fetchMock);

    const client = new SmartSiteManagementClient('https://api.example.test');
    const command = createUpdateCommandFixture();
    const result = await client.updateReferencePolygon(
      'manager-token',
      'site/1',
      cameraId.toUpperCase(),
      regionId.toUpperCase(),
      command,
    );

    expect(result).toEqual(responseFixture);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `https://api.example.test/api/v1/sites/site%2F1/cameras/${cameraId.toUpperCase()}/regions/${regionId.toUpperCase()}/reference-polygon`,
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: 'PATCH',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: 'Bearer manager-token',
      },
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1].body))).toEqual(command);
  });

  it('propagates AbortSignal for pre-aborted and in-flight requests on both reference region methods', async () => {
    const fetchMock = vi.fn<FetchMock>();
    vi.stubGlobal('fetch', fetchMock);

    const client = new SmartSiteManagementClient('https://api.example.test');
    const preAborted = new AbortController();
    preAborted.abort();

    await expect(
      client.createReferenceRegion(
        'manager-token',
        siteId,
        cameraId,
        createCreateCommandFixture(),
        { signal: preAborted.signal },
      ),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(fetchMock).not.toHaveBeenCalled();

    const inFlight = new AbortController();
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          expect(init.signal).toBeInstanceOf(AbortSignal);
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
          inFlight.abort();
        }),
    );

    await expect(
      client.updateReferencePolygon(
        'manager-token',
        siteId,
        cameraId,
        regionId,
        createUpdateCommandFixture(),
        { signal: inFlight.signal },
      ),
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid command payloads before invoking fetch', async () => {
    const fetchMock = vi.fn<FetchMock>();
    vi.stubGlobal('fetch', fetchMock);
    const client = new SmartSiteManagementClient('https://api.example.test');

    await expect(
      client.createReferenceRegion('manager-token', siteId, cameraId, {
        ...createCreateCommandFixture(),
        confirmReferenceView: false as unknown as true,
      }),
    ).rejects.toThrow('Invalid reference-bound region command');

    await expect(
      client.createReferenceRegion('manager-token', siteId, cameraId, {
        ...createCreateCommandFixture(),
        referenceId: referenceId.toUpperCase(),
      }),
    ).rejects.toThrow('Invalid reference-bound region command');

    await expect(
      client.updateReferencePolygon('manager-token', siteId, cameraId, regionId, {
        ...createUpdateCommandFixture(),
        polygon: {
          coordinates: [
            [0.1, 0.1],
            [0.9, 0.9],
          ],
        },
      }),
    ).rejects.toThrow('Invalid reference-bound region command');

    await expect(
      client.updateReferencePolygon('manager-token', siteId, cameraId, regionId, {
        ...createUpdateCommandFixture(),
        zoneId,
      } as unknown as UpdateReferenceRegionPolygonCommand),
    ).rejects.toThrow('Invalid reference-bound region command');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves 401 unauthorized and 409 conflict (including MAX_SAFE_INTEGER version exhaustion) in a single attempt without automatic retry or legacy route fallback', async () => {
    const unauthorizedEnvelope = createBackendErrorEnvelope(
      401,
      'UNAUTHORIZED',
      'Authentication required',
      '/api/v1/sites/site%2F1/cameras/camera%2F1/reference-regions',
    );
    const conflictEnvelope = createBackendErrorEnvelope(
      409,
      'CONFLICT',
      'Configuration version exhausted',
      '/api/v1/sites/site%2F1/cameras/camera%2F1/regions/region%2F1/reference-polygon',
    );
    const fetchMock = vi
      .fn<FetchMock>()
      .mockResolvedValueOnce(jsonResponse(unauthorizedEnvelope, 401))
      .mockResolvedValueOnce(jsonResponse(conflictEnvelope, 409));
    vi.stubGlobal('fetch', fetchMock);
    const client = new SmartSiteManagementClient('https://api.example.test');

    await expect(
      client.createReferenceRegion(
        'expired-token',
        'site/1',
        'camera/1',
        createCreateCommandFixture(),
      ),
    ).rejects.toMatchObject({
      name: 'ApiError',
      code: 'http',
      status: 401,
      message: 'Authentication required',
      backendError: unauthorizedEnvelope,
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.example.test/api/v1/sites/site%2F1/cameras/camera%2F1/reference-regions',
    );

    await expect(
      client.updateReferencePolygon(
        'manager-token',
        'site/1',
        'camera/1',
        'region/1',
        createUpdateCommandFixture({ expectedConfigurationVersion: Number.MAX_SAFE_INTEGER }),
      ),
    ).rejects.toMatchObject({
      name: 'ApiError',
      code: 'http',
      status: 409,
      message: 'Configuration version exhausted',
      backendError: conflictEnvelope,
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://api.example.test/api/v1/sites/site%2F1/cameras/camera%2F1/regions/region%2F1/reference-polygon',
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects responses with missing/unconfirmed/mismatched provenance, non-(expected+1) configurationVersion, or mismatched UUID scope with ApiError(invalid-response)', async () => {
    const client = new SmartSiteManagementClient('https://api.example.test');
    const invalidCreatePayloads = [
      createReferenceRegionMutationResponseFixture({ geometryConfirmation: undefined }),
      createReferenceRegionMutationResponseFixture({
        geometryConfirmation: {
          status: 'UNCONFIRMED',
          referenceId: null,
          viewRevision: null,
          confirmedByUserId: null,
          confirmedAt: null,
        },
      }),
      createReferenceRegionMutationResponseFixture({
        geometryConfirmation: createGeometryConfirmationFixture({ status: 'NEEDS_REVALIDATION' }),
      }),
      createReferenceRegionMutationResponseFixture({
        geometryConfirmation: createGeometryConfirmationFixture({ referenceId: otherReferenceId }),
      }),
      createReferenceRegionMutationResponseFixture({
        geometryConfirmation: createGeometryConfirmationFixture({ viewRevision: 9 }),
      }),
      createReferenceRegionMutationResponseFixture({ configurationVersion: 3 }),
      createReferenceRegionMutationResponseFixture({ configurationVersion: 5 }),
      createReferenceRegionMutationResponseFixture({ region: { id: 'region-1' } }),
      createReferenceRegionMutationResponseFixture({ region: { cameraId: otherCameraId } }),
      createReferenceRegionMutationResponseFixture({ region: { zoneId: otherZoneId } }),
    ];

    for (const payload of invalidCreatePayloads) {
      const fetchMock = createFetchMock(() => jsonResponse(payload, 201));
      vi.stubGlobal('fetch', fetchMock);
      await expect(
        client.createReferenceRegion(
          'manager-token',
          siteId,
          cameraId,
          createCreateCommandFixture(),
        ),
      ).rejects.toMatchObject({
        name: 'ApiError',
        code: 'invalid-response',
        message: 'Backend returned an invalid reference region mutation response.',
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }

    const fetchMock = vi
      .fn<FetchMock>()
      .mockResolvedValueOnce(
        jsonResponse(
          createReferenceRegionMutationResponseFixture({ region: { id: otherRegionId } }),
          200,
        ),
      )
      .mockResolvedValueOnce(jsonResponse(createReferenceRegionMutationResponseFixture(), 200));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      client.updateReferencePolygon(
        'manager-token',
        siteId,
        cameraId,
        regionId,
        createUpdateCommandFixture(),
      ),
    ).rejects.toMatchObject({ code: 'invalid-response' });

    await expect(
      client.updateReferencePolygon(
        'manager-token',
        siteId,
        'camera/1',
        'region/1',
        createUpdateCommandFixture(),
      ),
    ).rejects.toMatchObject({ code: 'invalid-response' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
