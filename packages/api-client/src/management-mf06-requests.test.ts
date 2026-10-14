import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  SmartSiteManagementClient,
  type Mf06RequestStatusPage,
  type Mf06RequestStatusResponse,
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

const samplePendingRequest: Mf06RequestStatusResponse = {
  requestId: '22222222-2222-4222-8222-222222222222',
  siteId: '33333333-3333-4333-8333-333333333333',
  eventId: '44444444-4444-4444-8444-444444444444',
  cameraId: '55555555-5555-4555-8555-555555555555',
  zoneId: '66666666-6666-4666-8666-666666666666',
  capturedAt: '2026-10-12T10:00:00.000Z',
  requestedAt: '2026-10-12T10:00:01.000Z',
  purpose: 'INITIAL_OBSERVATION_ASSESSMENT',
  jobStatus: 'PENDING',
  attemptCount: 1,
  deadlineAt: '2026-10-12T10:00:05.000Z',
  deadlinePassed: false,
  assessmentId: null,
};

const sampleNotQueuedRequest: Mf06RequestStatusResponse = {
  requestId: '22222222-2222-4222-8222-222222222223',
  siteId: '33333333-3333-4333-8333-333333333333',
  eventId: '44444444-4444-4444-8444-444444444444',
  cameraId: '55555555-5555-4555-8555-555555555555',
  zoneId: '66666666-6666-4666-8666-666666666666',
  capturedAt: '2026-10-12T10:00:00.000Z',
  requestedAt: '2026-10-12T10:00:01.000Z',
  purpose: 'INITIAL_OBSERVATION_ASSESSMENT',
  jobStatus: 'NOT_QUEUED',
  attemptCount: null,
  deadlineAt: null,
  deadlinePassed: false,
  assessmentId: null,
};

const sampleSucceededRequest: Mf06RequestStatusResponse = {
  requestId: '22222222-2222-4222-8222-222222222224',
  siteId: '33333333-3333-4333-8333-333333333333',
  eventId: '44444444-4444-4444-8444-444444444444',
  cameraId: '55555555-5555-4555-8555-555555555555',
  zoneId: '66666666-6666-4666-8666-666666666666',
  capturedAt: '2026-10-12T10:00:00.000Z',
  requestedAt: '2026-10-12T10:00:01.000Z',
  purpose: 'INITIAL_OBSERVATION_ASSESSMENT',
  jobStatus: 'SUCCEEDED',
  attemptCount: 1,
  deadlineAt: '2026-10-12T10:00:05.000Z',
  deadlinePassed: false,
  assessmentId: '11111111-1111-4111-8111-111111111111',
};

