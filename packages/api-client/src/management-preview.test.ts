import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, SmartSiteManagementClient } from './index';

const validSiteId = '11111111-1111-4111-8111-111111111111';
const validCameraId = '22222222-2222-4222-8222-222222222222';
const validCameraExternalId = 'CAM-01';

const validPreviewResponse = (capturedAt = new Date().toISOString()) => ({
  siteId: validSiteId,
  cameraId: validCameraId,
  cameraExternalId: validCameraExternalId,
  sourceKind: 'LIVE' as const,
  frame: {
    type: 'frame' as const,
    previewVersion: 1 as const,
    cameraExternalId: validCameraExternalId,
    sessionId: '33333333-3333-4333-8333-333333333333',
    sequenceNumber: '1',
    capturedAt,
    width: 640,
    height: 480,
    imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
    detections: [],
    zoneDetections: [],
    zonePolygons: [],
  },
});

describe('SmartSiteManagementClient scoped preview methods', () => {
  const originalFetch = globalThis.fetch;
  let client: SmartSiteManagementClient;

  beforeEach(() => {
    client = new SmartSiteManagementClient('http://localhost:3000');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('cancellable Site metadata', () => {
    it('does not fetch metadata after its viewer scope has already been cancelled', async () => {
      const controller = new AbortController();
      controller.abort();
      globalThis.fetch = vi.fn().mockResolvedValue(Response.json({ items: [], total: 0 }));
      await expect(
        client.listSites('test-token', undefined, { signal: controller.signal }),
      ).rejects.toMatchObject({ code: 'cancelled' });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });

    it('cancels an in-flight Site metadata read on viewer scope change', async () => {
      const controller = new AbortController();
      let receivedSignal: AbortSignal | undefined;
      let failPending: ((error: Error) => void) | undefined;
      globalThis.fetch = vi.fn().mockImplementation((_url, init) => {
        receivedSignal = init?.signal;
        return new Promise((_resolve, reject) => {
          failPending = reject;
          receivedSignal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        });
      });
      const request = client.listSites('test-token', undefined, { signal: controller.signal });
      const cancelled = expect(request).rejects.toMatchObject({ code: 'cancelled' });
      controller.abort();
      // The old API omits the signal; release its fake request without hanging the regression.
      if (!receivedSignal)
        failPending?.(new Error('Site metadata request did not receive its cancellation signal'));
      await cancelled;
      expect(receivedSignal?.aborted).toBe(true);
    });
  });

  describe('listPreviewCameras', () => {
    it('requests /api/v1/sites/:siteId/preview-cameras with query params and Bearer token', async () => {
      let requestedUrl = '';
      let requestedHeaders: Record<string, string> = {};

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        requestedUrl = url;
        requestedHeaders = (init?.headers as Record<string, string>) || {};
        return new Response(
          JSON.stringify({
            items: [
              {
                id: validCameraId,
                siteId: validSiteId,
                externalId: validCameraExternalId,
                code: 'CAM-01',
                name: 'Crane Area North',
                status: 'ACTIVE',
                configurationVersion: 1,
                createdAt: '2026-10-06T10:00:00Z',
              },
            ],
            total: 1,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const result = await client.listPreviewCameras('test-token', validSiteId, {
        offset: 0,
        limit: 20,
      });

      expect(requestedUrl).toBe(
        'http://localhost:3000/api/v1/sites/11111111-1111-4111-8111-111111111111/preview-cameras?offset=0&limit=20',
      );
      expect(requestedHeaders.Authorization).toBe('Bearer test-token');
      expect(result.items).toHaveLength(1);
      expect(result.items[0]?.externalId).toBe('CAM-01');
    });

    it('passes AbortSignal to fetch', async () => {
      const controller = new AbortController();
      controller.abort();

      await expect(
        client.listPreviewCameras('test-token', validSiteId, undefined, {
          signal: controller.signal,
        }),
      ).rejects.toThrow(ApiError);
    });
  });

  describe('getCameraPreview', () => {
    it('requests /api/v1/sites/:siteId/cameras/:cameraId/preview and safely validates response', async () => {
      let requestedUrl = '';
      let requestedHeaders: Record<string, string> = {};

      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        requestedUrl = url;
        requestedHeaders = (init?.headers as Record<string, string>) || {};
        return new Response(JSON.stringify(validPreviewResponse()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const response = await client.getCameraPreview('test-token', validSiteId, validCameraId);

      expect(requestedUrl).toBe(
        `http://localhost:3000/api/v1/sites/${validSiteId}/cameras/${validCameraId}/preview`,
      );
      expect(requestedHeaders.Authorization).toBe('Bearer test-token');
      expect(response.siteId).toBe(validSiteId);
      expect(response.cameraId).toBe(validCameraId);
      expect(response.cameraExternalId).toBe(validCameraExternalId);
      expect(response.sourceKind).toBe('LIVE');
      expect(response.frame.sequenceNumber).toBe('1');
    });

    it('throws ApiError invalid-response if backend payload violates contract', async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        const malformed = validPreviewResponse();
        // Camera ID mismatch between envelope and frame
        malformed.frame.cameraExternalId = 'DIFFERENT-CAMERA';
        return new Response(JSON.stringify(malformed), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      await expect(
        client.getCameraPreview('test-token', validSiteId, validCameraId),
      ).rejects.toThrow(ApiError);

      try {
        await client.getCameraPreview('test-token', validSiteId, validCameraId);
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).code).toBe('invalid-response');
      }
    });

    it('throws ApiError http on 401 Unauthorized', async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response(
          JSON.stringify({
            success: false,
            statusCode: 401,
            code: 'UNAUTHORIZED',
            message: 'Invalid or expired token',
            requestId: 'req-01',
            timestamp: '2026-10-06T12:00:00Z',
            path: `/sites/${validSiteId}/cameras/${validCameraId}/preview`,
          }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        );
      });

      try {
        await client.getCameraPreview('test-token', validSiteId, validCameraId);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('http');
        expect(apiErr.status).toBe(401);
      }
    });

    it('throws ApiError http on 403 Forbidden', async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response(
          JSON.stringify({
            success: false,
            statusCode: 403,
            code: 'FORBIDDEN',
            message: 'User does not have access to this site',
            requestId: 'req-02',
            timestamp: '2026-10-06T12:00:00Z',
            path: `/sites/${validSiteId}/cameras/${validCameraId}/preview`,
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        );
      });

      try {
        await client.getCameraPreview('test-token', validSiteId, validCameraId);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('http');
        expect(apiErr.status).toBe(403);
      }
    });

    it('throws ApiError http on 429 Rate Limit Exceeded and parses Retry-After', async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response(
          JSON.stringify({
            success: false,
            statusCode: 429,
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests',
            requestId: 'req-03',
            timestamp: new Date().toISOString(),
            path: `/sites/${validSiteId}/cameras/${validCameraId}/preview`,
          }),
          { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '5' } },
        );
      });

      try {
        await client.getCameraPreview('test-token', validSiteId, validCameraId);
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe('http');
        expect(apiErr.status).toBe(429);
        expect(apiErr.retryAfterSeconds).toBe(5);
      }
    });

    it('cancels request when AbortSignal triggers', async () => {
      const controller = new AbortController();
      globalThis.fetch = vi.fn().mockImplementation(async (_url, init?: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      });

      const promise = client.getCameraPreview('test-token', validSiteId, validCameraId, {
        signal: controller.signal,
      });
      controller.abort();

      await expect(promise).rejects.toThrow(ApiError);
      try {
        await promise;
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).code).toBe('cancelled');
      }
    });
  });
});
