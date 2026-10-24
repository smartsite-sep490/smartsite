import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { SmartSiteManagementClient } from './management';
import { ApiError, type RequestOptions } from './index';
import type { ContractorResponse, WorkerResponse } from '@smartsite/contracts';

const BASE_URL = 'http://localhost:3000';

function createMockContractorResponse(overrides?: Partial<ContractorResponse>): ContractorResponse {
  return {
    id: 'cont-01',
    code: 'ACME',
    name: 'Acme Construction',
    isActive: true,
    createdAt: '2026-10-01T08:00:00.000Z',
    ...overrides,
  };
}

function createMockWorkerResponse(overrides?: Partial<WorkerResponse>): WorkerResponse {
  return {
    id: 'worker-01',
    siteId: 'site-01',
    contractorId: 'cont-01',
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
    requestId: 'req-contractor-err-01',
    timestamp: '2026-10-11T19:30:00.000Z',
    path,
  };
  return mockJsonResponse(status, envelope);
}

describe('SmartSiteManagementClient - Contractor & Contractor Worker Transport & Options', () => {
  let client: SmartSiteManagementClient;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    client = new SmartSiteManagementClient(BASE_URL);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('1. createContractor - Global Overload (POST /contractors)', () => {
    it('sends POST to /contractors with Bearer token, JSON body, forwards RequestOptions without options in body or URL', async () => {
      const mockData = createMockContractorResponse({
        id: 'cont-global-01',
        code: 'BUILD-CORP',
        name: 'Build Corp Global',
      });
      const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(201, mockData));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const token = 'token-global-admin';
      const input = { code: 'BUILD-CORP', name: 'Build Corp Global' };
      const options: RequestOptions = { timeoutMs: 4000 };

      const result = await client.createContractor(token, input, options);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

      expect(url).toBe(`${BASE_URL}/api/v1/contractors`);
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
      expect(parsedBody).not.toHaveProperty('command');

      expect(result).toEqual(mockData);
      expect(result.siteId).toBeUndefined();
    });

    it('preserves legacy global createContractor without options parameter', async () => {
      const mockData = createMockContractorResponse();
      const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(201, mockData));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const token = 'token-admin-legacy';
      const input = { code: 'ACME', name: 'Acme Construction' };

      const result = await client.createContractor(token, input);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

      expect(url).toBe(`${BASE_URL}/api/v1/contractors`);
      expect(init.method).toBe('POST');
      const parsedBody = JSON.parse(init.body as string);
      expect(parsedBody).toEqual(input);
      expect(result).toEqual(mockData);
      expect(result.siteId).toBeUndefined();
    });

    it('rejects without calling fetch when signal is pre-aborted on global createContractor', async () => {
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const controller = new AbortController();
      controller.abort();

      await expect(
        client.createContractor(
          'token',
          { code: 'ABORT', name: 'Abort Co' },
          { signal: controller.signal },
        ),
      ).rejects.toThrowError(expect.objectContaining({ code: 'cancelled' }));

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('aborts in-flight global createContractor when signal aborts', async () => {
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

      const promise = client.createContractor(
        'token',
        { code: 'CANCEL', name: 'Cancel Co' },
        { signal: controller.signal },
      );
      controller.abort();

      await expect(promise).rejects.toThrowError(expect.objectContaining({ code: 'cancelled' }));
    });

    it('propagates HTTP 401 Unauthorized as ApiError on global createContractor', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(
          mockErrorEnvelope(
            401,
            'UNAUTHORIZED',
            'Admin authentication token required.',
            '/api/v1/contractors',
          ),
        );

      try {
        await client.createContractor('invalid-token', { code: 'UNAUTH', name: 'Unauth Co' });
        expect.unreachable('Should have thrown 401 ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('http');
        expect(apiErr.status).toBe(401);
        expect(apiErr.message).toBe('Admin authentication token required.');
        expect(apiErr.backendError?.code).toBe('UNAUTHORIZED');
      }
    });

    it('propagates HTTP 409 Conflict when contractor code already exists and does NOT retry', async () => {
      const fetchSpy = vi
        .fn()
        .mockResolvedValue(
          mockErrorEnvelope(
            409,
            'CONFLICT',
            'Contractor with code BUILD-CORP already exists.',
            '/api/v1/contractors',
          ),
        );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      try {
        await client.createContractor('token', { code: 'BUILD-CORP', name: 'Duplicate Co' });
        expect.unreachable('Should have thrown 409 ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('http');
        expect(apiErr.status).toBe(409);
        expect(apiErr.backendError?.code).toBe('CONFLICT');
      }

      // Essential safety invariant: Mutation must not retry on 409 conflict
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry global createContractor on HTTP 500 server error', async () => {
      const fetchSpy = vi
        .fn()
        .mockResolvedValue(
          mockErrorEnvelope(
            500,
            'INTERNAL_SERVER_ERROR',
            'Database constraint error during contractor creation.',
            '/api/v1/contractors',
          ),
        );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      try {
        await client.createContractor('token', { code: 'FAIL-500', name: 'Fail Co' });
        expect.unreachable('Should have thrown 500 ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('http');
        expect(apiErr.status).toBe(500);
      }

      // Essential safety invariant: Mutation must not retry on 500
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry global createContractor on network disconnect error', async () => {
      const fetchSpy = vi
        .fn()
        .mockRejectedValue(new TypeError('Failed to fetch (network disconnect)'));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      await expect(
        client.createContractor('token', { code: 'NET-ERR', name: 'Network Error Co' }),
      ).rejects.toThrowError(expect.objectContaining({ code: 'network' }));

      // Mutation write must not be retried on network error
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('2. createContractor - Site-Scoped Overload (POST /sites/:siteId/contractors)', () => {
    it('sends POST to /sites/:siteId/contractors with Bearer token, URI-encoded siteId, JSON body, forwards RequestOptions', async () => {
      const mockData = createMockContractorResponse({
        id: 'cont-scoped-01',
        siteId: 'site-special/01#alpha',
        code: 'SITE-SUB-01',
        name: 'Site Subcontractor Alpha',
      });
      const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(201, mockData));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const rawSiteId = 'site-special/01#alpha';
      const token = 'token-site-manager';
      const input = { code: 'SITE-SUB-01', name: 'Site Subcontractor Alpha' };
      const options: RequestOptions = { timeoutMs: 5000 };

      const result = await client.createContractor(token, rawSiteId, input, options);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

      expect(url).toBe(`${BASE_URL}/api/v1/sites/${encodeURIComponent(rawSiteId)}/contractors`);
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
      expect(parsedBody).not.toHaveProperty('command');

      expect(result).toEqual(mockData);
    });

    it('preserves legacy site-scoped createContractor without options parameter', async () => {
      const mockData = createMockContractorResponse({ siteId: 'site-10' });
      const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(201, mockData));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const token = 'token-site-mgr-legacy';
      const siteId = 'site-10';
      const input = { code: 'SUB-10', name: 'Subcontractor 10' };

      const result = await client.createContractor(token, siteId, input);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

      expect(url).toBe(`${BASE_URL}/api/v1/sites/${siteId}/contractors`);
      expect(init.method).toBe('POST');
      const parsedBody = JSON.parse(init.body as string);
      expect(parsedBody).toEqual(input);
      expect(result).toEqual(mockData);
    });

    it('rejects without calling fetch when signal is pre-aborted on site-scoped createContractor', async () => {
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const controller = new AbortController();
      controller.abort();

      await expect(
        client.createContractor(
          'token',
          'site-01',
          { code: 'ABORT-SITE', name: 'Abort Site Co' },
          { signal: controller.signal },
        ),
      ).rejects.toThrowError(expect.objectContaining({ code: 'cancelled' }));

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('aborts in-flight site-scoped createContractor when signal aborts', async () => {
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

      const promise = client.createContractor(
        'token',
        'site-01',
        { code: 'CANCEL-SITE', name: 'Cancel Site Co' },
        { signal: controller.signal },
      );
      controller.abort();

      await expect(promise).rejects.toThrowError(expect.objectContaining({ code: 'cancelled' }));
    });

    it('propagates HTTP 403 Forbidden as ApiError when user lacks site contractor management scope', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(
          mockErrorEnvelope(
            403,
            'FORBIDDEN',
            'Only Site Managers can create contractors for this site.',
            '/api/v1/sites/site-01/contractors',
          ),
        );

      try {
        await client.createContractor('token', 'site-01', {
          code: 'FORBIDDEN-CO',
          name: 'Forbidden Co',
        });
        expect.unreachable('Should have thrown 403 ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('http');
        expect(apiErr.status).toBe(403);
        expect(apiErr.message).toBe('Only Site Managers can create contractors for this site.');
        expect(apiErr.backendError?.code).toBe('FORBIDDEN');
      }
    });

    it('does NOT retry site-scoped createContractor on HTTP 500 server error', async () => {
      const fetchSpy = vi
        .fn()
        .mockResolvedValue(
          mockErrorEnvelope(
            500,
            'INTERNAL_SERVER_ERROR',
            'Database failure creating site-scoped contractor.',
            '/api/v1/sites/site-01/contractors',
          ),
        );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      try {
        await client.createContractor('token', 'site-01', {
          code: 'FAIL-SITE-500',
          name: 'Fail Site Co',
        });
        expect.unreachable('Should have thrown 500 ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('http');
        expect(apiErr.status).toBe(500);
      }

      // Essential safety invariant: Mutation must not retry on 500
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('3. createContractorWorker (POST /contractors/:contractorId/workers)', () => {
    it('sends POST to /contractors/:contractorId/workers with Bearer token, URI-encoded contractorId, JSON body, forwards RequestOptions', async () => {
      const mockData = createMockWorkerResponse({
        id: 'worker-new-01',
        contractorId: 'cont/beta#99',
        siteId: 'site-02',
        externalId: 'EXT-W-99',
        displayName: 'Tran Thi B',
      });
      const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(201, mockData));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const rawContractorId = 'cont/beta#99';
      const token = 'token-contractor-rep';
      const input = {
        siteId: 'site-02',
        externalId: 'EXT-W-99',
        displayName: 'Tran Thi B',
      };
      const options: RequestOptions = { timeoutMs: 3500 };

      const result = await client.createContractorWorker(token, rawContractorId, input, options);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

      expect(url).toBe(
        `${BASE_URL}/api/v1/contractors/${encodeURIComponent(rawContractorId)}/workers`,
      );
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
      expect(parsedBody).not.toHaveProperty('command');

      expect(result).toEqual(mockData);
    });

    it('preserves legacy createContractorWorker without options parameter', async () => {
      const mockData = createMockWorkerResponse();
      const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(201, mockData));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const token = 'token-rep-legacy';
      const contractorId = 'cont-01';
      const input = {
        siteId: 'site-01',
        externalId: 'EXT-W-01',
        displayName: 'Nguyen Van A',
      };

      const result = await client.createContractorWorker(token, contractorId, input);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

      expect(url).toBe(`${BASE_URL}/api/v1/contractors/${contractorId}/workers`);
      expect(init.method).toBe('POST');
      const parsedBody = JSON.parse(init.body as string);
      expect(parsedBody).toEqual(input);
      expect(result).toEqual(mockData);
    });

    it('rejects without calling fetch when signal is pre-aborted on createContractorWorker', async () => {
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const controller = new AbortController();
      controller.abort();

      await expect(
        client.createContractorWorker(
          'token',
          'cont-01',
          { siteId: 'site-01', externalId: 'WRK-A', displayName: 'Worker A' },
          { signal: controller.signal },
        ),
      ).rejects.toThrowError(expect.objectContaining({ code: 'cancelled' }));

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('aborts in-flight createContractorWorker when signal aborts', async () => {
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

      const promise = client.createContractorWorker(
        'token',
        'cont-01',
        { siteId: 'site-01', externalId: 'WRK-B', displayName: 'Worker B' },
        { signal: controller.signal },
      );
      controller.abort();

      await expect(promise).rejects.toThrowError(expect.objectContaining({ code: 'cancelled' }));
    });

    it('propagates HTTP 409 Conflict when worker externalId already exists and does NOT retry', async () => {
      const fetchSpy = vi
        .fn()
        .mockResolvedValue(
          mockErrorEnvelope(
            409,
            'CONFLICT',
            'Worker with externalId EXT-W-99 already exists for this contractor.',
            '/api/v1/contractors/cont-01/workers',
          ),
        );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      try {
        await client.createContractorWorker('token', 'cont-01', {
          siteId: 'site-01',
          externalId: 'EXT-W-99',
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

      // Essential safety invariant: Mutation must not retry on 409 conflict
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('propagates HTTP 404 Not Found when contractor does not exist', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(
          mockErrorEnvelope(
            404,
            'NOT_FOUND',
            'Contractor not found.',
            '/api/v1/contractors/cont-missing/workers',
          ),
        );

      try {
        await client.createContractorWorker('token', 'cont-missing', {
          siteId: 'site-01',
          externalId: 'EXT-W-02',
          displayName: 'Worker Missing',
        });
        expect.unreachable('Should have thrown 404 ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('http');
        expect(apiErr.status).toBe(404);
        expect(apiErr.backendError?.code).toBe('NOT_FOUND');
      }
    });

    it('does NOT retry createContractorWorker on HTTP 500 server error', async () => {
      const fetchSpy = vi
        .fn()
        .mockResolvedValue(
          mockErrorEnvelope(
            500,
            'INTERNAL_SERVER_ERROR',
            'Database transaction error during contractor worker registration.',
            '/api/v1/contractors/cont-01/workers',
          ),
        );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      try {
        await client.createContractorWorker('token', 'cont-01', {
          siteId: 'site-01',
          externalId: 'EXT-FAIL',
          displayName: 'Fail Worker',
        });
        expect.unreachable('Should have thrown 500 ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('http');
        expect(apiErr.status).toBe(500);
      }

      // Essential safety invariant: Mutation must not retry on 500
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry createContractorWorker on network disconnect error', async () => {
      const fetchSpy = vi
        .fn()
        .mockRejectedValue(new TypeError('Failed to fetch (network disconnect)'));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      await expect(
        client.createContractorWorker('token', 'cont-01', {
          siteId: 'site-01',
          externalId: 'EXT-NET',
          displayName: 'Network Error Worker',
        }),
      ).rejects.toThrowError(expect.objectContaining({ code: 'network' }));

      // Mutation write must not be retried on network error
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });
});