const samplePage: Mf06RequestStatusPage = {
  items: [samplePendingRequest],
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

describe('SmartSiteManagementClient - MF06 Request Status (B5)', () => {
  describe('happy path & typed contract validation', () => {
    it('getMf06RequestStatus calls GET /sites/:siteId/mf06-assessment-requests/:requestId and parses 13-field response', async () => {
      let requestedUrl = '';
      let authHeader: string | null = null;
      globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
        requestedUrl = url;
        authHeader = (init?.headers as Record<string, string>)?.Authorization ?? null;
        return Promise.resolve(Response.json(samplePendingRequest));
      });

      const client = new SmartSiteManagementClient(BASE_URL);
      const result = await client.getMf06RequestStatus(
        'bearer-token-1',
        samplePendingRequest.siteId,
        samplePendingRequest.requestId,
      );

      expect(requestedUrl).toBe(
        `${BASE_URL}/api/v1/sites/${samplePendingRequest.siteId}/mf06-assessment-requests/${samplePendingRequest.requestId}`,
      );
      expect(authHeader).toBe('Bearer bearer-token-1');
      expect(result).toEqual(samplePendingRequest);
      expect(Object.keys(result)).toHaveLength(13);
    });

    it('listMf06RequestStatuses calls GET with default offset 0 and limit 20', async () => {
      let requestedUrl = '';
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        requestedUrl = url;
        return Promise.resolve(Response.json(samplePage));
      });

      const client = new SmartSiteManagementClient(BASE_URL);
      const result = await client.listMf06RequestStatuses(
        'bearer-token-1',
        samplePendingRequest.siteId,
      );

      expect(requestedUrl).toBe(
        `${BASE_URL}/api/v1/sites/${samplePendingRequest.siteId}/mf06-assessment-requests?offset=0&limit=20`,
      );
      expect(result).toEqual(samplePage);
      expect(result.items).toHaveLength(1);
    });

    it('handles NOT_QUEUED jobStatus with null attemptCount, deadlineAt, assessmentId and deadlinePassed=false', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(Response.json(sampleNotQueuedRequest));
      const client = new SmartSiteManagementClient(BASE_URL);
      const result = await client.getMf06RequestStatus(
        'token',
        sampleNotQueuedRequest.siteId,
        sampleNotQueuedRequest.requestId,
      );

      expect(result.jobStatus).toBe('NOT_QUEUED');
      expect(result.attemptCount).toBeNull();
      expect(result.deadlineAt).toBeNull();
      expect(result.deadlinePassed).toBe(false);
      expect(result.assessmentId).toBeNull();
    });

    it('handles SUCCEEDED jobStatus with valid assessment UUID', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(Response.json(sampleSucceededRequest));
      const client = new SmartSiteManagementClient(BASE_URL);
      const result = await client.getMf06RequestStatus(
        'token',
        sampleSucceededRequest.siteId,
        sampleSucceededRequest.requestId,
      );

      expect(result.jobStatus).toBe('SUCCEEDED');
      expect(result.assessmentId).toBe('11111111-1111-4111-8111-111111111111');
    });

    it('preserves CLAIMED status with deadlinePassed=true without fabricating FAILED status', async () => {
      const claimedOverdue: Mf06RequestStatusResponse = {
        ...samplePendingRequest,
        jobStatus: 'CLAIMED',
        deadlinePassed: true,
      };
      globalThis.fetch = vi.fn().mockResolvedValue(Response.json(claimedOverdue));
      const client = new SmartSiteManagementClient(BASE_URL);
      const result = await client.getMf06RequestStatus(
        'token',
        claimedOverdue.siteId,
        claimedOverdue.requestId,
      );

      expect(result.jobStatus).toBe('CLAIMED');
      expect(result.deadlinePassed).toBe(true);
    });

    it('rejects responses containing forbidden worker/permission/alert privacy fields', async () => {
      for (const forbiddenKey of FORBIDDEN_PRIVACY_KEYS) {
        const payloadWithPrivacyLeak = {
          ...samplePendingRequest,
          [forbiddenKey]: 'leak-value',
        };
        globalThis.fetch = vi.fn().mockResolvedValue(Response.json(payloadWithPrivacyLeak));
        const client = new SmartSiteManagementClient(BASE_URL);

        await expect(
          client.getMf06RequestStatus(
            'token',
            samplePendingRequest.siteId,
            samplePendingRequest.requestId,
          ),
        ).rejects.toThrow(ApiError);
      }
    });
  });

  describe('scope binding & response validation', () => {
    it('rejects getMf06RequestStatus response if siteId does not match request scope', async () => {
      const mismatchedResponse = {
        ...samplePendingRequest,
        siteId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      };
      globalThis.fetch = vi.fn().mockResolvedValue(Response.json(mismatchedResponse));

      const client = new SmartSiteManagementClient(BASE_URL);
      await expect(
        client.getMf06RequestStatus(
          'token',
          samplePendingRequest.siteId,
          samplePendingRequest.requestId,
        ),
      ).rejects.toThrow('Backend returned an invalid MF06 request status response.');
    });

    it('rejects getMf06RequestStatus response if requestId does not match', async () => {
      const mismatchedResponse = {
        ...samplePendingRequest,
        requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      };
      globalThis.fetch = vi.fn().mockResolvedValue(Response.json(mismatchedResponse));

      const client = new SmartSiteManagementClient(BASE_URL);
      await expect(
        client.getMf06RequestStatus(
          'token',
          samplePendingRequest.siteId,
          samplePendingRequest.requestId,
        ),
      ).rejects.toThrow('Backend returned an invalid MF06 request status response.');
    });

    it('rejects listMf06RequestStatuses page if any item has mismatched siteId', async () => {
      const mismatchedPage: Mf06RequestStatusPage = {
        items: [
          samplePendingRequest,
          {
            ...samplePendingRequest,
            requestId: '99999999-9999-4999-8999-999999999999',
            siteId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          },
        ],
        total: 2,
        offset: 0,
        limit: 20,
      };
      globalThis.fetch = vi.fn().mockResolvedValue(Response.json(mismatchedPage));

      const client = new SmartSiteManagementClient(BASE_URL);
      await expect(
        client.listMf06RequestStatuses('token', samplePendingRequest.siteId),
      ).rejects.toThrow('Backend returned an invalid MF06 request status page.');
    });

    it('rejects listMf06RequestStatuses page if returned offset or limit does not echo requested values', async () => {
      const mismatchedPage = {
        ...samplePage,
        offset: 10, // requested was 0
      };
      globalThis.fetch = vi.fn().mockResolvedValue(Response.json(mismatchedPage));

      const client = new SmartSiteManagementClient(BASE_URL);
      await expect(
        client.listMf06RequestStatuses('token', samplePendingRequest.siteId, {
          offset: 0,
          limit: 20,
        }),
      ).rejects.toThrow('Backend returned an invalid MF06 request status page.');
    });

    it('rejects SUCCEEDED request without assessmentId or with non-uuid assessmentId', async () => {
      const invalidSucceeded = {
        ...sampleSucceededRequest,
        assessmentId: null,
      };
      globalThis.fetch = vi.fn().mockResolvedValue(Response.json(invalidSucceeded));

      const client = new SmartSiteManagementClient(BASE_URL);
      await expect(
        client.getMf06RequestStatus(
          'token',
          sampleSucceededRequest.siteId,
          sampleSucceededRequest.requestId,
        ),
      ).rejects.toThrow(ApiError);
    });
  });

  describe('error handling & transport options', () => {
    it('translates 401 Unauthorized backend error envelope into typed ApiError', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(mockBackendError(401, 'UNAUTHORIZED', 'Invalid token.'));

      const client = new SmartSiteManagementClient(BASE_URL);
      const promise = client.listMf06RequestStatuses('bad-token', samplePendingRequest.siteId);

      await expect(promise).rejects.toMatchObject({
        code: 'http',
        status: 401,
        message: 'Invalid token.',
      });
    });

    it('translates 403 Forbidden backend error envelope', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(mockBackendError(403, 'FORBIDDEN', 'Access denied.'));

      const client = new SmartSiteManagementClient(BASE_URL);
      await expect(
        client.listMf06RequestStatuses('token', samplePendingRequest.siteId),
      ).rejects.toMatchObject({
        code: 'http',
        status: 403,
      });
    });

    it('propagates AbortSignal cancellation', async () => {
      const controller = new AbortController();
      controller.abort();

      globalThis.fetch = vi
        .fn()
        .mockRejectedValue(new DOMException('The user aborted a request.', 'AbortError'));

      const client = new SmartSiteManagementClient(BASE_URL);
      await expect(
        client.listMf06RequestStatuses('token', samplePendingRequest.siteId, undefined, {
          signal: controller.signal,
        }),
      ).rejects.toMatchObject({
        code: 'cancelled',
      });
    });
  });
});
