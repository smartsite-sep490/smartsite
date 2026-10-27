import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { SmartSiteManagementClient, type PageOptions } from './management';
import { ApiError, type RequestOptions } from './index';
import type {
  ContractorRepresentativeGrantResponse,
  ContractorRepresentativeAssignmentResponse,
  Page,
} from '@smartsite/contracts';

const BASE_URL = 'http://localhost:3000';

function createMockGrantResponse(
  overrides?: Partial<ContractorRepresentativeGrantResponse>,
): ContractorRepresentativeGrantResponse {
  return {
    id: 'grant-01',
    contractorId: 'cont-01',
    userId: 'user-rep-01',
    createdAt: '2026-10-01T08:00:00.000Z',
    ...overrides,
  };
}

function createMockAssignmentResponse(
  overrides?: Partial<ContractorRepresentativeAssignmentResponse>,
): ContractorRepresentativeAssignmentResponse {
  return {
    id: 'rep-assign-01',
    siteId: 'site-01',
    contractorId: 'cont-01',
    userId: 'user-rep-01',
    createdAt: '2026-10-01T08:00:00.000Z',
    ...overrides,
  };
}

function createMockAssignmentPage(
  items: ContractorRepresentativeAssignmentResponse[] = [createMockAssignmentResponse()],
  total = 1,
): Page<ContractorRepresentativeAssignmentResponse> {
  return {
    items,
    total,
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
    requestId: 'req-rep-err-01',
    timestamp: '2026-10-11T21:00:00.000Z',
    path,
  };
  return mockJsonResponse(status, envelope);
}

