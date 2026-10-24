import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { SmartSiteManagementClient } from './management';
import { ApiError } from './index';
import type {
  ContractorParticipationResponse,
  WorkerSiteZoneAssignmentResponse,
} from '@smartsite/contracts';

const BASE_URL = 'http://localhost:3000';

function createMockAssignmentResponse(
  overrides?: Partial<WorkerSiteZoneAssignmentResponse>,
): WorkerSiteZoneAssignmentResponse {
  return {
    id: 'req-assign-01',
    workerId: 'worker-01',
    siteId: 'site-01',
    zoneIds: ['zone-01', 'zone-02'],
    status: 'PENDING',
    validFrom: '2026-10-01T08:00:00.000Z',
    validUntil: '2026-12-31T17:00:00.000Z',
    requestedByUserId: 'user-contractor-01',
    safetyReviewedByUserId: null,
    siteManagerDecidedByUserId: null,
    createdAt: '2026-10-01T08:00:00.000Z',
    siteContractorId: 'part-01',
    version: 1,
    reviewedAt: null,
    reviewNote: null,
    ...overrides,
  };
}

function createMockParticipationResponse(
  overrides?: Partial<ContractorParticipationResponse>,
): ContractorParticipationResponse {
  return {
    id: 'part-01',
    contractorId: 'cont-01',
    siteId: 'site-01',
    validFrom: '2026-10-01T08:00:00.000Z',
    validUntil: null,
    isActive: true,
    createdAt: '2026-10-01T08:00:00.000Z',
    ...overrides,
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
    requestId: 'req-assign-err-01',
    timestamp: '2026-10-11T19:00:00.000Z',
    path,
  };
  return mockJsonResponse(status, envelope);
}

