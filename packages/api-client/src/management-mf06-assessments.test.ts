import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  SmartSiteManagementClient,
  type Mf06AssessmentPage,
  type Mf06AssessmentResponse,
} from './index';

const BASE_URL = 'http://localhost:3000';
const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

const sampleAssessment: Mf06AssessmentResponse = {
  assessmentId: '11111111-1111-4111-8111-111111111111',
  requestId: '22222222-2222-4222-8222-222222222222',
  siteId: '33333333-3333-4333-8333-333333333333',
  eventId: '44444444-4444-4444-8444-444444444444',
  cameraId: '55555555-5555-4555-8555-555555555555',
  zoneId: '66666666-6666-4666-8666-666666666666',
  capturedAt: '2026-10-12T10:00:00.000Z',
  assessedAt: '2026-10-12T10:00:01.000Z',
  purpose: 'INITIAL_OBSERVATION_ASSESSMENT',
  outcome: 'ALLOWED',
  reasonCode: 'AUTHORIZED',
  evaluatorVersion: 'mf06-v1.0.0',
  provenance: 'TRUSTED_SERVICE',
};

const samplePage: Mf06AssessmentPage = {
  items: [sampleAssessment],
  total: 1,
  offset: 0,
  limit: 20,
};

const FORBIDDEN_PRIVACY_KEYS = [
  'workerId',
  'worker',
  'profile',
  'faceProfileId',
  'faceImage',
  'media',
  'mediaUrl',
  'template',
  'artifact',
  'token',
  'alertId',
] as const;

function mockBackendError(status: number, code: string, message: string) {
  return Response.json(
    {
      success: false,
      statusCode: status,
      code,
      message,
      requestId: 'req-err-1',
      timestamp: '2026-10-12T10:00:00.000Z',
      path: '/api/v1/error',
    },
    { status },
  );
}

