import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { SmartSiteManagementClient } from './management';
import { ApiError } from './index';
import type {
  AccessSetupResponse,
  GrantContractorZoneCommand,
  GrantWorkerZoneCommand,
} from '@smartsite/contracts';

const BASE_URL = 'http://localhost:3000';

function createMockAccessSetupResponse(): AccessSetupResponse {
  return {
    canReviewAssignments: true,
    canGrantContractorZones: true,
    canGrantWorkerZones: true,
    participations: [
      {
        id: 'part-01',
        contractorId: 'cont-01',
        name: 'Delta Construction',
        validFrom: '2026-10-01T00:00:00Z',
        validUntil: null,
      },
    ],
    workers: [
      {
        id: 'worker-01',
        name: 'Nguyen Van A',
        contractorId: 'cont-01',
      },
    ],
    zones: [
      {
        id: 'zone-01',
        name: 'Excavation Sector Alpha',
      },
    ],
    assignments: [
      {
        id: 'assign-01',
        workerId: 'worker-01',
        workerName: 'Nguyen Van A',
        siteContractorId: 'part-01',
        status: 'ACTIVE',
        validFrom: '2026-10-01T00:00:00Z',
        validUntil: null,
        version: 1,
        reviewNote: null,
      },
    ],
    contractorPermissions: [
      {
        id: 'czp-01',
        siteContractorId: 'part-01',
        zoneId: 'zone-01',
        validFrom: '2026-10-01T00:00:00Z',
        validUntil: '2026-12-31T23:59:59Z',
        revokedAt: null,
      },
    ],
    workerPermissions: [
      {
        id: 'wzp-01',
        workerAssignmentId: 'assign-01',
        contractorZonePermissionId: 'czp-01',
        validFrom: '2026-10-01T00:00:00Z',
        validUntil: '2026-12-31T23:59:59Z',
        revokedAt: null,
      },
    ],
  };
}

function mockJsonResponse(status: number, data: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'Content-Type': 'application/json' }),
    text: async () => JSON.stringify(data),
    json: async () => data,
  } as unknown as Response;
}

function mockErrorEnvelope(status: number, code: string, message: string, path: string): Response {
  const envelope = {
    success: false,
    statusCode: status,
    code,
    message,
    requestId: 'req-access-err-01',
    timestamp: '2026-10-11T18:00:00.000Z',
    path,
  };
  return mockJsonResponse(status, envelope);
}

