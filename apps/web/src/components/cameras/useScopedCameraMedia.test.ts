// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import {
  ApiError,
  SmartSiteManagementClient,
  type CameraMediaFrame,
} from '@smartsite/api-client';
import { useScopedCameraMedia } from './useScopedCameraMedia';

const siteA = '11111111-1111-4111-8111-111111111111';
const cameraA = '22222222-2222-4222-8222-222222222222';
const cameraB = '33333333-3333-4333-8333-333333333333';

const createFakeMediaFrame = (
  overrides?: Partial<CameraMediaFrame>,
): CameraMediaFrame => ({
  type: 'media-frame',
  mediaVersion: 1,
  cameraExternalId: 'CAM-01',
  sessionId: '00000000-0000-4000-8000-000000000001',
  sequenceNumber: '1',
  capturedAt: new Date().toISOString(),
  width: 640,
  height: 480,
  imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
  ...overrides,
});

describe('useScopedCameraMedia', () => {
  let mockClient: SmartSiteManagementClient;
  const originalImage = globalThis.Image;

  beforeEach(() => {
    vi.useFakeTimers();
    mockClient = new SmartSiteManagementClient('http://localhost:3000');

    class MockImage {
      src = '';
      naturalWidth = 640;
      naturalHeight = 480;
      decode() {
        return Promise.resolve();
      }
    }
    globalThis.Image = MockImage as unknown as typeof Image;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    globalThis.Image = originalImage;
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  });

  it('starts in IDLE status when scope or enabled is incomplete', () => {
    const { result } = renderHook(() =>
      useScopedCameraMedia({
        client: mockClient,
        token: null,
        sessionScope: null,
        siteId: null,
        cameraId: null,
        cameraExternalId: null,
        isLive: true,
        enabled: true,
      }),
    );

    expect(result.current.status).toBe('IDLE');
    expect(result.current.image).toBeNull();
    expect(result.current.frame).toBeNull();
    expect(result.current.isStreaming).toBe(false);
  });

  it('requires cameraExternalId for scope readiness and remains in IDLE without it', () => {
    const streamSpy = vi.spyOn(mockClient, 'streamCameraVideo');

    const { result } = renderHook(() =>
      useScopedCameraMedia({
        client: mockClient,
        token: 'token-abc',
        sessionScope: 'scope-1',
        siteId: siteA,
        cameraId: cameraA,
        cameraExternalId: null, // missing externalId
        isLive: true,
        enabled: true,
      }),
    );

    expect(result.current.status).toBe('IDLE');
    expect(streamSpy).not.toHaveBeenCalled();
  });

  it('remains in IDLE status when isLive is false even if enabled and externalId is provided', () => {
    const streamSpy = vi.spyOn(mockClient, 'streamCameraVideo');

    const { result } = renderHook(() =>
      useScopedCameraMedia({
        client: mockClient,
        token: 'token-abc',
        sessionScope: 'scope-1',
        siteId: siteA,
        cameraId: cameraA,
        cameraExternalId: 'CAM-01',
        isLive: false,
        enabled: true,
      }),
    );

    expect(result.current.status).toBe('IDLE');
    expect(streamSpy).not.toHaveBeenCalled();
  });

  it('connects to raw NDJSON stream when scope is ready and sets LIVE status on valid frame', async () => {
    let capturedCallback: ((frame: CameraMediaFrame) => void) | undefined;
    vi.spyOn(mockClient, 'streamCameraVideo').mockImplementation(
      async (_token, _siteId, _cameraId, onFrame) => {
        capturedCallback = onFrame;
        return new Promise(() => {});
      },
    );

    const { result } = renderHook(() =>
      useScopedCameraMedia({
        client: mockClient,
        token: 'token-abc',
        sessionScope: 'scope-1',
        siteId: siteA,
        cameraId: cameraA,
        cameraExternalId: 'CAM-01',
        isLive: true,
        enabled: true,
      }),
    );

    expect(result.current.status).toBe('CONNECTING');
    expect(capturedCallback).toBeDefined();

    const fakeFrame = createFakeMediaFrame({ sequenceNumber: '10' });
    await act(async () => {
      capturedCallback!(fakeFrame);
    });

    expect(result.current.status).toBe('LIVE');
    expect(result.current.isStreaming).toBe(true);
    expect(result.current.frame).toEqual(fakeFrame);
    expect(result.current.image).not.toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('rejects frame and sets UNAVAILABLE when decoded image dimensions mismatch metadata', async () => {
    class MismatchedImage {
      src = '';
      naturalWidth = 320; // metadata says 640
      naturalHeight = 240;
      decode() {
        return Promise.resolve();
      }
    }
    globalThis.Image = MismatchedImage as unknown as typeof Image;

    let capturedCallback: ((frame: CameraMediaFrame) => void) | undefined;
    vi.spyOn(mockClient, 'streamCameraVideo').mockImplementation(
      async (_token, _siteId, _cameraId, onFrame) => {
        capturedCallback = onFrame;
        return new Promise(() => {});
      },
    );

    const { result } = renderHook(() =>
      useScopedCameraMedia({
        client: mockClient,
        token: 'token-abc',
        sessionScope: 'scope-1',
        siteId: siteA,
        cameraId: cameraA,
        cameraExternalId: 'CAM-01',
        isLive: true,
        enabled: true,
      }),
    );

    await act(async () => {
      capturedCallback!(createFakeMediaFrame({ width: 640, height: 480 }));
    });

    expect(result.current.status).toBe('UNAVAILABLE');
    expect(result.current.image).toBeNull();
    expect(result.current.error).toContain('do not match metadata');
  });

  it('TTL uses remaining capture lifetime, not flat 2000ms after decoding', async () => {
    const fixedNow = 1_700_000_000_000;
    let currentTime = fixedNow;
    const nowFn = () => currentTime;

    let capturedCallback: ((frame: CameraMediaFrame) => void) | undefined;
    vi.spyOn(mockClient, 'streamCameraVideo').mockImplementation(
      async (_token, _siteId, _cameraId, onFrame) => {
        capturedCallback = onFrame;
        return new Promise(() => {});
      },
    );

    const { result } = renderHook(() =>
      useScopedCameraMedia({
        client: mockClient,
        token: 'token-abc',
        sessionScope: 'scope-1',
        siteId: siteA,
        cameraId: cameraA,
        cameraExternalId: 'CAM-01',
        isLive: true,
        enabled: true,
        now: nowFn,
      }),
    );

    // Frame was captured 800ms ago. Remaining TTL is 2000 - 800 = 1200ms
    const frameWithAge = createFakeMediaFrame({
      sequenceNumber: '1',
      capturedAt: new Date(fixedNow - 800).toISOString(),
    });

    await act(async () => {
      capturedCallback!(frameWithAge);
    });

    expect(result.current.status).toBe('LIVE');
    expect(result.current.image).not.toBeNull();

    // Advance 1000ms: total age is 1800ms < 2000ms -> still LIVE
    currentTime += 1000;
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.status).toBe('LIVE');

    // Advance remaining 300ms (total age 2100ms >= 2000ms) -> TTL expires and marks STALLED
    currentTime += 300;
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current.status).toBe('STALLED');
    expect(result.current.image).toBeNull();
    expect(result.current.frame).toBeNull();
  });

  it('TTL invalidates in-flight decoding when timer expires', async () => {
    const fixedNow = 1_700_000_000_000;
    let currentTime = fixedNow;
    const nowFn = () => currentTime;

    let resolveSlowDecode: () => void = () => {};
    class SlowImage {
      src = '';
      naturalWidth = 640;
      naturalHeight = 480;
      decode() {
        return new Promise<void>((resolve) => {
          resolveSlowDecode = resolve;
        });
      }
    }
    globalThis.Image = SlowImage as unknown as typeof Image;

    let capturedCallback: ((frame: CameraMediaFrame) => void) | undefined;
    vi.spyOn(mockClient, 'streamCameraVideo').mockImplementation(
      async (_token, _siteId, _cameraId, onFrame) => {
        capturedCallback = onFrame;
        return new Promise(() => {});
      },
    );

    const { result } = renderHook(() =>
      useScopedCameraMedia({
        client: mockClient,
        token: 'token-abc',
        sessionScope: 'scope-1',
        siteId: siteA,
        cameraId: cameraA,
        cameraExternalId: 'CAM-01',
        isLive: true,
        enabled: true,
        now: nowFn,
      }),
    );

    // Frame 1 captured 1600ms ago -> remaining TTL is 400ms
    const frame = createFakeMediaFrame({
      sequenceNumber: '1',
      capturedAt: new Date(fixedNow - 1600).toISOString(),
    });

    act(() => {
      capturedCallback!(frame);
    });

    // Advance 500ms past the 400ms TTL: expires before decode completes
    currentTime += 500;
    act(() => {
      vi.advanceTimersByTime(500);
    });

    // Now resolve slow decode
    await act(async () => {
      resolveSlowDecode();
    });

    // Should NOT be LIVE because in-flight decode was invalidated
    expect(result.current.status).not.toBe('LIVE');
    expect(result.current.image).toBeNull();
  });

  it('single decode job + only newest pending frame: drops older queued frame', async () => {
    let resolveFirstDecode: () => void = () => {};
    let decodeCallCount = 0;
    class QueuedImage {
      src = '';
      naturalWidth = 640;
      naturalHeight = 480;
      decode() {
        decodeCallCount++;
        if (decodeCallCount === 1) {
          return new Promise<void>((resolve) => {
            resolveFirstDecode = resolve;
          });
        }
        return Promise.resolve();
      }
    }
    globalThis.Image = QueuedImage as unknown as typeof Image;

    let capturedCallback: ((frame: CameraMediaFrame) => void) | undefined;
    vi.spyOn(mockClient, 'streamCameraVideo').mockImplementation(
      async (_token, _siteId, _cameraId, onFrame) => {
        capturedCallback = onFrame;
        return new Promise(() => {});
      },
    );

    const { result } = renderHook(() =>
      useScopedCameraMedia({
        client: mockClient,
        token: 'token-abc',
        sessionScope: 'scope-1',
        siteId: siteA,
        cameraId: cameraA,
        cameraExternalId: 'CAM-01',
        isLive: true,
        enabled: true,
      }),
    );

    // Frame 1 arrives and starts decoding (held by promise)
    act(() => {
      capturedCallback!(createFakeMediaFrame({ sequenceNumber: '1' }));
    });

    // While Frame 1 is decoding, Frame 2 arrives then Frame 3 arrives
    act(() => {
      capturedCallback!(createFakeMediaFrame({ sequenceNumber: '2' }));
      capturedCallback!(createFakeMediaFrame({ sequenceNumber: '3' }));
    });

    // Complete Frame 1
    await act(async () => {
      resolveFirstDecode();
    });

    // Frame 2 was dropped, Frame 3 was decoded and committed
    expect(result.current.frame?.sequenceNumber).toBe('3');
    expect(decodeCallCount).toBe(2); // Only 1 and 3 decoded, 2 skipped
  });

  it('post-decode monotonic check: older slow decode never overwrites newer frame', async () => {
    let resolveDecode1: () => void = () => {};
    let resolveDecode2: () => void = () => {};
    let callIndex = 0;

    class MultiImage {
      src = '';
      naturalWidth = 640;
      naturalHeight = 480;
      decode() {
        callIndex++;
        const current = callIndex;
        return new Promise<void>((resolve) => {
          if (current === 1) resolveDecode1 = resolve;
          if (current === 2) resolveDecode2 = resolve;
        });
      }
    }
    globalThis.Image = MultiImage as unknown as typeof Image;

    let capturedCallback: ((frame: CameraMediaFrame) => void) | undefined;
    vi.spyOn(mockClient, 'streamCameraVideo').mockImplementation(
      async (_token, _siteId, _cameraId, onFrame) => {
        capturedCallback = onFrame;
        return new Promise(() => {});
      },
    );

    const { result } = renderHook(() =>
      useScopedCameraMedia({
        client: mockClient,
        token: 'token-abc',
        sessionScope: 'scope-1',
        siteId: siteA,
        cameraId: cameraA,
        cameraExternalId: 'CAM-01',
        isLive: true,
        enabled: true,
      }),
    );

    // Frame 1 arrives
    act(() => {
      capturedCallback!(createFakeMediaFrame({ sequenceNumber: '10' }));
    });

    // Frame 2 arrives
    act(() => {
      capturedCallback!(createFakeMediaFrame({ sequenceNumber: '20' }));
    });

    // Frame 1 finishes decoding first, setting sequence 10
    await act(async () => {
      resolveDecode1();
    });
    expect(result.current.frame?.sequenceNumber).toBe('10');

    // Frame 2 finishes decoding, updating to sequence 20
    await act(async () => {
      resolveDecode2();
    });
    expect(result.current.frame?.sequenceNumber).toBe('20');
  });

  it('rechecks capturedAt age after decode: discards frame if it became stale during slow decode', async () => {
    const fixedNow = 1_700_000_000_000;
    let currentTime = fixedNow;
    const nowFn = () => currentTime;

    let resolveDecode: () => void = () => {};
    class VerySlowImage {
      src = '';
      naturalWidth = 640;
      naturalHeight = 480;
      decode() {
        return new Promise<void>((resolve) => {
          resolveDecode = resolve;
        });
      }
    }
    globalThis.Image = VerySlowImage as unknown as typeof Image;

    let capturedCallback: ((frame: CameraMediaFrame) => void) | undefined;
    vi.spyOn(mockClient, 'streamCameraVideo').mockImplementation(
      async (_token, _siteId, _cameraId, onFrame) => {
        capturedCallback = onFrame;
        return new Promise(() => {});
      },
    );

    const { result } = renderHook(() =>
      useScopedCameraMedia({
        client: mockClient,
        token: 'token-abc',
        sessionScope: 'scope-1',
        siteId: siteA,
        cameraId: cameraA,
        cameraExternalId: 'CAM-01',
        isLive: true,
        enabled: true,
        now: nowFn,
      }),
    );

    // Frame captured 1500ms ago (fresh <2000ms at arrival)
    const frame = createFakeMediaFrame({
      sequenceNumber: '1',
      capturedAt: new Date(fixedNow - 1500).toISOString(),
    });

    act(() => {
      capturedCallback!(frame);
    });

    // Decode took 600ms; time advances, so now age is 1500 + 600 = 2100ms (>= 2000ms)
    currentTime += 600;

    await act(async () => {
      resolveDecode();
    });

    // Stale after decode -> not committed
    expect(result.current.status).not.toBe('LIVE');
    expect(result.current.image).toBeNull();
    expect(result.current.frame).toBeNull();
  });

  it('synchronously clears returned pixels on camera change so old camera image never appears for a render before effect runs', async () => {
    let capturedCallback: ((frame: CameraMediaFrame) => void) | undefined;
    vi.spyOn(mockClient, 'streamCameraVideo').mockImplementation(
      async (_token, _siteId, _cameraId, onFrame) => {
        capturedCallback = onFrame;
        return new Promise(() => {});
      },
    );

    let currentCameraId = cameraA;
    let currentExternalId = 'CAM-01';

    const { result, rerender } = renderHook(() =>
      useScopedCameraMedia({
        client: mockClient,
        token: 'token-abc',
        sessionScope: 'scope-1',
        siteId: siteA,
        cameraId: currentCameraId,
        cameraExternalId: currentExternalId,
        isLive: true,
        enabled: true,
      }),
    );

    await act(async () => {
      capturedCallback!(createFakeMediaFrame({ cameraExternalId: 'CAM-01' }));
    });

    expect(result.current.status).toBe('LIVE');
    expect(result.current.image).not.toBeNull();

    // Switch to cameraB
    currentCameraId = cameraB;
    currentExternalId = 'CAM-02';
    rerender();

    // Synchronously nullified on rerender (scope-bound)
    expect(result.current.image).toBeNull();
    expect(result.current.frame).toBeNull();
  });

  it('clears pixels on the first render when the API adapter changes', async () => {
    let receive: ((frame: CameraMediaFrame) => void) | undefined;
    vi.spyOn(mockClient, 'streamCameraVideo').mockImplementation(async (_token, _site, _camera, onFrame) => {
      receive = onFrame;
      return new Promise(() => {});
    });
    const replacement = new SmartSiteManagementClient('http://localhost:3000');
    vi.spyOn(replacement, 'streamCameraVideo').mockImplementation(() => new Promise(() => {}));
    const renderedImages: (HTMLImageElement | null)[] = [];
    const { result, rerender } = renderHook(({ client }) => {
      const media = useScopedCameraMedia({
        client, token: 'token', sessionScope: 'scope', siteId: siteA,
        cameraId: cameraA, cameraExternalId: 'CAM-01', isLive: true,
      });
      renderedImages.push(media.image);
      return media;
    }, { initialProps: { client: mockClient } });
    await act(async () => receive!(createFakeMediaFrame()));
    expect(result.current.image).not.toBeNull();
    renderedImages.length = 0;
    rerender({ client: replacement });
    expect(renderedImages.length).toBeGreaterThan(0);
    expect(renderedImages.every((image) => image === null)).toBe(true);
    expect(result.current.status).toBe('CONNECTING');
  });

  it('reconnects after graceful stream EOF with bounded reconnect', async () => {
    let streamCallCount = 0;
    vi.spyOn(mockClient, 'streamCameraVideo').mockImplementation(async () => {
      streamCallCount++;
      if (streamCallCount === 1) {
        // First stream resolves gracefully (EOF)
        return Promise.resolve();
      }
      return new Promise(() => {});
    });

    const { result, unmount } = renderHook(() =>
      useScopedCameraMedia({
        client: mockClient,
        token: 'token-abc',
        sessionScope: 'scope-1',
        siteId: siteA,
        cameraId: cameraA,
        cameraExternalId: 'CAM-01',
        isLive: true,
        enabled: true,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.status).toBe('UNAVAILABLE');
    expect(result.current.error).toContain('EOF');
    expect(streamCallCount).toBe(1);

    // Advance 1000ms reconnect delay
    act(() => {
      vi.advanceTimersByTime(1100);
    });

    expect(streamCallCount).toBe(2);
    unmount();
  });

  it('permanently halts on 401 error and dispatches smartsite:session-expired event', async () => {
    const expiredListener = vi.fn();
    window.addEventListener('smartsite:session-expired', expiredListener);

    vi.spyOn(mockClient, 'streamCameraVideo').mockRejectedValue(
      new ApiError('http', 'Unauthorized camera stream', 401),
    );

    const { result } = renderHook(() =>
      useScopedCameraMedia({
        client: mockClient,
        token: 'bad-token',
        sessionScope: 'scope-1',
        siteId: siteA,
        cameraId: cameraA,
        cameraExternalId: 'CAM-01',
        isLive: true,
        enabled: true,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.status).toBe('HALTED');
    expect(result.current.errorStatus).toBe(401);
    expect(result.current.image).toBeNull();
    expect(expiredListener).toHaveBeenCalledTimes(1);
    expect((expiredListener.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      sessionScopes: ['scope-1'],
    });

    window.removeEventListener('smartsite:session-expired', expiredListener);
  });

  it('permanently halts on 403 error without reconnecting', async () => {
    const streamSpy = vi
      .spyOn(mockClient, 'streamCameraVideo')
      .mockRejectedValue(new ApiError('http', 'Forbidden site camera access', 403));

    const { result } = renderHook(() =>
      useScopedCameraMedia({
        client: mockClient,
        token: 'token-abc',
        sessionScope: 'scope-1',
        siteId: siteA,
        cameraId: cameraA,
        cameraExternalId: 'CAM-01',
        isLive: true,
        enabled: true,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.status).toBe('HALTED');
    expect(result.current.errorStatus).toBe(403);

    // Advance timer: should NOT reconnect on 403
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(streamSpy).toHaveBeenCalledTimes(1);
  });

  it('honors 429 Retry-After and schedules reconnect after delay', async () => {
    let callCount = 0;
    vi.spyOn(mockClient, 'streamCameraVideo').mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new ApiError('http', 'Too Many Requests', 429, undefined, 3);
      }
      return new Promise(() => {});
    });

    const { result } = renderHook(() =>
      useScopedCameraMedia({
        client: mockClient,
        token: 'token-abc',
        sessionScope: 'scope-1',
        siteId: siteA,
        cameraId: cameraA,
        cameraExternalId: 'CAM-01',
        isLive: true,
        enabled: true,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.status).toBe('UNAVAILABLE');
    expect(result.current.errorStatus).toBe(429);
    expect(callCount).toBe(1);

    // Before 3000ms: no reconnect
    act(() => {
      vi.advanceTimersByTime(2500);
    });
    expect(callCount).toBe(1);

    // At 3000ms: reconnect triggered
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(callCount).toBe(2);
  });

  it('pauses stream when document becomes hidden and does not leak bursts', async () => {
    let capturedSignal: AbortSignal | undefined;
    vi.spyOn(mockClient, 'streamCameraVideo').mockImplementation(
      async (_token, _siteId, _cameraId, _onFrame, opts) => {
        capturedSignal = opts?.signal;
        return new Promise(() => {});
      },
    );

    const { unmount } = renderHook(() =>
      useScopedCameraMedia({
        client: mockClient,
        token: 'token-abc',
        sessionScope: 'scope-1',
        siteId: siteA,
        cameraId: cameraA,
        cameraExternalId: 'CAM-01',
        isLive: true,
        enabled: true,
      }),
    );

    expect(capturedSignal?.aborted).toBe(false);

    // Simulate tab hidden
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(capturedSignal?.aborted).toBe(true);

    // Restore visibility
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(mockClient.streamCameraVideo).toHaveBeenCalledTimes(2);
    unmount();
  });
});