describe('SmartSiteManagementClient - MF06 Assessments (B5)', () => {
  describe('happy path & typed contract validation', () => {
    it('getMf06Assessment calls GET /sites/:siteId/mf06-assessments/:assessmentId and parses 13-field response', async () => {
      let requestedUrl = '';
      let authHeader: string | null = null;
      globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        requestedUrl = url;
        authHeader = (init?.headers as Record<string, string>)?.Authorization ?? null;
        return Promise.resolve(Response.json(sampleAssessment));
      });

      const client = new SmartSiteManagementClient(BASE_URL);
      const result = await client.getMf06Assessment(
        'bearer-token-1',
        sampleAssessment.siteId,
        sampleAssessment.assessmentId,
      );

      expect(requestedUrl).toBe(
        `${BASE_URL}/api/v1/sites/${sampleAssessment.siteId}/mf06-assessments/${sampleAssessment.assessmentId}`,
      );
      expect(authHeader).toBe('Bearer bearer-token-1');
      expect(result).toEqual(sampleAssessment);
      expect(Object.keys(result)).toHaveLength(13);
    });

    it('listMf06Assessments calls GET with default offset 0 and limit 20', async () => {
      let requestedUrl = '';
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        requestedUrl = url;
        return Promise.resolve(Response.json(samplePage));
      });

      const client = new SmartSiteManagementClient(BASE_URL);
      const result = await client.listMf06Assessments('bearer-token-1', sampleAssessment.siteId);

      expect(requestedUrl).toBe(
        `${BASE_URL}/api/v1/sites/${sampleAssessment.siteId}/mf06-assessments?offset=0&limit=20`,
      );
      expect(result).toEqual(samplePage);
    });

    it('listMf06Assessments respects explicit offset and limit', async () => {
      let requestedUrl = '';
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        requestedUrl = url;
        return Promise.resolve(Response.json({ ...samplePage, total: 50, offset: 40, limit: 10 }));
      });

      const client = new SmartSiteManagementClient(BASE_URL);
      const result = await client.listMf06Assessments('bearer-token-1', sampleAssessment.siteId, {
        offset: 40,
        limit: 10,
      });

      expect(requestedUrl).toBe(
        `${BASE_URL}/api/v1/sites/${sampleAssessment.siteId}/mf06-assessments?offset=40&limit=10`,
      );
      expect(result.offset).toBe(40);
      expect(result.limit).toBe(10);
    });
  });

  describe('frozen privacy keys & no data leakage', () => {
    for (const forbiddenKey of FORBIDDEN_PRIVACY_KEYS) {
      it(`rejects getMf06Assessment containing forbidden privacy key "${forbiddenKey}"`, async () => {
        const leakedPayload = {
          ...sampleAssessment,
          [forbiddenKey]: 'restricted-data-leak',
        };
        globalThis.fetch = vi.fn().mockResolvedValue(Response.json(leakedPayload));

        const client = new SmartSiteManagementClient(BASE_URL);
        await expect(
          client.getMf06Assessment('token', sampleAssessment.siteId, sampleAssessment.assessmentId),
        ).rejects.toMatchObject({ code: 'invalid-response' });
      });

      it(`rejects listMf06Assessments when item contains forbidden privacy key "${forbiddenKey}"`, async () => {
        const leakedPage: Mf06AssessmentPage = {
          ...samplePage,
          items: [
            { ...sampleAssessment, [forbiddenKey]: 'leak' } as unknown as Mf06AssessmentResponse,
          ],
        };
        globalThis.fetch = vi.fn().mockResolvedValue(Response.json(leakedPage));

        const client = new SmartSiteManagementClient(BASE_URL);
        await expect(
          client.listMf06Assessments('token', sampleAssessment.siteId),
        ).rejects.toMatchObject({ code: 'invalid-response' });
      });
    }
  });

  describe('cross-site & assessment ID scope protection', () => {
    it('rejects getMf06Assessment when response siteId does not match requested siteId', async () => {
      const foreignSiteId = '99999999-9999-4999-8999-999999999999';
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(Response.json({ ...sampleAssessment, siteId: foreignSiteId }));

      const client = new SmartSiteManagementClient(BASE_URL);
      await expect(
        client.getMf06Assessment('token', sampleAssessment.siteId, sampleAssessment.assessmentId),
      ).rejects.toMatchObject({ code: 'invalid-response' });
    });

    it('rejects getMf06Assessment when response assessmentId does not match requested assessmentId', async () => {
      const foreignAssessmentId = '88888888-8888-4888-8888-888888888888';
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(
          Response.json({ ...sampleAssessment, assessmentId: foreignAssessmentId }),
        );

      const client = new SmartSiteManagementClient(BASE_URL);
      await expect(
        client.getMf06Assessment('token', sampleAssessment.siteId, sampleAssessment.assessmentId),
      ).rejects.toMatchObject({ code: 'invalid-response' });
    });

    it('rejects listMf06Assessments when any item has a mismatched siteId', async () => {
      const foreignItem: Mf06AssessmentResponse = {
        ...sampleAssessment,
        assessmentId: '88888888-8888-4888-8888-888888888888',
        siteId: '99999999-9999-4999-8999-999999999999',
      };
      globalThis.fetch = vi.fn().mockResolvedValue(
        Response.json({
          ...samplePage,
          items: [sampleAssessment, foreignItem],
          total: 2,
        }),
      );

      const client = new SmartSiteManagementClient(BASE_URL);
      await expect(
        client.listMf06Assessments('token', sampleAssessment.siteId),
      ).rejects.toMatchObject({ code: 'invalid-response' });
    });

    it('accepts case-insensitive matching for siteId and assessmentId', async () => {
      const upperSiteId = sampleAssessment.siteId.toUpperCase();
      const upperAssessmentId = sampleAssessment.assessmentId.toUpperCase();
      globalThis.fetch = vi.fn().mockResolvedValue(Response.json(sampleAssessment));

      const client = new SmartSiteManagementClient(BASE_URL);
      const result = await client.getMf06Assessment('token', upperSiteId, upperAssessmentId);
      expect(result).toEqual(sampleAssessment);
    });
  });

  describe('pagination offset/limit & duplicate ID checks', () => {
    it('rejects listMf06Assessments when response offset does not match requested offset', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(Response.json({ ...samplePage, total: 50, offset: 10 }));

      const client = new SmartSiteManagementClient(BASE_URL);
      await expect(
        client.listMf06Assessments('token', sampleAssessment.siteId, { offset: 0, limit: 20 }),
      ).rejects.toMatchObject({ code: 'invalid-response' });
    });

    it('rejects listMf06Assessments when response limit does not match requested limit', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(Response.json({ ...samplePage, limit: 50 }));

      const client = new SmartSiteManagementClient(BASE_URL);
      await expect(
        client.listMf06Assessments('token', sampleAssessment.siteId, { offset: 0, limit: 20 }),
      ).rejects.toMatchObject({ code: 'invalid-response' });
    });

    it('rejects listMf06Assessments when items contain duplicate assessment IDs', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        Response.json({
          ...samplePage,
          items: [sampleAssessment, { ...sampleAssessment }],
          total: 2,
        }),
      );

      const client = new SmartSiteManagementClient(BASE_URL);
      await expect(
        client.listMf06Assessments('token', sampleAssessment.siteId),
      ).rejects.toMatchObject({ code: 'invalid-response' });
    });
  });

  describe('payload validation, enums and extra properties', () => {
    it('rejects getMf06Assessment when response contains unknown extra properties', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(Response.json({ ...sampleAssessment, extraUnexpectedField: 123 }));

      const client = new SmartSiteManagementClient(BASE_URL);
      await expect(
        client.getMf06Assessment('token', sampleAssessment.siteId, sampleAssessment.assessmentId),
      ).rejects.toMatchObject({ code: 'invalid-response' });
    });

    it('rejects non-object and null responses', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(Response.json(null));

      const client = new SmartSiteManagementClient(BASE_URL);
      await expect(
        client.getMf06Assessment('token', sampleAssessment.siteId, sampleAssessment.assessmentId),
      ).rejects.toMatchObject({ code: 'invalid-response' });
    });

    it('rejects response missing required fields', async () => {
      const incomplete: Record<string, unknown> = { ...sampleAssessment };
      delete incomplete.outcome;
      globalThis.fetch = vi.fn().mockResolvedValue(Response.json(incomplete));

      const client = new SmartSiteManagementClient(BASE_URL);
      await expect(
        client.getMf06Assessment('token', sampleAssessment.siteId, sampleAssessment.assessmentId),
      ).rejects.toMatchObject({ code: 'invalid-response' });
    });

    it('rejects invalid enum values and synthetic provenance', async () => {
      // Synthetic provenance is explicitly excluded
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(Response.json({ ...sampleAssessment, provenance: 'SYNTHETIC' }));

      const client = new SmartSiteManagementClient(BASE_URL);
      await expect(
        client.getMf06Assessment('token', sampleAssessment.siteId, sampleAssessment.assessmentId),
      ).rejects.toMatchObject({ code: 'invalid-response' });
    });
  });

  describe('HTTP error handling & safe proxy HTML', () => {
    it('throws ApiError with status 401 on Unauthorized', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(mockBackendError(401, 'UNAUTHORIZED', 'Invalid credentials'));

      const client = new SmartSiteManagementClient(BASE_URL);
      const err = await client
        .getMf06Assessment('token', sampleAssessment.siteId, sampleAssessment.assessmentId)
        .catch((e: ApiError) => e);

      expect(err).toBeInstanceOf(ApiError);
      if (!(err instanceof ApiError)) throw new Error('Expected ApiError');
      expect(err.code).toBe('http');
      expect(err.status).toBe(401);
    });

    it('throws ApiError with status 403 on Forbidden', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(mockBackendError(403, 'FORBIDDEN', 'Access denied to site'));

      const client = new SmartSiteManagementClient(BASE_URL);
      const err = await client
        .getMf06Assessment('token', sampleAssessment.siteId, sampleAssessment.assessmentId)
        .catch((e: ApiError) => e);

      expect(err).toBeInstanceOf(ApiError);
      if (!(err instanceof ApiError)) throw new Error('Expected ApiError');
      expect(err.code).toBe('http');
      expect(err.status).toBe(403);
    });

    it('handles 503 proxy HTML without crashing or leaking raw HTML markup', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response('<html><body>503 Service Temporarily Unavailable</body></html>', {
          status: 503,
          headers: { 'Content-Type': 'text/html' },
        }),
      );

      const client = new SmartSiteManagementClient(BASE_URL);
      const err = await client
        .getMf06Assessment('token', sampleAssessment.siteId, sampleAssessment.assessmentId)
        .catch((e: ApiError) => e);

      expect(err).toBeInstanceOf(ApiError);
      if (!(err instanceof ApiError)) throw new Error('Expected ApiError');
      // The shared transport preserves non-2xx HTTP status even without JSON.
      expect(err.code).toBe('http');
      expect(err.status).toBe(503);
      expect(err.message).toBe('Backend returned HTTP 503.');
      expect(err.message).not.toContain('<html>');
    });
  });

  describe('URL escaping, query encoding & bearer token security', () => {
    it('escapes special characters in siteId and assessmentId paths and rejects invalid response scope', async () => {
      let requestedUrl = '';
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        requestedUrl = url;
        return Promise.resolve(Response.json(sampleAssessment));
      });

      const client = new SmartSiteManagementClient(BASE_URL);
      const promise = client.getMf06Assessment('token', 'site/alpha 1#', 'asm/special?2');

      await expect(promise).rejects.toMatchObject({ code: 'invalid-response' });
      expect(requestedUrl).toBe(
        `${BASE_URL}/api/v1/sites/site%2Falpha%201%23/mf06-assessments/asm%2Fspecial%3F2`,
      );
    });

    it('sends token ONLY in Bearer Authorization header, never in URL or query', async () => {
      let requestedUrl = '';
      let authHeader: string | null = null;
      globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        requestedUrl = url;
        authHeader = (init?.headers as Record<string, string>)?.Authorization ?? null;
        return Promise.resolve(Response.json(sampleAssessment));
      });

      const secretToken = 'secret-token-12345';
      const client = new SmartSiteManagementClient(BASE_URL);
      await client
        .getMf06Assessment(secretToken, sampleAssessment.siteId, sampleAssessment.assessmentId)
        .catch(() => {});

      expect(authHeader).toBe(`Bearer ${secretToken}`);
      expect(requestedUrl).not.toContain(secretToken);
    });

    it('supports independent tokens across consecutive requests without global cache pollution', async () => {
      const recordedTokens: (string | null)[] = [];
      globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        const header = (init?.headers as Record<string, string>)?.Authorization ?? null;
        recordedTokens.push(header);
        return Promise.resolve(Response.json(sampleAssessment));
      });

      const client = new SmartSiteManagementClient(BASE_URL);
      await client
        .getMf06Assessment('token-A', sampleAssessment.siteId, sampleAssessment.assessmentId)
        .catch(() => {});
      await client
        .getMf06Assessment('token-B', sampleAssessment.siteId, sampleAssessment.assessmentId)
        .catch(() => {});

      expect(recordedTokens).toEqual(['Bearer token-A', 'Bearer token-B']);
    });
  });

  describe('cancellation, timeout & late resolution', () => {
    it('does not invoke fetch if AbortSignal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();

      const client = new SmartSiteManagementClient(BASE_URL);
      await expect(
        client.getMf06Assessment('token', sampleAssessment.siteId, sampleAssessment.assessmentId, {
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({ code: 'cancelled' });

      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('cancels an in-flight request when AbortSignal triggers mid-flight', async () => {
      const controller = new AbortController();
      let abortedReceived = false;

      globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        const signal = init?.signal;
        signal?.addEventListener('abort', () => {
          abortedReceived = true;
        });
        return new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        });
      });

      const client = new SmartSiteManagementClient(BASE_URL);
      const pending = client.getMf06Assessment(
        'token',
        sampleAssessment.siteId,
        sampleAssessment.assessmentId,
        { signal: controller.signal },
      );

      controller.abort();
      await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
      expect(abortedReceived).toBe(true);
    });

    it('times out when timeoutMs expires before response arrives', async () => {
      globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        });
      });

      const client = new SmartSiteManagementClient(BASE_URL);
      await expect(
        client.getMf06Assessment('token', sampleAssessment.siteId, sampleAssessment.assessmentId, {
          timeoutMs: 15,
        }),
      ).rejects.toMatchObject({ code: 'timeout' });
    });

    it('validates timeoutMs bounds strictly and rejects non-positive or non-finite values', async () => {
      const client = new SmartSiteManagementClient(BASE_URL);

      await expect(
        client.getMf06Assessment('token', sampleAssessment.siteId, sampleAssessment.assessmentId, {
          timeoutMs: -1,
        }),
      ).rejects.toThrow(RangeError);

      await expect(
        client.getMf06Assessment('token', sampleAssessment.siteId, sampleAssessment.assessmentId, {
          timeoutMs: 0,
        }),
      ).rejects.toThrow(RangeError);

      await expect(
        client.getMf06Assessment('token', sampleAssessment.siteId, sampleAssessment.assessmentId, {
          timeoutMs: Number.NaN,
        }),
      ).rejects.toThrow(RangeError);
    });

    it('safely handles late resolution after abort without throwing unhandled rejection', async () => {
      const controller = new AbortController();
      let lateResolve: (res: Response) => void;

      globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        return new Promise<Response>((resolve, reject) => {
          lateResolve = resolve;
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'AbortError'));
          });
        });
      });

      const client = new SmartSiteManagementClient(BASE_URL);
      const pending = client.getMf06Assessment(
        'token',
        sampleAssessment.siteId,
        sampleAssessment.assessmentId,
        { signal: controller.signal },
      );

      controller.abort();
      await expect(pending).rejects.toMatchObject({ code: 'cancelled' });

      // Late resolution after rejection must not cause crash
      expect(() => lateResolve(Response.json(sampleAssessment))).not.toThrow();
    });
  });
});