describe('SmartSiteManagementClient - Worker Assignment Lifecycle Transport & Boundaries', () => {
  let client: SmartSiteManagementClient;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    client = new SmartSiteManagementClient(BASE_URL);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('1. createContractorParticipation (POST /contractors/:contractorId/participations)', () => {
    it('sends POST with Bearer token, URI-encoded contractorId, JSON body, and forwards RequestOptions', async () => {
      const mockData = createMockParticipationResponse();
      const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(201, mockData));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const rawContractorId = 'cont/alpha#1';
      const token = 'token-contractor-01';
      const input = {
        siteId: 'site-01',
        validFrom: '2026-10-01T08:00:00.000Z',
        validUntil: null,
      };

      const result = await client.createContractorParticipation(token, rawContractorId, input);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

      expect(url).toBe(
        `${BASE_URL}/api/v1/contractors/${encodeURIComponent(rawContractorId)}/participations`,
      );
      expect(url).not.toContain(token);
      expect(url).not.toContain('?');

      expect(init.method).toBe('POST');
      expect(init.headers).toEqual(
        expect.objectContaining({
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }),
      );

      const parsedBody = JSON.parse(init.body as string);
      expect(parsedBody).toEqual(input);
      expect(parsedBody).not.toHaveProperty('actor');
      expect(parsedBody).not.toHaveProperty('command');

      expect(result).toEqual(mockData);
    });

    it('rejects without calling fetch when signal is pre-aborted', async () => {
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const controller = new AbortController();
      controller.abort();

      await expect(
        client.createContractorParticipation(
          'token',
          'cont-1',
          { siteId: 'site-1', validFrom: '2026-10-01T00:00:00Z', validUntil: null },
          { signal: controller.signal },
        ),
      ).rejects.toThrowError(expect.objectContaining({ code: 'cancelled' }));

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('2. createWorkerSiteZoneAssignment (POST /workers/:workerId/site-zone-assignment-requests)', () => {
    it('sends POST with existing input unchanged without client siteContractorId addition and forwards RequestOptions', async () => {
      const mockData = createMockAssignmentResponse({
        siteContractorId: 'part-01',
        version: 1,
      });
      const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(201, mockData));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const rawWorkerId = 'worker/sub:01';
      const token = 'token-worker-req-01';
      const input = {
        siteId: 'site-01',
        zoneIds: ['zone-01', 'zone-02'],
        validFrom: '2026-10-01T08:00:00.000Z',
        validUntil: '2026-12-31T17:00:00.000Z',
      };

      const result = await client.createWorkerSiteZoneAssignment(token, rawWorkerId, input);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

      expect(url).toBe(
        `${BASE_URL}/api/v1/workers/${encodeURIComponent(rawWorkerId)}/site-zone-assignment-requests`,
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
        siteId: 'site-01',
        zoneIds: ['zone-01', 'zone-02'],
        validFrom: '2026-10-01T08:00:00.000Z',
        validUntil: '2026-12-31T17:00:00.000Z',
      });
      // Safety rule: client must not invent or inject siteContractorId
      expect(parsedBody).not.toHaveProperty('siteContractorId');
      expect(parsedBody).not.toHaveProperty('actor');

      // Preserves restored optional fields from backend contract
      expect(result.siteContractorId).toBe('part-01');
      expect(result.version).toBe(1);
      expect(result.status).toBe('PENDING');
    });

    it('rejects immediately without calling fetch when signal is pre-aborted', async () => {
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const controller = new AbortController();
      controller.abort();

      await expect(
        client.createWorkerSiteZoneAssignment(
          'token',
          'worker-1',
          {
            siteId: 'site-1',
            zoneIds: ['z1'],
            validFrom: '2026-10-01T00:00:00Z',
            validUntil: null,
          },
          { signal: controller.signal },
        ),
      ).rejects.toThrowError(expect.objectContaining({ code: 'cancelled' }));

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('aborts in-flight createWorkerSiteZoneAssignment when signal aborts', async () => {
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

      const promise = client.createWorkerSiteZoneAssignment(
        'token',
        'worker-1',
        { siteId: 'site-1', zoneIds: ['z1'], validFrom: '2026-10-01T00:00:00Z', validUntil: null },
        { signal: controller.signal },
      );
      controller.abort();

      await expect(promise).rejects.toThrowError(expect.objectContaining({ code: 'cancelled' }));
    });
  });

  describe('3. safetyReviewWorkerSiteZoneAssignment (POST /site-zone-assignment-requests/:id/safety-review)', () => {
    it('sends POST without body and returns updated WorkerSiteZoneAssignmentResponse with version and reviewedAt', async () => {
      const mockData = createMockAssignmentResponse({
        status: 'SAFETY_REVIEWED',
        safetyReviewedByUserId: 'user-safety-01',
        reviewedAt: '2026-10-01T09:30:00.000Z',
        version: 2,
      });
      const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(200, mockData));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const rawRequestId = 'req/assign#special-01';
      const token = 'token-safety-review';

      const result = await client.safetyReviewWorkerSiteZoneAssignment(token, rawRequestId);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

      expect(url).toBe(
        `${BASE_URL}/api/v1/site-zone-assignment-requests/${encodeURIComponent(rawRequestId)}/safety-review`,
      );
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual(
        expect.objectContaining({
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        }),
      );
      expect(init.body).toBeUndefined();

      expect(result.status).toBe('SAFETY_REVIEWED');
      expect(result.safetyReviewedByUserId).toBe('user-safety-01');
      expect(result.reviewedAt).toBe('2026-10-01T09:30:00.000Z');
      expect(result.version).toBe(2);
    });

    it('rejects without calling fetch when signal is pre-aborted', async () => {
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const controller = new AbortController();
      controller.abort();

      await expect(
        client.safetyReviewWorkerSiteZoneAssignment('token', 'req-1', {
          signal: controller.signal,
        }),
      ).rejects.toThrowError(expect.objectContaining({ code: 'cancelled' }));

      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('4. decideWorkerSiteZoneAssignment (POST /site-zone-assignment-requests/:id/site-manager-decision)', () => {
    it('maintains backwards compatibility when called with boolean approve only', async () => {
      const mockData = createMockAssignmentResponse({
        status: 'APPROVED',
        siteManagerDecidedByUserId: 'user-manager-01',
        version: 3,
      });
      const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(200, mockData));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const requestId = 'req-assign-01';
      const token = 'token-manager-01';

      const result = await client.decideWorkerSiteZoneAssignment(token, requestId, true);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

      expect(url).toBe(
        `${BASE_URL}/api/v1/site-zone-assignment-requests/${encodeURIComponent(requestId)}/site-manager-decision`,
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
      expect(parsedBody).toEqual({ approve: true });
      expect(result.status).toBe('APPROVED');
    });

    it('sends retained review body { approve, expectedVersion, reviewNote } when review object is provided', async () => {
      const mockData = createMockAssignmentResponse({
        status: 'APPROVED',
        siteManagerDecidedByUserId: 'user-manager-01',
        version: 3,
        reviewNote: 'Safety and compliance checks passed',
      });
      const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(200, mockData));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const rawRequestId = 'req/assign#99';
      const token = 'token-manager-02';

      const result = await client.decideWorkerSiteZoneAssignment(token, rawRequestId, true, {
        expectedVersion: 2,
        reviewNote: 'Safety and compliance checks passed',
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

      expect(url).toBe(
        `${BASE_URL}/api/v1/site-zone-assignment-requests/${encodeURIComponent(rawRequestId)}/site-manager-decision`,
      );
      expect(init.method).toBe('POST');

      const parsedBody = JSON.parse(init.body as string);
      expect(parsedBody).toEqual({
        approve: true,
        expectedVersion: 2,
        reviewNote: 'Safety and compliance checks passed',
      });
      expect(parsedBody).not.toHaveProperty('actor');
      expect(parsedBody).not.toHaveProperty('command');

      expect(result.status).toBe('APPROVED');
      expect(result.version).toBe(3);
      expect(result.reviewNote).toBe('Safety and compliance checks passed');
    });

    it('sends rejection decision with expectedVersion and rejection reviewNote', async () => {
      const mockData = createMockAssignmentResponse({
        status: 'REJECTED',
        siteManagerDecidedByUserId: 'user-manager-01',
        version: 3,
        reviewNote: 'Contractor credentials expired',
      });
      const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(200, mockData));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const requestId = 'req-assign-02';
      const token = 'token-manager-03';

      const result = await client.decideWorkerSiteZoneAssignment(token, requestId, false, {
        expectedVersion: 2,
        reviewNote: 'Contractor credentials expired',
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

      const parsedBody = JSON.parse(init.body as string);
      expect(parsedBody).toEqual({
        approve: false,
        expectedVersion: 2,
        reviewNote: 'Contractor credentials expired',
      });
      expect(result.status).toBe('REJECTED');
      expect(result.reviewNote).toBe('Contractor credentials expired');
    });

    it('rejects without calling fetch when signal is pre-aborted on decide', async () => {
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const controller = new AbortController();
      controller.abort();

      await expect(
        client.decideWorkerSiteZoneAssignment(
          'token',
          'req-1',
          true,
          { expectedVersion: 1 },
          { signal: controller.signal },
        ),
      ).rejects.toThrowError(expect.objectContaining({ code: 'cancelled' }));

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('ensures malicious runtime review.approve cannot override explicit boolean approve parameter', async () => {
      const mockData = createMockAssignmentResponse({
        status: 'APPROVED',
        version: 2,
      });
      const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(200, mockData));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const runtimeReview = { expectedVersion: 1, reviewNote: 'Approved note', approve: false };
      await client.decideWorkerSiteZoneAssignment('token', 'req-1', true, runtimeReview);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const parsedBody = JSON.parse(init.body as string);
      expect(parsedBody.approve).toBe(true);
      expect(parsedBody.expectedVersion).toBe(1);
      expect(parsedBody.reviewNote).toBe('Approved note');
    });
  });

  describe('5. revokeWorkerAssignment (POST /site-zone-assignment-requests/:id/revoke)', () => {
    it('sends POST to /site-zone-assignment-requests/:id/revoke with expectedVersion and reviewNote', async () => {
      const mockData = createMockAssignmentResponse({
        status: 'REVOKED',
        version: 4,
        reviewNote: 'Worker departed project site',
      });
      const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(200, mockData));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const rawAssignmentId = 'assign/target#44';
      const token = 'token-revoke-01';

      const result = await client.revokeWorkerAssignment(
        token,
        rawAssignmentId,
        3,
        'Worker departed project site',
      );

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

      expect(url).toBe(
        `${BASE_URL}/api/v1/site-zone-assignment-requests/${encodeURIComponent(rawAssignmentId)}/revoke`,
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
        expectedVersion: 3,
        reviewNote: 'Worker departed project site',
      });
      expect(parsedBody).not.toHaveProperty('actor');
      expect(parsedBody).not.toHaveProperty('command');

      expect(result.status).toBe('REVOKED');
      expect(result.version).toBe(4);
      expect(result.reviewNote).toBe('Worker departed project site');
    });

    it('preserves returned EXPIRED response status from backend', async () => {
      const mockData = createMockAssignmentResponse({
        id: 'assign-expired-01',
        status: 'EXPIRED',
        version: 5,
        reviewNote: 'Assignment validity window expired',
      });
      const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(200, mockData));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const result = await client.revokeWorkerAssignment(
        'token-revoke-02',
        'assign-expired-01',
        4,
        'Administrative cleanup of expired assignment',
      );

      expect(result.status).toBe('EXPIRED');
      expect(result.version).toBe(5);
      expect(result.reviewNote).toBe('Assignment validity window expired');
    });

    it('rejects without calling fetch when revoke signal is pre-aborted', async () => {
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const controller = new AbortController();
      controller.abort();

      await expect(
        client.revokeWorkerAssignment('token', 'assign-1', 2, 'Note', {
          signal: controller.signal,
        }),
      ).rejects.toThrowError(expect.objectContaining({ code: 'cancelled' }));

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('aborts in-flight revoke request when signal aborts', async () => {
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

      const promise = client.revokeWorkerAssignment('token', 'assign-1', 2, 'Note', {
        signal: controller.signal,
      });
      controller.abort();

      await expect(promise).rejects.toThrowError(expect.objectContaining({ code: 'cancelled' }));
    });
  });

  describe('6. Error Handling & Safety Boundaries (No-Retry Invariants)', () => {
    it('propagates HTTP 401 Unauthorized as ApiError', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(
          mockErrorEnvelope(
            401,
            'UNAUTHORIZED',
            'Token has expired or session is invalid.',
            '/api/v1/site-zone-assignment-requests/req-1/site-manager-decision',
          ),
        );

      try {
        await client.decideWorkerSiteZoneAssignment('expired-token', 'req-1', true);
        expect.unreachable('Should have thrown 401 ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('http');
        expect(apiErr.status).toBe(401);
        expect(apiErr.message).toBe('Token has expired or session is invalid.');
        expect(apiErr.backendError?.code).toBe('UNAUTHORIZED');
      }
    });

    it('propagates HTTP 403 Forbidden as ApiError when user lacks site manager permission', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(
          mockErrorEnvelope(
            403,
            'FORBIDDEN',
            'Only Site Managers can decide worker zone assignments.',
            '/api/v1/site-zone-assignment-requests/req-1/site-manager-decision',
          ),
        );

      try {
        await client.decideWorkerSiteZoneAssignment('token', 'req-1', true);
        expect.unreachable('Should have thrown 403 ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('http');
        expect(apiErr.status).toBe(403);
        expect(apiErr.message).toBe('Only Site Managers can decide worker zone assignments.');
        expect(apiErr.backendError?.code).toBe('FORBIDDEN');
      }
    });

    it('propagates HTTP 409 Conflict as ApiError on version mismatch and does NOT retry mutation', async () => {
      const fetchSpy = vi
        .fn()
        .mockResolvedValue(
          mockErrorEnvelope(
            409,
            'CONFLICT',
            'Assignment request version has changed; reload and review current state.',
            '/api/v1/site-zone-assignment-requests/req-1/site-manager-decision',
          ),
        );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      try {
        await client.decideWorkerSiteZoneAssignment('token', 'req-1', true, {
          expectedVersion: 1,
        });
        expect.unreachable('Should have thrown 409 ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('http');
        expect(apiErr.status).toBe(409);
        expect(apiErr.message).toBe(
          'Assignment request version has changed; reload and review current state.',
        );
        expect(apiErr.backendError?.code).toBe('CONFLICT');
      }

      // Essential safety invariant: Mutation must not retry on 409 conflict
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry revoke mutation on HTTP 500 server error to prevent duplicate side-effects', async () => {
      const fetchSpy = vi
        .fn()
        .mockResolvedValue(
          mockErrorEnvelope(
            500,
            'INTERNAL_SERVER_ERROR',
            'Database transaction aborted during assignment revocation.',
            '/api/v1/site-zone-assignment-requests/assign-1/revoke',
          ),
        );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      try {
        await client.revokeWorkerAssignment('token', 'assign-1', 3, 'Departed');
        expect.unreachable('Should have thrown 500 ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('http');
        expect(apiErr.status).toBe(500);
      }

      // Essential safety invariant: Revoke mutation must not retry on 500
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry createWorkerSiteZoneAssignment on network disconnect error', async () => {
      const fetchSpy = vi
        .fn()
        .mockRejectedValue(new TypeError('Failed to fetch (network disconnect)'));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      await expect(
        client.createWorkerSiteZoneAssignment('token', 'worker-1', {
          siteId: 'site-1',
          zoneIds: ['z1'],
          validFrom: '2026-10-01T00:00:00Z',
          validUntil: null,
        }),
      ).rejects.toThrowError(expect.objectContaining({ code: 'network' }));

      // Mutation write must not be retried on network error
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });
});