describe('SmartSiteManagementClient - Access Setup & Zone Permissions Transport', () => {
  let client: SmartSiteManagementClient;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    client = new SmartSiteManagementClient(BASE_URL);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('1. accessSetup (GET /sites/:siteId/access-setup)', () => {
    it('sends GET with Bearer token, URI-encoded siteId, and returns AccessSetupResponse without query secrets', async () => {
      const mockData = createMockAccessSetupResponse();
      const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(200, mockData));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const rawSiteId = 'site/alpha special#1';
      const token = 'secret-token-access-99';

      const result = await client.accessSetup(token, rawSiteId);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

      expect(url).toBe(`${BASE_URL}/api/v1/sites/${encodeURIComponent(rawSiteId)}/access-setup`);
      expect(url).not.toContain(token);
      expect(url).not.toContain('secret');
      expect(url).not.toContain('?');

      expect(init.method).toBe('GET');
      expect(init.headers).toEqual(
        expect.objectContaining({
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        }),
      );
      expect(init.body).toBeUndefined();
      expect(result).toEqual(mockData);
    });

    it('rejects immediately without calling fetch when signal is pre-aborted', async () => {
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const controller = new AbortController();
      controller.abort();

      await expect(
        client.accessSetup('token', 'site-1', { signal: controller.signal }),
      ).rejects.toThrowError(expect.objectContaining({ code: 'cancelled' }));
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('cancels an in-flight request when signal aborts', async () => {
      const controller = new AbortController();
      const fetchSpy = vi.fn().mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_, reject) => {
            init.signal?.addEventListener('abort', () => {
              reject(new DOMException('The operation was aborted.', 'AbortError'));
            });
          }),
      );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const promise = client.accessSetup('token', 'site-1', {
        signal: controller.signal,
      });
      controller.abort();

      await expect(promise).rejects.toThrowError(expect.objectContaining({ code: 'cancelled' }));
    });
  });

  describe('2. grantContractorZone (POST /sites/:siteId/access-setup/contractor-zone-permissions)', () => {
    it('sends POST to access-setup subpath with Bearer token, exact command body, and returns { id }', async () => {
      const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(201, { id: 'czp-created-01' }));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const token = 'contractor-grant-token';
      const siteId = 'site/sub:02';
      const command: GrantContractorZoneCommand = {
        requestId: 'req-czp-1000000000001',
        siteContractorId: 'part-01',
        zoneId: 'zone-01',
        validFrom: '2026-10-11T08:00:00.000000Z',
        validUntil: '2026-12-31T17:00:00.000000Z',
      };

      const result = await client.grantContractorZone(token, siteId, command);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

      expect(url).toBe(
        `${BASE_URL}/api/v1/sites/${encodeURIComponent(siteId)}/access-setup/contractor-zone-permissions`,
      );
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual(
        expect.objectContaining({
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }),
      );

      const parsedBody = JSON.parse(init.body as string);
      expect(parsedBody).toEqual({
        requestId: 'req-czp-1000000000001',
        siteContractorId: 'part-01',
        zoneId: 'zone-01',
        validFrom: '2026-10-11T08:00:00.000000Z',
        validUntil: '2026-12-31T17:00:00.000000Z',
      });
      // Enforce clean payload: no injected client actor or backend internal command wrapper
      expect(parsedBody).not.toHaveProperty('actor');
      expect(parsedBody).not.toHaveProperty('command');

      expect(result).toEqual({ id: 'czp-created-01' });
    });

    it('rejects without calling fetch when signal is pre-aborted', async () => {
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const controller = new AbortController();
      controller.abort();

      const command: GrantContractorZoneCommand = {
        requestId: 'req-czp-aborted',
        siteContractorId: 'part-01',
        zoneId: 'zone-01',
        validFrom: '2026-10-11T08:00:00Z',
        validUntil: '2026-12-31T17:00:00Z',
      };

      await expect(
        client.grantContractorZone('token', 'site-1', command, {
          signal: controller.signal,
        }),
      ).rejects.toThrowError(expect.objectContaining({ code: 'cancelled' }));
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('3. grantWorkerZone (POST /sites/:siteId/access-setup/worker-zone-permissions)', () => {
    it('sends POST to access-setup subpath with Bearer token, exact command body, and returns { id }', async () => {
      const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(201, { id: 'wzp-created-02' }));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const token = 'worker-grant-token';
      const siteId = 'site-03';
      const command: GrantWorkerZoneCommand = {
        requestId: 'req-wzp-2000000000002',
        workerAssignmentId: 'assign-01',
        contractorZonePermissionId: 'czp-01',
        validFrom: '2026-10-11T08:00:00.000000Z',
        validUntil: '2026-10-11T17:00:00.000000Z',
      };

      const result = await client.grantWorkerZone(token, siteId, command);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

      expect(url).toBe(
        `${BASE_URL}/api/v1/sites/${encodeURIComponent(siteId)}/access-setup/worker-zone-permissions`,
      );
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual(
        expect.objectContaining({
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }),
      );

      const parsedBody = JSON.parse(init.body as string);
      expect(parsedBody).toEqual({
        requestId: 'req-wzp-2000000000002',
        workerAssignmentId: 'assign-01',
        contractorZonePermissionId: 'czp-01',
        validFrom: '2026-10-11T08:00:00.000000Z',
        validUntil: '2026-10-11T17:00:00.000000Z',
      });
      expect(parsedBody).not.toHaveProperty('actor');
      expect(parsedBody).not.toHaveProperty('command');

      expect(result).toEqual({ id: 'wzp-created-02' });
    });
  });

  describe('4. revokeZonePermission (POST /sites/:siteId/access-setup/{contractor|worker}-zone-permissions/:id/revoke)', () => {
    it('revokes contractor permission via POST /sites/:siteId/access-setup/contractor-zone-permissions/:id/revoke', async () => {
      const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(200, { id: 'czp-revoked-01' }));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const token = 'revoke-token';
      const siteId = 'site/heavy#4';
      const permissionId = 'czp/target:01';

      const result = await client.revokeZonePermission(token, siteId, permissionId, 'contractor');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

      expect(url).toBe(
        `${BASE_URL}/api/v1/sites/${encodeURIComponent(siteId)}/access-setup/contractor-zone-permissions/${encodeURIComponent(permissionId)}/revoke`,
      );
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual(
        expect.objectContaining({
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        }),
      );
      expect(init.body).toBeUndefined();
      expect(result).toEqual({ id: 'czp-revoked-01' });
    });

    it('revokes worker permission via POST /sites/:siteId/access-setup/worker-zone-permissions/:id/revoke', async () => {
      const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(200, { id: 'wzp-revoked-02' }));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const token = 'revoke-worker-token';
      const siteId = 'site-safe-05';
      const permissionId = 'wzp-target-02';

      const result = await client.revokeZonePermission(token, siteId, permissionId, 'worker');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

      expect(url).toBe(
        `${BASE_URL}/api/v1/sites/${encodeURIComponent(siteId)}/access-setup/worker-zone-permissions/${encodeURIComponent(permissionId)}/revoke`,
      );
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual(
        expect.objectContaining({
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        }),
      );
      expect(init.body).toBeUndefined();
      expect(result).toEqual({ id: 'wzp-revoked-02' });
    });

    it('rejects without calling fetch when revoke signal is pre-aborted', async () => {
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const controller = new AbortController();
      controller.abort();

      await expect(
        client.revokeZonePermission('token', 'site-1', 'perm-1', 'worker', {
          signal: controller.signal,
        }),
      ).rejects.toThrowError(expect.objectContaining({ code: 'cancelled' }));
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('5. Error Handling & Mutation Safety Boundary', () => {
    it('propagates HTTP 401 Unauthorized as ApiError with status and envelope', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(
          mockErrorEnvelope(
            401,
            'UNAUTHORIZED',
            'Authentication token is expired or invalid.',
            '/api/v1/sites/site-1/access-setup',
          ),
        );

      try {
        await client.accessSetup('expired-token', 'site-1');
        expect.unreachable('Should have thrown 401 ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('http');
        expect(apiErr.status).toBe(401);
        expect(apiErr.message).toBe('Authentication token is expired or invalid.');
        expect(apiErr.backendError?.code).toBe('UNAUTHORIZED');
      }
    });

    it('propagates HTTP 403 Forbidden as ApiError when user lacks permission scope', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(
          mockErrorEnvelope(
            403,
            'FORBIDDEN',
            'Forbidden from granting zone permissions for this site.',
            '/api/v1/sites/site-1/access-setup/contractor-zone-permissions',
          ),
        );

      const command: GrantContractorZoneCommand = {
        requestId: 'req-czp-forbidden',
        siteContractorId: 'part-01',
        zoneId: 'zone-01',
        validFrom: '2026-10-11T08:00:00Z',
        validUntil: '2026-12-31T17:00:00Z',
      };

      try {
        await client.grantContractorZone('token', 'site-1', command);
        expect.unreachable('Should have thrown 403 ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('http');
        expect(apiErr.status).toBe(403);
        expect(apiErr.message).toBe('Forbidden from granting zone permissions for this site.');
        expect(apiErr.backendError?.code).toBe('FORBIDDEN');
      }
    });

    it('propagates HTTP 409 Conflict as ApiError on duplicate requestId or overlapping validity', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(
          mockErrorEnvelope(
            409,
            'CONFLICT',
            'Active zone permission already covers this period or duplicate requestId.',
            '/api/v1/sites/site-1/access-setup/worker-zone-permissions',
          ),
        );

      const command: GrantWorkerZoneCommand = {
        requestId: 'req-wzp-conflict',
        workerAssignmentId: 'assign-01',
        contractorZonePermissionId: 'czp-01',
        validFrom: '2026-10-11T08:00:00Z',
        validUntil: '2026-10-11T17:00:00Z',
      };

      try {
        await client.grantWorkerZone('token', 'site-1', command);
        expect.unreachable('Should have thrown 409 ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('http');
        expect(apiErr.status).toBe(409);
        expect(apiErr.message).toBe(
          'Active zone permission already covers this period or duplicate requestId.',
        );
        expect(apiErr.backendError?.code).toBe('CONFLICT');
      }
    });

    it('does not retry mutations on network connection errors to prevent duplicate writes', async () => {
      const fetchSpy = vi
        .fn()
        .mockRejectedValue(new TypeError('Failed to fetch (network disconnected)'));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const command: GrantContractorZoneCommand = {
        requestId: 'req-czp-no-retry-net',
        siteContractorId: 'part-01',
        zoneId: 'zone-01',
        validFrom: '2026-10-11T08:00:00Z',
        validUntil: '2026-12-31T17:00:00Z',
      };

      await expect(client.grantContractorZone('token', 'site-1', command)).rejects.toThrowError(
        expect.objectContaining({ code: 'network' }),
      );

      // Mutation writes must NOT be automatically retried by the client on network disconnect
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('does not retry mutations on HTTP 500 server errors to prevent duplicate writes', async () => {
      const fetchSpy = vi
        .fn()
        .mockResolvedValue(
          mockErrorEnvelope(
            500,
            'INTERNAL_SERVER_ERROR',
            'Database transaction error occurred on backend.',
            '/api/v1/sites/site-1/access-setup/contractor-zone-permissions',
          ),
        );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const command: GrantContractorZoneCommand = {
        requestId: 'req-czp-no-retry-500',
        siteContractorId: 'part-01',
        zoneId: 'zone-01',
        validFrom: '2026-10-11T08:00:00Z',
        validUntil: '2026-12-31T17:00:00Z',
      };

      try {
        await client.grantContractorZone('token', 'site-1', command);
        expect.unreachable('Should have thrown 500 ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('http');
        expect(apiErr.status).toBe(500);
        expect(apiErr.message).toBe('Database transaction error occurred on backend.');
      }

      // Essential safety invariant: Mutation writes must NOT be automatically retried on HTTP 500
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('does not retry revoke mutation on HTTP 500 server errors', async () => {
      const fetchSpy = vi
        .fn()
        .mockResolvedValue(
          mockErrorEnvelope(
            500,
            'INTERNAL_SERVER_ERROR',
            'Internal server error while revoking zone permission.',
            '/api/v1/sites/site-1/access-setup/contractor-zone-permissions/czp-01/revoke',
          ),
        );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      try {
        await client.revokeZonePermission('token', 'site-1', 'czp-01', 'contractor');
        expect.unreachable('Should have thrown 500 ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('http');
        expect(apiErr.status).toBe(500);
      }

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });
});
