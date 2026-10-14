import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  SmartSiteManagementClient,
  readRecordedCameraVideo,
  MAX_RECORDED_VIDEO_BYTES,
  ApiError,
} from './index';

describe('readRecordedCameraVideo client transport', () => {
  const originalFetch = globalThis.fetch;
  let client: SmartSiteManagementClient;

  beforeEach(() => {
    client = new SmartSiteManagementClient('http://localhost:3000');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('successfully fetches recorded video blob with Bearer token, no-store, and redirect: error', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    let capturedCache: RequestCache | undefined;
    let capturedRedirect: RequestRedirect | undefined;

    const fakeBlob = new Blob([new Uint8Array(909367)], { type: 'video/mp4' });

    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      capturedUrl = url;
      capturedHeaders = (init?.headers as Record<string, string>) || {};
      capturedCache = init?.cache;
      capturedRedirect = init?.redirect;

      return new Response(fakeBlob, {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '909367',
          'x-camera-external-id': 'core5-recorded-demo',
        },
      });
    });

    const result = await client.readRecordedCameraVideo(
      'secret-auth-token',
      'site-1',
      'cam-1',
      { expectedCameraExternalId: 'core5-recorded-demo' },
    );

    // Verify URL does NOT leak token or query parameters
    expect(capturedUrl).toBe('http://localhost:3000/api/v1/sites/site-1/cameras/cam-1/recorded-video');
    expect(capturedUrl).not.toContain('token');
    expect(capturedUrl).not.toContain('?');

    // Verify security & caching headers
    expect(capturedHeaders['Authorization']).toBe('Bearer secret-auth-token');
    expect(capturedHeaders['Accept']).toBe('video/mp4');
    expect(capturedCache).toBe('no-store');
    expect(capturedRedirect).toBe('error');

    // Verify returned Blob
    expect(result.size).toBe(909367);
    expect(result.type).toBe('video/mp4');
  });

  it('standalone helper function works identically to client method', async () => {
    const fakeBlob = new Blob([new Uint8Array(1024)], { type: 'video/mp4' });
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(fakeBlob, {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
        },
      }),
    );

    const result = await readRecordedCameraVideo('test-token', 'site-a', 'cam-b');
    expect(result.size).toBe(1024);
    expect(result.type).toBe('video/mp4');
  });

  it('rejects if x-camera-external-id header does not match expectedCameraExternalId', async () => {
    const fakeBlob = new Blob([new Uint8Array(100)], { type: 'video/mp4' });
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(fakeBlob, {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'x-camera-external-id': 'other-camera-id',
        },
      }),
    );

    await expect(
      client.readRecordedCameraVideo('token', 'site-1', 'cam-1', {
        expectedCameraExternalId: 'core5-recorded-demo',
      }),
    ).rejects.toMatchObject({ code: 'invalid-response' });
  });

  it('rejects response with mismatched Content-Type (non-video/mp4)', async () => {
    const fakeHtml = '<html><body>Not a video</body></html>';
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(fakeHtml, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
        },
      }),
    );

    await expect(
      client.readRecordedCameraVideo('token', 'site-1', 'cam-1'),
    ).rejects.toMatchObject({ code: 'invalid-response' });
  });

  it('rejects when Content-Length exceeds maximum limit of 2,000,000 bytes', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(new Blob([new Uint8Array(10)]), {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Length': '2500000',
        },
      }),
    );

    await expect(
      client.readRecordedCameraVideo('token', 'site-1', 'cam-1'),
    ).rejects.toMatchObject({ code: 'invalid-response' });
  });

  it('rejects when Blob size exceeds maximum limit of 2,000,000 bytes', async () => {
    const largeBlob = new Blob([new Uint8Array(MAX_RECORDED_VIDEO_BYTES + 1)], {
      type: 'video/mp4',
    });

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(largeBlob, {
        status: 200,
        headers: {
          'Content-Type': 'video/mp4',
        },
      }),
    );

    await expect(
      client.readRecordedCameraVideo('token', 'site-1', 'cam-1'),
    ).rejects.toMatchObject({ code: 'invalid-response' });
  });

  it('cancels immediately when caller signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      client.readRecordedCameraVideo('token', 'site-1', 'cam-1', {
        signal: controller.signal,
      }),
    ).rejects.toThrow(/Recorded camera video request cancelled/);
  });

  it('cancels and cleans up listener when caller aborts in-flight request', async () => {
    const controller = new AbortController();

    globalThis.fetch = vi.fn().mockImplementation((_url, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The user aborted a request.', 'AbortError'));
        });
      });
    });

    const promise = client.readRecordedCameraVideo('token', 'site-1', 'cam-1', {
      signal: controller.signal,
    });

    controller.abort();

    await expect(promise).rejects.toThrow(/Recorded camera video request cancelled/);
  });

  it('times out after specified timeoutMs', async () => {
    vi.useFakeTimers();

    globalThis.fetch = vi.fn().mockImplementation((_url, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('The user aborted a request.', 'AbortError'));
        });
      });
    });

    const promise = client.readRecordedCameraVideo('token', 'site-1', 'cam-1', {
      timeoutMs: 1500,
    });

    vi.advanceTimersByTime(1550);

    await expect(promise).rejects.toThrow(/Recorded video request timed out after 1500ms/);

    vi.useRealTimers();
  });

  it('handles 401 Unauthorized HTTP error with ApiError', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Session expired' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    try {
      await client.readRecordedCameraVideo('token', 'site-1', 'cam-1');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(401);
    }
  });

  it('handles 429 Too Many Requests with Retry-After', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Rate limit exceeded' }), {
        status: 429,
        headers: {
          'Content-Type': 'application/json',
          'Retry-After': '5',
        },
      }),
    );

    try {
      await client.readRecordedCameraVideo('token', 'site-1', 'cam-1');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(429);
      expect(apiErr.retryAfterSeconds).toBe(5);
    }
  });
});
