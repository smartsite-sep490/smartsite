// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import {
  ApiError,
  SmartSiteManagementClient,
} from '@smartsite/api-client';
import { useScopedRecordedVideo } from './useScopedRecordedVideo';

const siteA = '11111111-1111-4111-8111-111111111111';
const cameraA = '22222222-2222-4222-8222-222222222222';
const cameraB = '33333333-3333-4333-8333-333333333333';

describe('useScopedRecordedVideo', () => {
  let mockClient: SmartSiteManagementClient;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  let createdUrls: string[] = [];
  let revokedUrls: string[] = [];

  beforeEach(() => {
    createdUrls = [];
    revokedUrls = [];

    URL.createObjectURL = vi.fn().mockImplementation((blob: Blob) => {
      expect(blob).toBeInstanceOf(Blob);
      const url = `blob:http://localhost:3000/${Math.random().toString(36).substring(7)}`;
      createdUrls.push(url);
      return url;
    });

    URL.revokeObjectURL = vi.fn().mockImplementation((url: string) => {
      revokedUrls.push(url);
    });

    mockClient = new SmartSiteManagementClient('http://localhost:3000');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  });

  it.each([401, 403])('retains HTTP %i denial through manual retry, visibility and enable changes', async (status) => {
    const read = vi.spyOn(mockClient, 'readRecordedCameraVideo')
      .mockRejectedValue(new ApiError('http', 'Access denied', status));
    const { result, rerender } = renderHook(({ enabled, token }) => useScopedRecordedVideo({
      client: mockClient, token, enabled, sessionScope: 'scope-1', siteId: siteA,
      cameraId: cameraA, cameraExternalId: 'CAM-01', isRecorded: true,
    }), { initialProps: { enabled: true, token: 'old-token' } });
    await act(async () => {});
    act(() => result.current.retry());
    await act(async () => {});
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    rerender({ enabled: false, token: 'old-token' });
    rerender({ enabled: true, token: 'old-token' });
    await act(async () => {});
    expect(read).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('HALTED');
    expect(result.current.errorStatus).toBe(status);
    read.mockImplementation(() => new Promise(() => {}));
    rerender({ enabled: true, token: 'new-token' });
    expect(read).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('LOADING');
    expect(result.current.errorStatus).toBeNull();
  });

  it('does not restart a video download when retry is clicked during loading', () => {
    const read = vi.spyOn(mockClient, 'readRecordedCameraVideo').mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useScopedRecordedVideo({
      client: mockClient, token: 'token', sessionScope: 'scope', siteId: siteA,
      cameraId: cameraA, cameraExternalId: 'CAM-01', isRecorded: true,
    }));
    act(() => result.current.retry());
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('clears and revokes old video on the first render when the API adapter changes', async () => {
    vi.spyOn(mockClient, 'readRecordedCameraVideo').mockResolvedValue(new Blob(['video'], { type: 'video/mp4' }));
    const replacement = new SmartSiteManagementClient('http://localhost:3000');
    vi.spyOn(replacement, 'readRecordedCameraVideo').mockImplementation(() => new Promise(() => {}));
    const renderedUrls: (string | null)[] = [];
    const { result, rerender } = renderHook(({ client }) => {
      const video = useScopedRecordedVideo({
        client, token: 'token', sessionScope: 'scope', siteId: siteA,
        cameraId: cameraA, cameraExternalId: 'CAM-01', isRecorded: true,
      });
      renderedUrls.push(video.videoUrl);
      return video;
    }, { initialProps: { client: mockClient } });
    await act(async () => {});
    const oldUrl = result.current.videoUrl;
    expect(oldUrl).not.toBeNull();
    renderedUrls.length = 0;
    rerender({ client: replacement });
    expect(renderedUrls.length).toBeGreaterThan(0);
    expect(renderedUrls.every((url) => url === null)).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(oldUrl);
    expect(result.current.status).toBe('LOADING');
  });

  it('starts in IDLE status when scope or enabled is incomplete', () => {
    const { result } = renderHook(() =>
      useScopedRecordedVideo({
        client: mockClient,
        token: null,
        sessionScope: null,
        siteId: null,
        cameraId: null,
        cameraExternalId: null,
        isRecorded: true,
        enabled: true,
      }),
    );

    expect(result.current.status).toBe('IDLE');
    expect(result.current.videoUrl).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('requires cameraExternalId for scope readiness and remains in IDLE without it', () => {
    const readSpy = vi.spyOn(mockClient, 'readRecordedCameraVideo');

    const { result } = renderHook(() =>
      useScopedRecordedVideo({
        client: mockClient,
        token: 'token-abc',
        sessionScope: 'scope-1',
        siteId: siteA,
        cameraId: cameraA,
        cameraExternalId: null,
        isRecorded: true,
        enabled: true,
      }),
    );

    expect(result.current.status).toBe('IDLE');
    expect(readSpy).not.toHaveBeenCalled();
  });

  it('remains in IDLE when isRecorded is false even if enabled and credentials provided', () => {
    const readSpy = vi.spyOn(mockClient, 'readRecordedCameraVideo');

    const { result } = renderHook(() =>
      useScopedRecordedVideo({
        client: mockClient,
        token: 'token-abc',
        sessionScope: 'scope-1',
        siteId: siteA,
        cameraId: cameraA,
        cameraExternalId: 'core5-recorded-demo',
        isRecorded: false,
        enabled: true,
      }),
    );

    expect(result.current.status).toBe('IDLE');
    expect(readSpy).not.toHaveBeenCalled();
  });

  it('fetches recorded video and sets status to READY with valid object URL', async () => {
    const fakeBlob = new Blob([new Uint8Array(500)], { type: 'video/mp4' });
    vi.spyOn(mockClient, 'readRecordedCameraVideo').mockResolvedValue(fakeBlob);

    const { result } = renderHook(() =>
      useScopedRecordedVideo({
        client: mockClient,
        token: 'token-abc',
        sessionScope: 'scope-1',
        siteId: siteA,
        cameraId: cameraA,
        cameraExternalId: 'core5-recorded-demo',
        isRecorded: true,
        enabled: true,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.status).toBe('READY');
    expect(result.current.videoUrl).not.toBeNull();
    expect(result.current.videoUrl).toMatch(/^blob:/);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledWith(fakeBlob);
  });

  it('revokes object URL on unmount to prevent memory leaks', async () => {
    const fakeBlob = new Blob([new Uint8Array(500)], { type: 'video/mp4' });
    vi.spyOn(mockClient, 'readRecordedCameraVideo').mockResolvedValue(fakeBlob);

    const { result, unmount } = renderHook(() =>
      useScopedRecordedVideo({
        client: mockClient,
        token: 'token-abc',
        sessionScope: 'scope-1',
        siteId: siteA,
        cameraId: cameraA,
        cameraExternalId: 'core5-recorded-demo',
        isRecorded: true,
        enabled: true,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    const activeUrl = result.current.videoUrl;
    expect(activeUrl).not.toBeNull();

    unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(activeUrl);
    expect(revokedUrls).toContain(activeUrl);
  });

  it('synchronously clears videoUrl on camera change and revokes previous object URL', async () => {
    const fakeBlob1 = new Blob([new Uint8Array(100)], { type: 'video/mp4' });
    const fakeBlob2 = new Blob([new Uint8Array(200)], { type: 'video/mp4' });

    vi.spyOn(mockClient, 'readRecordedCameraVideo')
      .mockResolvedValueOnce(fakeBlob1)
      .mockResolvedValueOnce(fakeBlob2);

    let currentCameraId = cameraA;
    let currentExternalId = 'core5-recorded-demo';

    const { result, rerender } = renderHook(() =>
      useScopedRecordedVideo({
        client: mockClient,
        token: 'token-abc',
        sessionScope: 'scope-1',
        siteId: siteA,
        cameraId: currentCameraId,
        cameraExternalId: currentExternalId,
        isRecorded: true,
        enabled: true,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    const firstUrl = result.current.videoUrl;
    expect(firstUrl).not.toBeNull();
    expect(result.current.status).toBe('READY');

    // Switch to camera B
    currentCameraId = cameraB;
    currentExternalId = 'helmet-vest-recorded-demo';
    rerender();

    // Synchronously nullified on rerender (scope-bound)
    expect(result.current.videoUrl).toBeNull();
    expect(result.current.status).toBe('LOADING');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(firstUrl);

    // Resolve second camera fetch
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.status).toBe('READY');
    expect(result.current.videoUrl).not.toBeNull();
    expect(result.current.videoUrl).not.toBe(firstUrl);
  });

  it('discards late blob response if scope changed before fetch completed', async () => {
    let resolveFirstFetch: (blob: Blob) => void = () => {};
    let fetchCount = 0;

    vi.spyOn(mockClient, 'readRecordedCameraVideo').mockImplementation(() => {
      fetchCount++;
      if (fetchCount === 1) {
        return new Promise<Blob>((resolve) => {
          resolveFirstFetch = resolve;
        });
      }
      return Promise.resolve(new Blob([new Uint8Array(200)], { type: 'video/mp4' }));
    });

    let currentCameraId = cameraA;
    const { result, rerender } = renderHook(() =>
      useScopedRecordedVideo({
        client: mockClient,
        token: 'token-abc',
        sessionScope: 'scope-1',
        siteId: siteA,
        cameraId: currentCameraId,
        cameraExternalId: 'core5-recorded-demo',
        isRecorded: true,
        enabled: true,
      }),
    );

    // Switch camera before fetch 1 resolves
    currentCameraId = cameraB;
    rerender();

    // Now resolve fetch 1 late
    await act(async () => {
      resolveFirstFetch(new Blob([new Uint8Array(100)], { type: 'video/mp4' }));
    });

    // The late blob must NOT become the active video URL
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.videoUrl).not.toBeNull();
    // Only one URL should have been created (for camera B)
    expect(createdUrls.length).toBe(1);
  });

  it('permanently halts on 401 and dispatches smartsite:session-expired', async () => {
    const expiredListener = vi.fn();
    window.addEventListener('smartsite:session-expired', expiredListener);

    vi.spyOn(mockClient, 'readRecordedCameraVideo').mockRejectedValue(
      new ApiError('http', 'Unauthorized recorded video access', 401),
    );

    const { result } = renderHook(() =>
      useScopedRecordedVideo({
        client: mockClient,
        token: 'bad-token',
        sessionScope: 'scope-1',
        siteId: siteA,
        cameraId: cameraA,
        cameraExternalId: 'core5-recorded-demo',
        isRecorded: true,
        enabled: true,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.status).toBe('HALTED');
    expect(result.current.errorStatus).toBe(401);
    expect(result.current.videoUrl).toBeNull();
    expect(expiredListener).toHaveBeenCalledTimes(1);
    expect((expiredListener.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      sessionScopes: ['scope-1'],
    });

    window.removeEventListener('smartsite:session-expired', expiredListener);
  });

  it('permanently halts on 403 error', async () => {
    vi.spyOn(mockClient, 'readRecordedCameraVideo').mockRejectedValue(
      new ApiError('http', 'Forbidden site camera access', 403),
    );

    const { result } = renderHook(() =>
      useScopedRecordedVideo({
        client: mockClient,
        token: 'token-abc',
        sessionScope: 'scope-1',
        siteId: siteA,
        cameraId: cameraA,
        cameraExternalId: 'core5-recorded-demo',
        isRecorded: true,
        enabled: true,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.status).toBe('HALTED');
    expect(result.current.errorStatus).toBe(403);
    expect(result.current.videoUrl).toBeNull();
  });

  it('pauses and aborts fetch when document becomes hidden', async () => {
    let capturedSignal: AbortSignal | undefined;
    vi.spyOn(mockClient, 'readRecordedCameraVideo').mockImplementation((_token, _siteId, _cameraId, opts) => {
      capturedSignal = opts?.signal;
      return new Promise(() => {});
    });

    renderHook(() =>
      useScopedRecordedVideo({
        client: mockClient,
        token: 'token-abc',
        sessionScope: 'scope-1',
        siteId: siteA,
        cameraId: cameraA,
        cameraExternalId: 'core5-recorded-demo',
        isRecorded: true,
        enabled: true,
      }),
    );

    expect(capturedSignal?.aborted).toBe(false);

    // Document hidden
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(capturedSignal?.aborted).toBe(true);
  });
});
