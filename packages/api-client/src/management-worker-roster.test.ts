import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { SmartSiteManagementClient } from './management';
import { ApiError, type RequestOptions } from './index';
import type { WorkerResponse } from '@smartsite/contracts';

const BASE_URL = 'http://localhost:3000';

function createMockWorkerResponse(overrides?: Partial<WorkerResponse>): WorkerResponse {
  return {
    id: 'worker-01',
    siteId: 'site-01',
    contractorId: null,
    userId: null,
    externalId: 'EXT-W-01',
    displayName: 'Nguyen Van A',
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
    requestId: 'req-worker-roster-err-01',
    timestamp: '2026-10-11T20:00:00.000Z',
    path,
  };
  return mockJsonResponse(status, envelope);
}

describe('SmartSiteManagementClient - Worker Roster Transport & Options', () => {
  let client: SmartSiteManagementClient;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    client = new SmartSiteManagementClient(BASE_URL);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('1. createWorker (POST /sites/:siteId/workers)', () => {
    it('sends POST with Bearer token, URI-encoded siteId, JSON body, forwards RequestOptions', async () => {
      const mockData = createMockWorkerResponse({
        id: 'worker-new-01',
        siteId: 'site-special/01#alpha',
        externalId: 'WRK-100',
        displayName: 'Le Van B',
      });
      const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(201, mockData));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const rawSiteId = 'site-special/01#alpha';
      const token = 'token-admin-01';
      const input = {
        externalId: 'WRK-100',
        displayName: 'Le Van B',
      };
      const options: RequestOptions = { timeoutMs: 3500 };

      const result = await client.createWorker(token, rawSiteId, input, options);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

      expect(url).toBe(`${BASE_URL}/api/v1/sites/${encodeURIComponent(rawSiteId)}/workers`);
      expect(url).not.toContain(token);
      expect(url).not.toContain('?');
      expect(url).not.toContain('timeoutMs');

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
      expect(parsedBody).not.toHaveProperty('timeoutMs');
      expect(parsedBody).not.toHaveProperty('options');
      expect(parsedBody).not.toHaveProperty('actor');
      expect(parsedBody).not.toHaveProperty('commandId');

      expect(result).toEqual(mockData);
    });

    it('supports createWorker with optional contractorId and userId without adding client business rules', async () => {
      const mockData = createMockWorkerResponse({
        id: 'worker-linked-01',
        siteId: 'site-01',
        contractorId: 'cont-01',
        userId: 'user-01',
        externalId: 'WRK-LINKED',
        displayName: 'Tran Van C',
      });
      const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(201, mockData));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const input = {
        externalId: 'WRK-LINKED',
        displayName: 'Tran Van C',
        contractorId: 'cont-01',
        userId: 'user-01',
      };

      const result = await client.createWorker('token-site-mgr', 'site-01', input);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      const parsedBody = JSON.parse(init.body as string);
      expect(parsedBody).toEqual(input);
      expect(parsedBody.contractorId).toBe('cont-01');
      expect(parsedBody.userId).toBe('user-01');
      expect(result).toEqual(mockData);
    });

    it('preserves legacy createWorker signature without options parameter', async () => {
      const mockData = createMockWorkerResponse();
      const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(201, mockData));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const token = 'token-legacy';
      const siteId = 'site-01';
      const input = { externalId: 'WRK-LEGACY', displayName: 'Legacy Worker' };

      const result = await client.createWorker(token, siteId, input);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

      expect(url).toBe(`${BASE_URL}/api/v1/sites/${siteId}/workers`);
      expect(init.method).toBe('POST');
      const parsedBody = JSON.parse(init.body as string);
      expect(parsedBody).toEqual(input);
      expect(result).toEqual(mockData);
    });

    it('rejects without calling fetch when signal is pre-aborted on createWorker', async () => {
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const controller = new AbortController();
      controller.abort();

      await expect(
        client.createWorker(
          'token',
          'site-01',
          { externalId: 'WRK-ABORT', displayName: 'Abort Worker' },
          { signal: controller.signal },
        ),
      ).rejects.toThrowError(expect.objectContaining({ code: 'cancelled' }));

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('aborts in-flight createWorker when signal aborts', async () => {
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

      const promise = client.createWorker(
        'token',
        'site-01',
        { externalId: 'WRK-CANCEL', displayName: 'Cancel Worker' },
        { signal: controller.signal },
      );
      controller.abort();

      await expect(promise).rejects.toThrowError(expect.objectContaining({ code: 'cancelled' }));
    });

    it('propagates HTTP 400 Bad Request as ApiError on createWorker without retry', async () => {
      const fetchSpy = vi
        .fn()
        .mockResolvedValue(
          mockErrorEnvelope(
            400,
            'BAD_REQUEST',
            'contractorId and userId must be provided together.',
            '/api/v1/sites/site-01/workers',
          ),
        );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      try {
        await client.createWorker('token', 'site-01', {
          externalId: 'WRK-BAD',
          displayName: 'Bad Input Worker',
          contractorId: 'cont-01',
        });
        expect.unreachable('Should have thrown 400 ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('http');
        expect(apiErr.status).toBe(400);
        expect(apiErr.message).toBe('contractorId and userId must be provided together.');
        expect(apiErr.backendError?.code).toBe('BAD_REQUEST');
      }

      // Essential safety invariant: Mutation must not retry on 400
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('propagates HTTP 401 Unauthorized as ApiError on createWorker', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(
          mockErrorEnvelope(
            401,
            'UNAUTHORIZED',
            'Authentication required.',
            '/api/v1/sites/site-01/workers',
          ),
        );

      try {
        await client.createWorker('expired-token', 'site-01', {
          externalId: 'WRK-UNAUTH',
          displayName: 'Unauth Worker',
        });
        expect.unreachable('Should have thrown 401 ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('http');
        expect(apiErr.status).toBe(401);
      }
    });

    it('propagates HTTP 403 Forbidden as ApiError on createWorker when user lacks site scope', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(
          mockErrorEnvelope(
            403,
            'FORBIDDEN',
            'User lacks worker creation permission on this site.',
            '/api/v1/sites/site-01/workers',
          ),
        );

      try {
        await client.createWorker('token', 'site-01', {
          externalId: 'WRK-FORBID',
          displayName: 'Forbidden Worker',
        });
        expect.unreachable('Should have thrown 403 ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('http');
        expect(apiErr.status).toBe(403);
      }
    });

    it('propagates HTTP 409 Conflict when externalId already exists and does NOT retry', async () => {
      const fetchSpy = vi
        .fn()
        .mockResolvedValue(
          mockErrorEnvelope(
            409,
            'CONFLICT',
            'Worker with externalId WRK-DUP already exists on site.',
            '/api/v1/sites/site-01/workers',
          ),
        );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      try {
        await client.createWorker('token', 'site-01', {
          externalId: 'WRK-DUP',
          displayName: 'Duplicate Worker',
        });
        expect.unreachable('Should have thrown 409 ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('http');
        expect(apiErr.status).toBe(409);
        expect(apiErr.backendError?.code).toBe('CONFLICT');
      }

      // Essential safety invariant: Mutation must not retry on 409
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry createWorker on HTTP 503 service unavailable', async () => {
      const fetchSpy = vi
        .fn()
        .mockResolvedValue(
          mockErrorEnvelope(
            503,
            'SERVICE_UNAVAILABLE',
            'Backend is currently overloaded; please back off.',
            '/api/v1/sites/site-01/workers',
          ),
        );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      try {
        await client.createWorker('token', 'site-01', {
          externalId: 'WRK-503',
          displayName: '503 Worker',
        });
        expect.unreachable('Should have thrown 503 ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('http');
        expect(apiErr.status).toBe(503);
      }

      // Essential safety invariant: Mutation must not retry on 503
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry createWorker on network disconnect error', async () => {
      const fetchSpy = vi
        .fn()
        .mockRejectedValue(new TypeError('Failed to fetch (network disconnect)'));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      await expect(
        client.createWorker('token', 'site-01', {
          externalId: 'WRK-NET',
          displayName: 'Network Error Worker',
        }),
      ).rejects.toThrowError(expect.objectContaining({ code: 'network' }));

      // Mutation write must not be retried on network error
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('2. linkWorkerAccount (PUT /sites/:siteId/workers/:workerId/account)', () => {
    it('sends PUT to /sites/:siteId/workers/:workerId/account with Bearer token, URI-encoded siteId & workerId, JSON body, forwards RequestOptions', async () => {
      const mockData = createMockWorkerResponse({
        id: 'worker-target/01#beta',
        siteId: 'site-special/01#alpha',
        userId: 'user-linked-99',
      });
      const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(200, mockData));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const rawSiteId = 'site-special/01#alpha';
      const rawWorkerId = 'worker-target/01#beta';
      const userId = 'user-linked-99';
      const token = 'token-link-admin';
      const options: RequestOptions = { timeoutMs: 4000 };

      const result = await client.linkWorkerAccount(token, rawSiteId, rawWorkerId, userId, options);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

      expect(url).toBe(
        `${BASE_URL}/api/v1/sites/${encodeURIComponent(rawSiteId)}/workers/${encodeURIComponent(rawWorkerId)}/account`,
      );
      expect(url).not.toContain(token);
      expect(url).not.toContain('?');
      expect(url).not.toContain('timeoutMs');

      expect(init.method).toBe('PUT');
      expect(init.headers).toEqual(
        expect.objectContaining({
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }),
      );

      const parsedBody = JSON.parse(init.body as string);
      expect(parsedBody).toEqual({ userId });
      expect(parsedBody).not.toHaveProperty('timeoutMs');
      expect(parsedBody).not.toHaveProperty('options');
      expect(parsedBody).not.toHaveProperty('actor');
      expect(parsedBody).not.toHaveProperty('commandId');

      expect(result).toEqual(mockData);
      expect(result.userId).toBe(userId);
    });

    it('preserves legacy linkWorkerAccount signature without options parameter', async () => {
      const mockData = createMockWorkerResponse({ userId: 'user-legacy-01' });
      const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(200, mockData));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const result = await client.linkWorkerAccount(
        'token-legacy',
        'site-01',
        'worker-01',
        'user-legacy-01',
      );

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

      expect(url).toBe(`${BASE_URL}/api/v1/sites/site-01/workers/worker-01/account`);
      expect(init.method).toBe('PUT');
      const parsedBody = JSON.parse(init.body as string);
      expect(parsedBody).toEqual({ userId: 'user-legacy-01' });
      expect(result).toEqual(mockData);
    });

    it('rejects without calling fetch when signal is pre-aborted on linkWorkerAccount', async () => {
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const controller = new AbortController();
      controller.abort();

      await expect(
        client.linkWorkerAccount('token', 'site-01', 'worker-01', 'user-01', {
          signal: controller.signal,
        }),
      ).rejects.toThrowError(expect.objectContaining({ code: 'cancelled' }));

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('aborts in-flight linkWorkerAccount when signal aborts', async () => {
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

      const promise = client.linkWorkerAccount('token', 'site-01', 'worker-01', 'user-01', {
        signal: controller.signal,
      });
      controller.abort();

      await expect(promise).rejects.toThrowError(expect.objectContaining({ code: 'cancelled' }));
    });

    it('propagates HTTP 404 Not Found as ApiError on linkWorkerAccount', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(
          mockErrorEnvelope(
            404,
            'NOT_FOUND',
            'Worker not found on site.',
            '/api/v1/sites/site-01/workers/worker-missing/account',
          ),
        );

      try {
        await client.linkWorkerAccount('token', 'site-01', 'worker-missing', 'user-01');
        expect.unreachable('Should have thrown 404 ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('http');
        expect(apiErr.status).toBe(404);
        expect(apiErr.backendError?.code).toBe('NOT_FOUND');
      }
    });

    it('propagates HTTP 409 Conflict when user is already linked to another worker and does NOT retry', async () => {
      const fetchSpy = vi
        .fn()
        .mockResolvedValue(
          mockErrorEnvelope(
            409,
            'CONFLICT',
            'User account is already linked to another worker.',
            '/api/v1/sites/site-01/workers/worker-01/account',
          ),
        );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      try {
        await client.linkWorkerAccount('token', 'site-01', 'worker-01', 'user-already-linked');
        expect.unreachable('Should have thrown 409 ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('http');
        expect(apiErr.status).toBe(409);
        expect(apiErr.backendError?.code).toBe('CONFLICT');
      }

      // Essential safety invariant: Mutation must not retry on 409
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry linkWorkerAccount on HTTP 503 service unavailable', async () => {
      const fetchSpy = vi
        .fn()
        .mockResolvedValue(
          mockErrorEnvelope(
            503,
            'SERVICE_UNAVAILABLE',
            'Service temporarily unavailable.',
            '/api/v1/sites/site-01/workers/worker-01/account',
          ),
        );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      try {
        await client.linkWorkerAccount('token', 'site-01', 'worker-01', 'user-01');
        expect.unreachable('Should have thrown 503 ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('http');
        expect(apiErr.status).toBe(503);
      }

      // Essential safety invariant: Mutation must not retry on 503
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('3. prepareFaceAccount (POST /sites/:siteId/workers/for-account)', () => {
    it('sends POST to /sites/:siteId/workers/for-account with Bearer token, URI-encoded siteId, JSON body, forwards RequestOptions', async () => {
      const mockData = createMockWorkerResponse({
        id: 'worker-face-acc-01',
        siteId: 'site-special/01#alpha',
        userId: 'user-for-account-42',
      });
      const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(201, mockData));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const rawSiteId = 'site-special/01#alpha';
      const userId = 'user-for-account-42';
      const token = 'token-prep-face';
      const options: RequestOptions = { timeoutMs: 5000 };

      const result = await client.prepareFaceAccount(token, rawSiteId, userId, options);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

      expect(url).toBe(
        `${BASE_URL}/api/v1/sites/${encodeURIComponent(rawSiteId)}/workers/for-account`,
      );
      expect(url).not.toContain(token);
      expect(url).not.toContain('?');
      expect(url).not.toContain('timeoutMs');

      // Crucial domain boundary: prepareFaceAccount calls Worker for-account endpoint ONLY,
      // no Face/model/capture/inference calls are made.
      expect(url).not.toContain('face-enrollment');
      expect(url).not.toContain('inference');

      expect(init.method).toBe('POST');
      expect(init.headers).toEqual(
        expect.objectContaining({
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        }),
      );

      const parsedBody = JSON.parse(init.body as string);
      expect(parsedBody).toEqual({ userId });
      expect(parsedBody).not.toHaveProperty('timeoutMs');
      expect(parsedBody).not.toHaveProperty('options');
      expect(parsedBody).not.toHaveProperty('actor');
      expect(parsedBody).not.toHaveProperty('commandId');

      expect(result).toEqual(mockData);
      expect(result.userId).toBe(userId);
    });

    it('preserves legacy prepareFaceAccount signature without options parameter', async () => {
      const mockData = createMockWorkerResponse({ userId: 'user-prep-legacy' });
      const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(201, mockData));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const result = await client.prepareFaceAccount('token-legacy', 'site-01', 'user-prep-legacy');

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

      expect(url).toBe(`${BASE_URL}/api/v1/sites/site-01/workers/for-account`);
      expect(init.method).toBe('POST');
      const parsedBody = JSON.parse(init.body as string);
      expect(parsedBody).toEqual({ userId: 'user-prep-legacy' });
      expect(result).toEqual(mockData);
    });

    it('rejects without calling fetch when signal is pre-aborted on prepareFaceAccount', async () => {
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const controller = new AbortController();
      controller.abort();

      await expect(
        client.prepareFaceAccount('token', 'site-01', 'user-01', {
          signal: controller.signal,
        }),
      ).rejects.toThrowError(expect.objectContaining({ code: 'cancelled' }));

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('aborts in-flight prepareFaceAccount when signal aborts', async () => {
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

      const promise = client.prepareFaceAccount('token', 'site-01', 'user-01', {
        signal: controller.signal,
      });
      controller.abort();

      await expect(promise).rejects.toThrowError(expect.objectContaining({ code: 'cancelled' }));
    });

    it('propagates HTTP 404 Not Found when user account does not exist', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(
          mockErrorEnvelope(
            404,
            'NOT_FOUND',
            'User account does not exist.',
            '/api/v1/sites/site-01/workers/for-account',
          ),
        );

      try {
        await client.prepareFaceAccount('token', 'site-01', 'user-nonexistent');
        expect.unreachable('Should have thrown 404 ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('http');
        expect(apiErr.status).toBe(404);
        expect(apiErr.backendError?.code).toBe('NOT_FOUND');
      }
    });

    it('does NOT retry prepareFaceAccount on HTTP 503 service unavailable', async () => {
      const fetchSpy = vi
        .fn()
        .mockResolvedValue(
          mockErrorEnvelope(
            503,
            'SERVICE_UNAVAILABLE',
            'Service temporarily unavailable.',
            '/api/v1/sites/site-01/workers/for-account',
          ),
        );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      try {
        await client.prepareFaceAccount('token', 'site-01', 'user-01');
        expect.unreachable('Should have thrown 503 ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('http');
        expect(apiErr.status).toBe(503);
      }

      // Essential safety invariant: Mutation must not retry on 503
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry prepareFaceAccount on network disconnect error', async () => {
      const fetchSpy = vi
        .fn()
        .mockRejectedValue(new TypeError('Failed to fetch (network disconnect)'));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      await expect(
        client.prepareFaceAccount('token', 'site-01', 'user-net-err'),
      ).rejects.toThrowError(expect.objectContaining({ code: 'network' }));

      // Mutation write must not be retried on network error
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });
});