describe('SmartSiteManagementClient - Contractor Representative Transport & Options', () => {
  let client: SmartSiteManagementClient;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    client = new SmartSiteManagementClient(BASE_URL);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('1. grantContractorRepresentative (POST /contractors/:contractorId/representative-grants)', () => {
    it('sends POST to /contractors/:contractorId/representative-grants with Bearer token, URI-encoded contractorId, JSON body, forwards RequestOptions', async () => {
      const mockData = createMockGrantResponse({
        id: 'grant-new-01',
        contractorId: 'cont-special/01#alpha',
        userId: 'user-rep-10',
      });
      const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(201, mockData));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const rawContractorId = 'cont-special/01#alpha';
      const token = 'token-admin-rep';
      const userId = 'user-rep-10';
      const options: RequestOptions = { timeoutMs: 4000 };

      const result = await client.grantContractorRepresentative(
        token,
        rawContractorId,
        userId,
        options,
      );

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

      expect(url).toBe(
        `${BASE_URL}/api/v1/contractors/${encodeURIComponent(rawContractorId)}/representative-grants`,
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
      expect(parsedBody).toEqual({ userId });
      expect(parsedBody).not.toHaveProperty('timeoutMs');
      expect(parsedBody).not.toHaveProperty('options');
      expect(parsedBody).not.toHaveProperty('token');
      expect(parsedBody).not.toHaveProperty('actor');
      expect(parsedBody).not.toHaveProperty('commandId');

      expect(result).toEqual(mockData);
    });

    it('preserves legacy grantContractorRepresentative signature without options parameter', async () => {
      const mockData = createMockGrantResponse();
      const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(201, mockData));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const token = 'token-legacy-rep';
      const contractorId = 'cont-01';
      const userId = 'user-rep-01';

      const result = await client.grantContractorRepresentative(token, contractorId, userId);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

      expect(url).toBe(`${BASE_URL}/api/v1/contractors/${contractorId}/representative-grants`);
      expect(init.method).toBe('POST');
      const parsedBody = JSON.parse(init.body as string);
      expect(parsedBody).toEqual({ userId });
      expect(result).toEqual(mockData);
    });

    it('rejects without calling fetch when signal is pre-aborted on grantContractorRepresentative', async () => {
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const controller = new AbortController();
      controller.abort();

      await expect(
        client.grantContractorRepresentative('token', 'cont-01', 'user-01', {
          signal: controller.signal,
        }),
      ).rejects.toThrowError(expect.objectContaining({ code: 'cancelled' }));

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('aborts in-flight grantContractorRepresentative when signal aborts', async () => {
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

      const promise = client.grantContractorRepresentative('token', 'cont-01', 'user-01', {
        signal: controller.signal,
      });
      controller.abort();

      await expect(promise).rejects.toThrowError(expect.objectContaining({ code: 'cancelled' }));
    });

    it('aborts and throws timeout when timeoutMs expires on grantContractorRepresentative', async () => {
      vi.useFakeTimers();
      try {
        const fetchSpy = vi.fn().mockImplementation(
          (_url: string, init: RequestInit) =>
            new Promise((_, reject) => {
              init.signal?.addEventListener('abort', () => {
                reject(new DOMException('The operation was aborted.', 'AbortError'));
              });
            }),
        );
        globalThis.fetch = fetchSpy as unknown as typeof fetch;

        const promise = client.grantContractorRepresentative('token', 'cont-01', 'user-01', {
          timeoutMs: 1000,
        });

        vi.advanceTimersByTime(1001);

        await expect(promise).rejects.toThrowError(expect.objectContaining({ code: 'timeout' }));
      } finally {
        vi.useRealTimers();
      }
    });

    it('propagates HTTP 400 Bad Request as ApiError on grantContractorRepresentative without retry', async () => {
      const fetchSpy = vi
        .fn()
        .mockResolvedValue(
          mockErrorEnvelope(
            400,
            'BAD_REQUEST',
            'Invalid userId format.',
            '/api/v1/contractors/cont-01/representative-grants',
          ),
        );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      try {
        await client.grantContractorRepresentative('token', 'cont-01', 'bad-user');
        expect.unreachable('Should have thrown 400 ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('http');
        expect(apiErr.status).toBe(400);
        expect(apiErr.message).toBe('Invalid userId format.');
        expect(apiErr.backendError?.code).toBe('BAD_REQUEST');
      }

      // Essential safety invariant: Mutation must not retry on 400
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('propagates HTTP 401 Unauthorized as ApiError on grantContractorRepresentative', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(
          mockErrorEnvelope(
            401,
            'UNAUTHORIZED',
            'Authentication required.',
            '/api/v1/contractors/cont-01/representative-grants',
          ),
        );

      try {
        await client.grantContractorRepresentative('expired-token', 'cont-01', 'user-01');
        expect.unreachable('Should have thrown 401 ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('http');
        expect(apiErr.status).toBe(401);
      }
    });

    it('propagates HTTP 403 Forbidden as ApiError on grantContractorRepresentative', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(
          mockErrorEnvelope(
            403,
            'FORBIDDEN',
            'User lacks permission to grant contractor representative role.',
            '/api/v1/contractors/cont-01/representative-grants',
          ),
        );

      try {
        await client.grantContractorRepresentative('token', 'cont-01', 'user-01');
        expect.unreachable('Should have thrown 403 ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('http');
        expect(apiErr.status).toBe(403);
      }
    });

    it('propagates HTTP 404 Not Found when contractor does not exist', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(
          mockErrorEnvelope(
            404,
            'NOT_FOUND',
            'Contractor not found.',
            '/api/v1/contractors/cont-missing/representative-grants',
          ),
        );

      try {
        await client.grantContractorRepresentative('token', 'cont-missing', 'user-01');
        expect.unreachable('Should have thrown 404 ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('http');
        expect(apiErr.status).toBe(404);
        expect(apiErr.backendError?.code).toBe('NOT_FOUND');
      }
    });

    it('propagates HTTP 409 Conflict when representative already granted and does NOT retry', async () => {
      const fetchSpy = vi
        .fn()
        .mockResolvedValue(
          mockErrorEnvelope(
            409,
            'CONFLICT',
            'User is already a representative for this contractor.',
            '/api/v1/contractors/cont-01/representative-grants',
          ),
        );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      try {
        await client.grantContractorRepresentative('token', 'cont-01', 'user-01');
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

    it('does NOT retry grantContractorRepresentative on HTTP 503 service unavailable', async () => {
      const fetchSpy = vi
        .fn()
        .mockResolvedValue(
          mockErrorEnvelope(
            503,
            'SERVICE_UNAVAILABLE',
            'Service temporarily overloaded.',
            '/api/v1/contractors/cont-01/representative-grants',
          ),
        );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      try {
        await client.grantContractorRepresentative('token', 'cont-01', 'user-01');
        expect.unreachable('Should have thrown 503 ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('http');
        expect(apiErr.status).toBe(503);
      }

      // Mutation write must not be retried on 503
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry grantContractorRepresentative on network disconnect error', async () => {
      const fetchSpy = vi
        .fn()
        .mockRejectedValue(new TypeError('Failed to fetch (network disconnect)'));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      await expect(
        client.grantContractorRepresentative('token', 'cont-01', 'user-01'),
      ).rejects.toThrowError(expect.objectContaining({ code: 'network' }));

      // Mutation write must not be retried on network error
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('2. assignContractorRepresentative (POST /sites/:siteId/contractors/:contractorId/representatives)', () => {
    it('sends POST to /sites/:siteId/contractors/:contractorId/representatives with Bearer token, URI-encoded IDs, JSON body, forwards RequestOptions', async () => {
      const mockData = createMockAssignmentResponse({
        id: 'rep-assign-special-01',
        siteId: 'site-special/01#alpha',
        contractorId: 'cont-special/02#beta',
        userId: 'user-rep-99',
      });
      const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(201, mockData));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const rawSiteId = 'site-special/01#alpha';
      const rawContractorId = 'cont-special/02#beta';
      const token = 'token-site-manager';
      const input = { userId: 'user-rep-99' };
      const options: RequestOptions = { timeoutMs: 5000 };

      const result = await client.assignContractorRepresentative(
        token,
        rawSiteId,
        rawContractorId,
        input,
        options,
      );

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

      expect(url).toBe(
        `${BASE_URL}/api/v1/sites/${encodeURIComponent(rawSiteId)}/contractors/${encodeURIComponent(rawContractorId)}/representatives`,
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
      expect(parsedBody).not.toHaveProperty('token');
      expect(parsedBody).not.toHaveProperty('actor');
      expect(parsedBody).not.toHaveProperty('commandId');

      expect(result).toEqual(mockData);
    });

    it('preserves legacy assignContractorRepresentative signature without options parameter', async () => {
      const mockData = createMockAssignmentResponse();
      const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(201, mockData));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const token = 'token-legacy-assign';
      const siteId = 'site-01';
      const contractorId = 'cont-01';
      const input = { userId: 'user-rep-01' };

      const result = await client.assignContractorRepresentative(
        token,
        siteId,
        contractorId,
        input,
      );

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

      expect(url).toBe(
        `${BASE_URL}/api/v1/sites/${siteId}/contractors/${contractorId}/representatives`,
      );
      expect(init.method).toBe('POST');
      const parsedBody = JSON.parse(init.body as string);
      expect(parsedBody).toEqual(input);
      expect(result).toEqual(mockData);
    });

    it('rejects without calling fetch when signal is pre-aborted on assignContractorRepresentative', async () => {
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const controller = new AbortController();
      controller.abort();

      await expect(
        client.assignContractorRepresentative(
          'token',
          'site-01',
          'cont-01',
          { userId: 'user-01' },
          { signal: controller.signal },
        ),
      ).rejects.toThrowError(expect.objectContaining({ code: 'cancelled' }));

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('aborts in-flight assignContractorRepresentative when signal aborts', async () => {
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

      const promise = client.assignContractorRepresentative(
        'token',
        'site-01',
        'cont-01',
        { userId: 'user-01' },
        { signal: controller.signal },
      );
      controller.abort();

      await expect(promise).rejects.toThrowError(expect.objectContaining({ code: 'cancelled' }));
    });

    it('aborts and throws timeout when timeoutMs expires on assignContractorRepresentative', async () => {
      vi.useFakeTimers();
      try {
        const fetchSpy = vi.fn().mockImplementation(
          (_url: string, init: RequestInit) =>
            new Promise((_, reject) => {
              init.signal?.addEventListener('abort', () => {
                reject(new DOMException('The operation was aborted.', 'AbortError'));
              });
            }),
        );
        globalThis.fetch = fetchSpy as unknown as typeof fetch;

        const promise = client.assignContractorRepresentative(
          'token',
          'site-01',
          'cont-01',
          { userId: 'user-01' },
          { timeoutMs: 1500 },
        );

        vi.advanceTimersByTime(1501);

        await expect(promise).rejects.toThrowError(expect.objectContaining({ code: 'timeout' }));
      } finally {
        vi.useRealTimers();
      }
    });

    it('propagates HTTP 400 Bad Request as ApiError on assignContractorRepresentative without retry', async () => {
      const fetchSpy = vi
        .fn()
        .mockResolvedValue(
          mockErrorEnvelope(
            400,
            'BAD_REQUEST',
            'userId is required.',
            '/api/v1/sites/site-01/contractors/cont-01/representatives',
          ),
        );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      try {
        await client.assignContractorRepresentative('token', 'site-01', 'cont-01', { userId: '' });
        expect.unreachable('Should have thrown 400 ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('http');
        expect(apiErr.status).toBe(400);
        expect(apiErr.backendError?.code).toBe('BAD_REQUEST');
      }

      // Essential safety invariant: Mutation must not retry on 400
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('propagates HTTP 401 Unauthorized as ApiError on assignContractorRepresentative', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(
          mockErrorEnvelope(
            401,
            'UNAUTHORIZED',
            'Authentication required.',
            '/api/v1/sites/site-01/contractors/cont-01/representatives',
          ),
        );

      try {
        await client.assignContractorRepresentative('expired-token', 'site-01', 'cont-01', {
          userId: 'user-01',
        });
        expect.unreachable('Should have thrown 401 ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('http');
        expect(apiErr.status).toBe(401);
      }
    });

    it('propagates HTTP 403 Forbidden as ApiError on assignContractorRepresentative', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(
          mockErrorEnvelope(
            403,
            'FORBIDDEN',
            'User lacks site manager scope.',
            '/api/v1/sites/site-01/contractors/cont-01/representatives',
          ),
        );

      try {
        await client.assignContractorRepresentative('token', 'site-01', 'cont-01', {
          userId: 'user-01',
        });
        expect.unreachable('Should have thrown 403 ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('http');
        expect(apiErr.status).toBe(403);
      }
    });

    it('propagates HTTP 404 Not Found when site or contractor does not exist', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(
          mockErrorEnvelope(
            404,
            'NOT_FOUND',
            'Site contractor participation not found.',
            '/api/v1/sites/site-missing/contractors/cont-01/representatives',
          ),
        );

      try {
        await client.assignContractorRepresentative('token', 'site-missing', 'cont-01', {
          userId: 'user-01',
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

    it('propagates HTTP 409 Conflict when representative already assigned on site and does NOT retry', async () => {
      const fetchSpy = vi
        .fn()
        .mockResolvedValue(
          mockErrorEnvelope(
            409,
            'CONFLICT',
            'Representative is already assigned to this site contractor.',
            '/api/v1/sites/site-01/contractors/cont-01/representatives',
          ),
        );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      try {
        await client.assignContractorRepresentative('token', 'site-01', 'cont-01', {
          userId: 'user-01',
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

    it('does NOT retry assignContractorRepresentative on HTTP 503 service unavailable', async () => {
      const fetchSpy = vi
        .fn()
        .mockResolvedValue(
          mockErrorEnvelope(
            503,
            'SERVICE_UNAVAILABLE',
            'Service temporarily overloaded.',
            '/api/v1/sites/site-01/contractors/cont-01/representatives',
          ),
        );
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      try {
        await client.assignContractorRepresentative('token', 'site-01', 'cont-01', {
          userId: 'user-01',
        });
        expect.unreachable('Should have thrown 503 ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('http');
        expect(apiErr.status).toBe(503);
      }

      // Mutation write must not be retried on 503
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry assignContractorRepresentative on network disconnect error', async () => {
      const fetchSpy = vi
        .fn()
        .mockRejectedValue(new TypeError('Failed to fetch (network disconnect)'));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      await expect(
        client.assignContractorRepresentative('token', 'site-01', 'cont-01', { userId: 'user-01' }),
      ).rejects.toThrowError(expect.objectContaining({ code: 'network' }));

      // Mutation write must not be retried on network error
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('3. listContractorRepresentativeAssignments (GET /sites/:siteId/contractor-representative-assignments)', () => {
    it('sends GET to /sites/:siteId/contractor-representative-assignments with Bearer token, URI-encoded siteId, forwards PageOptions and RequestOptions', async () => {
      const mockPage = createMockAssignmentPage(
        [
          createMockAssignmentResponse({
            id: 'rep-assign-page-01',
            siteId: 'site-special/01#alpha',
            userId: 'user-rep-page',
          }),
        ],
        1,
      );
      const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(200, mockPage));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const rawSiteId = 'site-special/01#alpha';
      const token = 'token-list-rep';
      const pageOptions: PageOptions = { offset: 10, limit: 25 };
      const requestOptions: RequestOptions = { timeoutMs: 3000 };

      const result = await client.listContractorRepresentativeAssignments(
        token,
        rawSiteId,
        pageOptions,
        requestOptions,
      );

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

      expect(url).toContain(
        `${BASE_URL}/api/v1/sites/${encodeURIComponent(rawSiteId)}/contractor-representative-assignments?`,
      );
      expect(url).toContain('offset=10');
      expect(url).toContain('limit=25');
      // Crucial: timeoutMs and token must NEVER leak into the URL query string
      expect(url).not.toContain('timeoutMs');
      expect(url).not.toContain(token);

      expect(init.method).toBe('GET');
      expect(init.headers).toEqual(
        expect.objectContaining({
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        }),
      );
      expect(init.body).toBeUndefined();

      expect(result).toEqual(mockPage);
    });

    it('preserves legacy listContractorRepresentativeAssignments signature without options parameter', async () => {
      const mockPage = createMockAssignmentPage();
      const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(200, mockPage));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const token = 'token-legacy-list';
      const siteId = 'site-01';

      const result = await client.listContractorRepresentativeAssignments(token, siteId);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];

      expect(url).toBe(`${BASE_URL}/api/v1/sites/${siteId}/contractor-representative-assignments`);
      expect(url).not.toContain('?');
      expect(init.method).toBe('GET');
      expect(result).toEqual(mockPage);
    });

    it('supports PageOptions only without RequestOptions (legacy pagination behavior)', async () => {
      const mockPage = createMockAssignmentPage([], 0);
      const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(200, mockPage));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const token = 'token-page-only';
      const siteId = 'site-01';
      const pageOptions: PageOptions = { limit: 15, offset: 30 };

      const result = await client.listContractorRepresentativeAssignments(
        token,
        siteId,
        pageOptions,
      );

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];

      const parsedUrl = new URL(url);
      expect(parsedUrl.origin + parsedUrl.pathname).toBe(
        `${BASE_URL}/api/v1/sites/${siteId}/contractor-representative-assignments`,
      );
      expect([...parsedUrl.searchParams]).toEqual([
        ['limit', '15'],
        ['offset', '30'],
      ]);
      expect(result).toEqual(mockPage);
    });

    it('supports RequestOptions as 4th argument with undefined PageOptions (URL query string remains clean)', async () => {
      const mockPage = createMockAssignmentPage();
      const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(200, mockPage));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const token = 'token-req-opts-only';
      const siteId = 'site-01';
      const requestOptions: RequestOptions = { timeoutMs: 3500 };

      const result = await client.listContractorRepresentativeAssignments(
        token,
        siteId,
        undefined,
        requestOptions,
      );

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];

      // Query string must NOT contain timeoutMs
      expect(url).toBe(`${BASE_URL}/api/v1/sites/${siteId}/contractor-representative-assignments`);
      expect(url).not.toContain('?');
      expect(url).not.toContain('timeoutMs');
      expect(result).toEqual(mockPage);
    });

    it('supports RequestOptions as 4th argument with signal and undefined PageOptions', async () => {
      const mockPage = createMockAssignmentPage();
      const fetchSpy = vi.fn().mockResolvedValue(mockJsonResponse(200, mockPage));
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const controller = new AbortController();
      const token = 'token-undef-page';
      const siteId = 'site-01';

      const result = await client.listContractorRepresentativeAssignments(
        token,
        siteId,
        undefined,
        { signal: controller.signal },
      );

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];

      expect(url).toBe(`${BASE_URL}/api/v1/sites/${siteId}/contractor-representative-assignments`);
      expect(url).not.toContain('?');
      expect(result).toEqual(mockPage);
    });

    it('rejects without calling fetch when signal is pre-aborted on listContractorRepresentativeAssignments', async () => {
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const controller = new AbortController();
      controller.abort();

      await expect(
        client.listContractorRepresentativeAssignments('token', 'site-01', undefined, {
          signal: controller.signal,
        }),
      ).rejects.toThrowError(expect.objectContaining({ code: 'cancelled' }));

      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('aborts in-flight listContractorRepresentativeAssignments when signal aborts', async () => {
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

      const promise = client.listContractorRepresentativeAssignments(
        'token',
        'site-01',
        { limit: 10 },
        { signal: controller.signal },
      );
      controller.abort();

      await expect(promise).rejects.toThrowError(expect.objectContaining({ code: 'cancelled' }));
    });

    it('aborts and throws timeout when timeoutMs expires on listContractorRepresentativeAssignments', async () => {
      vi.useFakeTimers();
      try {
        const fetchSpy = vi.fn().mockImplementation(
          (_url: string, init: RequestInit) =>
            new Promise((_, reject) => {
              init.signal?.addEventListener('abort', () => {
                reject(new DOMException('The operation was aborted.', 'AbortError'));
              });
            }),
        );
        globalThis.fetch = fetchSpy as unknown as typeof fetch;

        const promise = client.listContractorRepresentativeAssignments(
          'token',
          'site-01',
          undefined,
          { timeoutMs: 2000 },
        );

        vi.advanceTimersByTime(2001);

        await expect(promise).rejects.toThrowError(expect.objectContaining({ code: 'timeout' }));
      } finally {
        vi.useRealTimers();
      }
    });

    it('propagates HTTP 401 Unauthorized as ApiError on listContractorRepresentativeAssignments', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(
          mockErrorEnvelope(
            401,
            'UNAUTHORIZED',
            'Authentication required.',
            '/api/v1/sites/site-01/contractor-representative-assignments',
          ),
        );

      try {
        await client.listContractorRepresentativeAssignments('expired-token', 'site-01');
        expect.unreachable('Should have thrown 401 ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('http');
        expect(apiErr.status).toBe(401);
      }
    });

    it('propagates HTTP 403 Forbidden as ApiError on listContractorRepresentativeAssignments', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(
          mockErrorEnvelope(
            403,
            'FORBIDDEN',
            'User lacks access to this site.',
            '/api/v1/sites/site-01/contractor-representative-assignments',
          ),
        );

      try {
        await client.listContractorRepresentativeAssignments('token', 'site-01');
        expect.unreachable('Should have thrown 403 ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('http');
        expect(apiErr.status).toBe(403);
      }
    });

    it('propagates HTTP 404 Not Found when site does not exist on listContractorRepresentativeAssignments', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(
          mockErrorEnvelope(
            404,
            'NOT_FOUND',
            'Site not found.',
            '/api/v1/sites/site-missing/contractor-representative-assignments',
          ),
        );

      try {
        await client.listContractorRepresentativeAssignments('token', 'site-missing');
        expect.unreachable('Should have thrown 404 ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('http');
        expect(apiErr.status).toBe(404);
      }
    });

    it('propagates HTTP 500 Internal Server Error as ApiError on listContractorRepresentativeAssignments', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(
          mockErrorEnvelope(
            500,
            'INTERNAL_SERVER_ERROR',
            'Unexpected database error.',
            '/api/v1/sites/site-01/contractor-representative-assignments',
          ),
        );

      try {
        await client.listContractorRepresentativeAssignments('token', 'site-01');
        expect.unreachable('Should have thrown 500 ApiError');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('http');
        expect(apiErr.status).toBe(500);
      }
    });

    it('propagates network failure as ApiError on listContractorRepresentativeAssignments', async () => {
      globalThis.fetch = vi
        .fn()
        .mockRejectedValue(new TypeError('Failed to fetch (network disconnect)'));

      await expect(
        client.listContractorRepresentativeAssignments('token', 'site-01'),
      ).rejects.toThrowError(expect.objectContaining({ code: 'network' }));
    });
  });
});
