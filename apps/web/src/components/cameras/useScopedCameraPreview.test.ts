// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ApiError,
  SmartSiteManagementClient,
  type CameraPreviewResponse,
} from '@smartsite/api-client';
import { useScopedCameraPreview, resolveSafeCadence } from './useScopedCameraPreview';

const siteA = '11111111-1111-4111-8111-111111111111';
const cameraA = '22222222-2222-4222-8222-222222222222';
const cameraB = '33333333-3333-4333-8333-333333333333';

const createFakeResponse = (
  siteId = siteA,
  cameraId = cameraA,
  cameraExternalId = 'CAM-01',
  sourceKind: 'LIVE' | 'REPLAY' = 'LIVE',
  capturedAt = new Date().toISOString(),
  sequenceNumber = '1',
  sessionId = '44444444-4444-4444-8444-444444444444',
): CameraPreviewResponse => ({
  siteId,
  cameraId,
  cameraExternalId,
  sourceKind,
  frame: {
    type: 'frame',
    previewVersion: 1,
    cameraExternalId,
    sessionId,
    sequenceNumber,
    capturedAt,
    width: 640,
    height: 480,
    imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
    detections: [],
    zoneDetections: [],
    zonePolygons: [],
  },
});

function createWrapper(
  queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  }),
) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

describe('useScopedCameraPreview', () => {
  let mockClient: SmartSiteManagementClient;
  const originalImage = globalThis.Image;

  beforeEach(() => {
    mockClient = new SmartSiteManagementClient('http://localhost:3000');
    // Mock HTMLImageElement decode in jsdom
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
  });

  it('stays UNAVAILABLE when token, siteId or cameraId is missing', () => {
    const getPreviewSpy = vi.spyOn(mockClient, 'getCameraPreview');
    const { result } = renderHook(
      () =>
        useScopedCameraPreview({
          client: mockClient,
          token: null,
          sessionScope: 'user-1',
          siteId: null,
          cameraId: null,
        }),
      { wrapper: createWrapper() },
    );

    expect(result.current.status).toBe('UNAVAILABLE');
    expect(result.current.preview).toBeNull();
    expect(getPreviewSpy).not.toHaveBeenCalled();
  });

  it('calls getCameraPreview with Bearer token, siteId, cameraId, AbortSignal and timeoutMs 3000', async () => {
    const nowTime = 1700000000000;
    const response = createFakeResponse(
      siteA,
      cameraA,
      'CAM-01',
      'LIVE',
      new Date(nowTime).toISOString(),
      '1',
    );
    const getPreviewSpy = vi.spyOn(mockClient, 'getCameraPreview').mockResolvedValueOnce(response);

    const { result } = renderHook(
      () =>
        useScopedCameraPreview({
          client: mockClient,
          token: 'token-abc',
          sessionScope: 'user-1',
          siteId: siteA,
          cameraId: cameraA,
          now: () => nowTime,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.status).toBe('LIVE'));
    expect(getPreviewSpy).toHaveBeenCalledWith(
      'token-abc',
      siteA,
      cameraA,
      expect.objectContaining({ signal: expect.any(AbortSignal), timeoutMs: 3000 }),
    );
    expect(result.current.cameraExternalId).toBe('CAM-01');
    expect(result.current.sourceKind).toBe('LIVE');
    expect(result.current.preview).not.toBeNull();
  });

  it('synchronously gates returned pixels so camera A cannot flash under camera B', async () => {
    const nowTime = 1700000000000;
    const respA = createFakeResponse(
      siteA,
      cameraA,
      'CAM-01',
      'LIVE',
      new Date(nowTime).toISOString(),
      '1',
    );
    const respB = createFakeResponse(
      siteA,
      cameraB,
      'CAM-02',
      'LIVE',
      new Date(nowTime).toISOString(),
      '2',
    );

    vi.spyOn(mockClient, 'getCameraPreview').mockImplementation(async (_token, _site, cam) => {
      if (cam === cameraA) return respA;
      return respB;
    });

    const wrapper = createWrapper();
    const { result, rerender } = renderHook(
      ({ camId }) =>
        useScopedCameraPreview({
          client: mockClient,
          token: 'token-abc',
          sessionScope: 'user-1',
          siteId: siteA,
          cameraId: camId,
          now: () => nowTime,
        }),
      { initialProps: { camId: cameraA }, wrapper },
    );

    await waitFor(() => expect(result.current.status).toBe('LIVE'));
    expect(result.current.cameraExternalId).toBe('CAM-01');

    // Switch to camera B: synchronously on render, camera A pixels must NOT be returned
    rerender({ camId: cameraB });
    expect(result.current.preview).toBeNull();
    expect(result.current.cameraExternalId).toBeNull();

    await waitFor(() => expect(result.current.status).toBe('LIVE'));
    expect(result.current.cameraExternalId).toBe('CAM-02');
  });

  it('drops out-of-order decode when camera switches from A to B and A finishes late', async () => {
    const nowTime = 1700000000000;
    let finishDecodeA!: () => void;
    class ControlledImage {
      src = '';
      naturalWidth = 640;
      naturalHeight = 480;
      decode() {
        if (this.src.includes('cameraA')) {
          return new Promise<void>((resolve) => {
            finishDecodeA = resolve;
          });
        }
        return Promise.resolve();
      }
    }
    globalThis.Image = ControlledImage as unknown as typeof Image;

    const respA = createFakeResponse(
      siteA,
      cameraA,
      'CAM-01',
      'LIVE',
      new Date(nowTime).toISOString(),
      '1',
    );
    respA.frame.imageDataUrl = 'data:image/jpeg;base64,cameraA';

    const respB = createFakeResponse(
      siteA,
      cameraB,
      'CAM-02',
      'LIVE',
      new Date(nowTime).toISOString(),
      '2',
    );
    respB.frame.imageDataUrl = 'data:image/jpeg;base64,cameraB';

    vi.spyOn(mockClient, 'getCameraPreview').mockImplementation(async (_token, _site, cam) => {
      if (cam === cameraA) return respA;
      return respB;
    });

    const wrapper = createWrapper();
    const { result, rerender } = renderHook(
      ({ camId }) =>
        useScopedCameraPreview({
          client: mockClient,
          token: 'token-abc',
          sessionScope: 'user-1',
          siteId: siteA,
          cameraId: camId,
          now: () => nowTime,
        }),
      { initialProps: { camId: cameraA }, wrapper },
    );

    // Switch camera to B before A finishes decode
    rerender({ camId: cameraB });
    await waitFor(() => expect(result.current.cameraExternalId).toBe('CAM-02'));

    // Now A finishes decode late
    if (finishDecodeA) finishDecodeA();
    await new Promise((r) => setTimeout(r, 20));

    // Must still be CAM-02, camera A decode must NOT commit as camera B
    expect(result.current.cameraExternalId).toBe('CAM-02');
    expect(result.current.preview?.frame.cameraExternalId).toBe('CAM-02');
  });

  it('drops late decode if query encounters an error before decode completes (late decode after error)', async () => {
    const nowTime = 1700000000000;
    let finishDecode!: () => void;
    class ControlledImage {
      src = '';
      naturalWidth = 640;
      naturalHeight = 480;
      decode() {
        return new Promise<void>((resolve) => {
          finishDecode = resolve;
        });
      }
    }
    globalThis.Image = ControlledImage as unknown as typeof Image;

    const resp = createFakeResponse(
      siteA,
      cameraA,
      'CAM-01',
      'LIVE',
      new Date(nowTime).toISOString(),
      '1',
    );
    const getPreviewSpy = vi
      .spyOn(mockClient, 'getCameraPreview')
      .mockResolvedValueOnce(resp)
      .mockRejectedValueOnce(new ApiError('http', 'Service Unavailable', 503));

    const { result } = renderHook(
      () =>
        useScopedCameraPreview({
          client: mockClient,
          token: 'token-abc',
          sessionScope: 'user-1',
          siteId: siteA,
          cameraId: cameraA,
          now: () => nowTime,
        }),
      { wrapper: createWrapper() },
    );

    // Initial fetch succeeds, decode is pending
    await waitFor(() => expect(getPreviewSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(finishDecode).toBeTypeOf('function'));
    await waitFor(() => expect(result.current.isPolling).toBe(false));
    expect(result.current.preview).toBeNull();

    // Trigger an error while decode is still in-flight
    act(() => result.current.retry());
    // Pending image decode is already unavailable. Wait for the actual failed
    // request before resolving the old decode, rather than that transient state.
    await waitFor(() => expect(result.current.error).toContain('503'));
    expect(result.current.status).toBe('UNAVAILABLE');

    // Now finish decode late
    await act(async () => {
      finishDecode();
      await new Promise((r) => setTimeout(r, 20));
    });

    // Late decode must NOT overwrite the error or publish pixels
    expect(result.current.preview).toBeNull();
    expect(result.current.status).toBe('UNAVAILABLE');
    expect(result.current.error).toContain('503');
  });

  it('drops late decode and isolates cache when backend origin/apiUrl changes (origin switch)', async () => {
    const nowTime = 1700000000000;
    let finishDecodeA!: () => void;
    class ControlledImage {
      src = '';
      naturalWidth = 640;
      naturalHeight = 480;
      decode() {
        if (this.src.includes('originA')) {
          return new Promise<void>((resolve) => {
            finishDecodeA = resolve;
          });
        }
        return Promise.resolve();
      }
    }
    globalThis.Image = ControlledImage as unknown as typeof Image;

    const respOriginA = createFakeResponse(
      siteA,
      cameraA,
      'CAM-ORIGIN-A',
      'LIVE',
      new Date(nowTime).toISOString(),
      '1',
    );
    respOriginA.frame.imageDataUrl = 'data:image/jpeg;base64,originA';

    const respOriginB = createFakeResponse(
      siteA,
      cameraA,
      'CAM-ORIGIN-B',
      'LIVE',
      new Date(nowTime).toISOString(),
      '1',
    );
    respOriginB.frame.imageDataUrl = 'data:image/jpeg;base64,originB';

    const clientA = new SmartSiteManagementClient('http://backend-origin-a:3000');
    const clientB = new SmartSiteManagementClient('http://backend-origin-b:3000');
    vi.spyOn(clientA, 'getCameraPreview').mockResolvedValue(respOriginA);
    vi.spyOn(clientB, 'getCameraPreview').mockResolvedValue(respOriginB);

    const wrapper = createWrapper();
    const { result, rerender } = renderHook(
      ({ apiUrl, client }) =>
        useScopedCameraPreview({
          apiUrl,
          client,
          token: 'token-abc',
          sessionScope: 'user-1',
          siteId: siteA,
          cameraId: cameraA,
          now: () => nowTime,
        }),
      {
        initialProps: {
          apiUrl: 'http://backend-origin-a:3000',
          client: clientA,
        },
        wrapper,
      },
    );

    // Origin A fetch starts and resolves, decode is held pending
    await waitFor(() => expect(clientA.getCameraPreview).toHaveBeenCalled());
    expect(result.current.preview).toBeNull();

    // Switch origin to B while origin A decode is pending
    rerender({
      apiUrl: 'http://backend-origin-b:3000',
      client: clientB,
    });

    // Origin B completes fetch and decode
    await waitFor(() => expect(result.current.cameraExternalId).toBe('CAM-ORIGIN-B'));
    expect(result.current.preview?.frame.cameraExternalId).toBe('CAM-ORIGIN-B');

    // Origin A decode finishes late
    if (finishDecodeA) finishDecodeA();
    await new Promise((r) => setTimeout(r, 20));

    // Preview must still be CAM-ORIGIN-B, origin A decode must NOT overwrite origin B
    expect(result.current.cameraExternalId).toBe('CAM-ORIGIN-B');
    expect(result.current.preview?.frame.cameraExternalId).toBe('CAM-ORIGIN-B');
  });

  it('immediately clears preview and isolates cache upon logout/scope clear (no old pixels retained)', async () => {
    const nowTime = 1700000000000;
    const resp = createFakeResponse(
      siteA,
      cameraA,
      'CAM-01',
      'LIVE',
      new Date(nowTime).toISOString(),
      '1',
    );
    vi.spyOn(mockClient, 'getCameraPreview').mockResolvedValue(resp);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const wrapper = createWrapper(queryClient);

    const { result, rerender } = renderHook(
      ({ token, sessionScope }) =>
        useScopedCameraPreview({
          client: mockClient,
          token,
          sessionScope,
          siteId: siteA,
          cameraId: cameraA,
          now: () => nowTime,
        }),
      {
        initialProps: {
          token: 'token-123' as string | null,
          sessionScope: 'user-1' as string | null,
        },
        wrapper,
      },
    );

    await waitFor(() => expect(result.current.status).toBe('LIVE'));
    expect(result.current.preview).not.toBeNull();

    // User logs out (token and sessionScope set to null)
    rerender({ token: null, sessionScope: null });
    expect(result.current.preview).toBeNull();
    expect(result.current.status).toBe('UNAVAILABLE');
  });

  it('rejects stale frames older than 5 seconds', async () => {
    const nowTime = 1700000010000;
    // Captured 6 seconds ago (> 5s stale)
    const staleCapturedAt = new Date(nowTime - 6000).toISOString();
    const staleResp = createFakeResponse(siteA, cameraA, 'CAM-01', 'LIVE', staleCapturedAt, '1');

    vi.spyOn(mockClient, 'getCameraPreview').mockResolvedValueOnce(staleResp);

    const { result } = renderHook(
      () =>
        useScopedCameraPreview({
          client: mockClient,
          token: 'token-abc',
          sessionScope: 'user-1',
          siteId: siteA,
          cameraId: cameraA,
          now: () => nowTime,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.status).toBe('UNAVAILABLE'));
    expect(result.current.preview).toBeNull();
    expect(result.current.error).toContain('stale');
  });

  it('rejects future frames with capturedAt further than 30 seconds into the future', async () => {
    const nowTime = 1700000000000;
    // Captured 35 seconds in the future (> 30s clock skew)
    const futureCapturedAt = new Date(nowTime + 35000).toISOString();
    const futureResp = createFakeResponse(siteA, cameraA, 'CAM-01', 'LIVE', futureCapturedAt, '1');

    vi.spyOn(mockClient, 'getCameraPreview').mockResolvedValueOnce(futureResp);

    const { result } = renderHook(
      () =>
        useScopedCameraPreview({
          client: mockClient,
          token: 'token-abc',
          sessionScope: 'user-1',
          siteId: siteA,
          cameraId: cameraA,
          now: () => nowTime,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.status).toBe('UNAVAILABLE'));
    expect(result.current.preview).toBeNull();
    expect(result.current.error).toContain('future');
  });

  it('state expiry timer clears preview after 5s when no new frame arrives', async () => {
    vi.useFakeTimers();
    try {
      let currentTime = 1700000000000;
      const resp = createFakeResponse(
        siteA,
        cameraA,
        'CAM-01',
        'LIVE',
        new Date(currentTime).toISOString(),
        '1',
      );
      vi.spyOn(mockClient, 'getCameraPreview').mockResolvedValue(resp);

      const { result } = renderHook(
        () =>
          useScopedCameraPreview({
            client: mockClient,
            token: 'token-abc',
            sessionScope: 'user-1',
            siteId: siteA,
            cameraId: cameraA,
            now: () => currentTime,
          }),
        { wrapper: createWrapper() },
      );

      // Advance initial fetch & decode
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(result.current.status).toBe('LIVE');
      expect(result.current.preview).not.toBeNull();

      // Advance 4900ms (just under 5s expiry)
      currentTime += 4900;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4900);
      });
      expect(result.current.preview).not.toBeNull();
      expect(result.current.status).toBe('LIVE');

      // Advance remaining 200ms (crosses 5s threshold)
      currentTime += 200;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(result.current.preview).toBeNull();
      expect(result.current.status).toBe('UNAVAILABLE');
    } finally {
      vi.useRealTimers();
    }
  });

  it('received frame with future timestamp within 30s still expires after max 5s from receipt', async () => {
    vi.useFakeTimers();
    try {
      let currentTime = 1700000000000;
      // Future capturedAt by +20s (within 30s limit)
      const futureCapturedAt = new Date(currentTime + 20000).toISOString();
      const resp = createFakeResponse(siteA, cameraA, 'CAM-01', 'LIVE', futureCapturedAt, '1');
      vi.spyOn(mockClient, 'getCameraPreview').mockResolvedValue(resp);

      const { result } = renderHook(
        () =>
          useScopedCameraPreview({
            client: mockClient,
            token: 'token-abc',
            sessionScope: 'user-1',
            siteId: siteA,
            cameraId: cameraA,
            now: () => currentTime,
          }),
        { wrapper: createWrapper() },
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(result.current.status).toBe('LIVE');
      expect(result.current.preview).not.toBeNull();

      // Advance 5.1s from receipt (clock skew must NOT extend life to 25s)
      currentTime += 5100;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5100);
      });

      expect(result.current.preview).toBeNull();
      expect(result.current.status).toBe('UNAVAILABLE');
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects lower sequence number frames within same stream session', async () => {
    const nowTime = 1700000000000;
    const sessionId = '44444444-4444-4444-8444-444444444444';
    const resp1 = createFakeResponse(
      siteA,
      cameraA,
      'CAM-01',
      'LIVE',
      new Date(nowTime).toISOString(),
      '10',
    );
    resp1.frame.sessionId = sessionId;
    // Second response has lower sequence number '5' within same stream session
    const resp2 = createFakeResponse(
      siteA,
      cameraA,
      'CAM-01',
      'LIVE',
      new Date(nowTime + 1000).toISOString(),
      '5',
    );
    resp2.frame.sessionId = sessionId;

    vi.spyOn(mockClient, 'getCameraPreview')
      .mockResolvedValueOnce(resp1)
      .mockResolvedValueOnce(resp2);

    const { result } = renderHook(
      () =>
        useScopedCameraPreview({
          client: mockClient,
          token: 'token-abc',
          sessionScope: 'user-1',
          siteId: siteA,
          cameraId: cameraA,
          now: () => nowTime,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.status).toBe('LIVE'));
    expect(result.current.preview?.frame.sequenceNumber).toBe('10');

    result.current.retry();
    await waitFor(() => expect(result.current.error).toContain('Out-of-order sequence number'));
  });

  it('accepts duplicate buffered frame from polling without error and skips duplicate decode', async () => {
    const nowTime = 1700000000000;
    const sessionId = '44444444-4444-4444-8444-444444444444';
    const resp1 = createFakeResponse(
      siteA,
      cameraA,
      'CAM-01',
      'LIVE',
      new Date(nowTime).toISOString(),
      '10',
    );
    resp1.frame.sessionId = sessionId;
    const resp2 = createFakeResponse(
      siteA,
      cameraA,
      'CAM-01',
      'LIVE',
      new Date(nowTime + 500).toISOString(),
      '10',
    );
    resp2.frame.sessionId = sessionId;

    let decodeCalls = 0;
    class CountDecodeImage {
      src = '';
      naturalWidth = 640;
      naturalHeight = 480;
      decode() {
        decodeCalls++;
        return Promise.resolve();
      }
    }
    globalThis.Image = CountDecodeImage as unknown as typeof Image;

    vi.spyOn(mockClient, 'getCameraPreview')
      .mockResolvedValueOnce(resp1)
      .mockResolvedValueOnce(resp2);

    const { result } = renderHook(
      () =>
        useScopedCameraPreview({
          client: mockClient,
          token: 'token-abc',
          sessionScope: 'user-1',
          siteId: siteA,
          cameraId: cameraA,
          now: () => nowTime,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.status).toBe('LIVE'));
    expect(decodeCalls).toBe(1);

    // Poll next (duplicate sequence)
    result.current.retry();
    await waitFor(() => expect(result.current.status).toBe('LIVE'));
    expect(result.current.error).toBeNull();
    expect(decodeCalls).toBe(1);
    expect(result.current.preview).not.toBeNull();
  });

  it('accepts sequence number reset when stream session changes (sequence 1)', async () => {
    const nowTime = 1700000000000;
    const session1 = '44444444-4444-4444-8444-444444444444';
    const session2 = '55555555-5555-4555-8555-555555555555';
    const resp1 = createFakeResponse(
      siteA,
      cameraA,
      'CAM-01',
      'LIVE',
      new Date(nowTime).toISOString(),
      '100',
    );
    resp1.frame.sessionId = session1;
    // New stream session resets to sequence 1 (< 100)
    const resp2 = createFakeResponse(
      siteA,
      cameraA,
      'CAM-01',
      'LIVE',
      new Date(nowTime + 1000).toISOString(),
      '1',
    );
    resp2.frame.sessionId = session2;

    vi.spyOn(mockClient, 'getCameraPreview')
      .mockResolvedValueOnce(resp1)
      .mockResolvedValueOnce(resp2);

    const { result } = renderHook(
      () =>
        useScopedCameraPreview({
          client: mockClient,
          token: 'token-abc',
          sessionScope: 'user-1',
          siteId: siteA,
          cameraId: cameraA,
          now: () => nowTime,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.status).toBe('LIVE'));
    expect(result.current.preview?.frame.sequenceNumber).toBe('100');

    result.current.retry();
    await waitFor(() => expect(result.current.preview?.frame.sequenceNumber).toBe('1'));
    expect(result.current.error).toBeNull();
    expect(result.current.status).toBe('LIVE');
  });

  it('recovers cleanly from 503 error on subsequent successful poll without sticky latch', async () => {
    const nowTime = 1700000000000;
    const resp = createFakeResponse(
      siteA,
      cameraA,
      'CAM-01',
      'LIVE',
      new Date(nowTime).toISOString(),
      '1',
    );

    vi.spyOn(mockClient, 'getCameraPreview')
      .mockRejectedValueOnce(new ApiError('http', 'Service Unavailable', 503))
      .mockResolvedValueOnce(resp);

    const { result } = renderHook(
      () =>
        useScopedCameraPreview({
          client: mockClient,
          token: 'token-abc',
          sessionScope: 'user-1',
          siteId: siteA,
          cameraId: cameraA,
          now: () => nowTime,
        }),
      { wrapper: createWrapper() },
    );

    // Initial attempt fails with 503
    await waitFor(() => expect(result.current.status).toBe('UNAVAILABLE'));
    expect(result.current.error).toContain('503');
    expect(result.current.preview).toBeNull();

    // Subsequent poll succeeds
    result.current.retry();
    await waitFor(() => expect(result.current.status).toBe('LIVE'));
    expect(result.current.error).toBeNull();
    expect(result.current.preview).not.toBeNull();
  });

  it('two simultaneous viewers share query; unmounting viewer 1 does not disrupt viewer 2', async () => {
    const nowTime = 1700000000000;
    const resp = createFakeResponse(
      siteA,
      cameraA,
      'CAM-01',
      'LIVE',
      new Date(nowTime).toISOString(),
      '1',
    );
    vi.spyOn(mockClient, 'getCameraPreview').mockResolvedValue(resp);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    const wrapper = createWrapper(queryClient);

    const viewer1 = renderHook(
      () =>
        useScopedCameraPreview({
          client: mockClient,
          token: 'token-abc',
          sessionScope: 'user-1',
          siteId: siteA,
          cameraId: cameraA,
          now: () => nowTime,
        }),
      { wrapper },
    );

    const viewer2 = renderHook(
      () =>
        useScopedCameraPreview({
          client: mockClient,
          token: 'token-abc',
          sessionScope: 'user-1',
          siteId: siteA,
          cameraId: cameraA,
          now: () => nowTime,
        }),
      { wrapper },
    );

    await waitFor(() => expect(viewer1.result.current.status).toBe('LIVE'));
    await waitFor(() => expect(viewer2.result.current.status).toBe('LIVE'));

    // Viewer 1 unmounts
    viewer1.unmount();

    // Viewer 2 must remain LIVE and unaffected
    expect(viewer2.result.current.status).toBe('LIVE');
    expect(viewer2.result.current.preview).not.toBeNull();
  });

  it('token change immediately invalidates decoded preview even if scope IDs remain same', async () => {
    const nowTime = 1700000000000;
    const resp = createFakeResponse(
      siteA,
      cameraA,
      'CAM-01',
      'LIVE',
      new Date(nowTime).toISOString(),
      '1',
    );
    vi.spyOn(mockClient, 'getCameraPreview').mockResolvedValue(resp);

    const wrapper = createWrapper();
    const { result, rerender } = renderHook(
      ({ token }) =>
        useScopedCameraPreview({
          client: mockClient,
          token,
          sessionScope: 'user-1',
          siteId: siteA,
          cameraId: cameraA,
          now: () => nowTime,
        }),
      { initialProps: { token: 'token-initial' as string | null }, wrapper },
    );

    await waitFor(() => expect(result.current.status).toBe('LIVE'));
    expect(result.current.preview).not.toBeNull();

    // Change token while keeping same sessionScope, siteId, cameraId
    rerender({ token: 'token-refreshed' });

    // Synchronously in render pass, old token's preview must NOT be returned
    expect(result.current.preview).toBeNull();
  });

  it('in-flight request from previous scope does not update streamSeqRef of new scope', async () => {
    const nowTime = 1700000000000;
    let resolveFirstRequest!: (val: CameraPreviewResponse) => void;
    const pendingPromise = new Promise<CameraPreviewResponse>((resolve) => {
      resolveFirstRequest = resolve;
    });

    const respCamA = createFakeResponse(
      siteA,
      cameraA,
      'CAM-01',
      'LIVE',
      new Date(nowTime).toISOString(),
      '100',
    );
    const respCamB = createFakeResponse(
      siteA,
      cameraB,
      'CAM-02',
      'LIVE',
      new Date(nowTime).toISOString(),
      '1',
    );

    vi.spyOn(mockClient, 'getCameraPreview').mockImplementation(async (_token, _site, cam) => {
      if (cam === cameraA) return pendingPromise;
      return respCamB;
    });

    const wrapper = createWrapper();
    const { result, rerender } = renderHook(
      ({ camId }) =>
        useScopedCameraPreview({
          client: mockClient,
          token: 'token-abc',
          sessionScope: 'user-1',
          siteId: siteA,
          cameraId: camId,
          now: () => nowTime,
        }),
      { initialProps: { camId: cameraA }, wrapper },
    );

    // Switch to camera B while camera A request is in-flight
    rerender({ camId: cameraB });
    await waitFor(() => expect(result.current.cameraExternalId).toBe('CAM-02'));

    // Camera A request resolves late
    resolveFirstRequest(respCamA);
    await new Promise((r) => setTimeout(r, 20));

    // Camera B should still have sequence 1, not corrupted by camera A's sequence 100
    expect(result.current.cameraExternalId).toBe('CAM-02');
    expect(result.current.preview?.frame.sequenceNumber).toBe('1');
  });

  it('invalidates when externally injected client instance changes', async () => {
    const nowTime = 1700000000000;
    const client1 = new SmartSiteManagementClient('http://localhost:3000');
    const client2 = new SmartSiteManagementClient('http://localhost:3000');

    const resp = createFakeResponse(
      siteA,
      cameraA,
      'CAM-01',
      'LIVE',
      new Date(nowTime).toISOString(),
      '1',
    );
    vi.spyOn(client1, 'getCameraPreview').mockResolvedValue(resp);
    vi.spyOn(client2, 'getCameraPreview').mockResolvedValue(resp);

    const wrapper = createWrapper();
    const { result, rerender } = renderHook(
      ({ client }) =>
        useScopedCameraPreview({
          client,
          token: 'token-abc',
          sessionScope: 'user-1',
          siteId: siteA,
          cameraId: cameraA,
          now: () => nowTime,
        }),
      { initialProps: { client: client1 }, wrapper },
    );

    await waitFor(() => expect(result.current.status).toBe('LIVE'));
    expect(result.current.preview).not.toBeNull();

    // Rerender with client2 instance
    rerender({ client: client2 });
    // Synchronously, preview from client1 is invalidated
    expect(result.current.preview).toBeNull();
  });

  it('stops polling and clears preview on 401 or 403', async () => {
    vi.useFakeTimers();
    try {
      const getPreviewSpy = vi
        .spyOn(mockClient, 'getCameraPreview')
        .mockRejectedValue(new ApiError('http', 'Forbidden', 403));

      const { result } = renderHook(
        () =>
          useScopedCameraPreview({
            client: mockClient,
            token: 'token-abc',
            sessionScope: 'user-1',
            siteId: siteA,
            cameraId: cameraA,
          }),
        { wrapper: createWrapper() },
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(result.current.status).toBe('UNAVAILABLE');
      expect(result.current.preview).toBeNull();
      expect(result.current.error).toContain('không có quyền');
      expect(getPreviewSpy).toHaveBeenCalledTimes(1);

      // Advance timers by 10s: polling must be permanently stopped, no retry timer scheduled
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10000);
      });
      expect(getPreviewSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('respects bounded Retry-After up to 60s on 429 without overlap and schedules next poll only after completion', async () => {
    vi.useFakeTimers();
    try {
      const rateLimitError = new ApiError('http', 'Too Many Requests', 429, undefined, 45);
      const getPreviewSpy = vi
        .spyOn(mockClient, 'getCameraPreview')
        .mockRejectedValue(rateLimitError);

      const { result } = renderHook(
        () =>
          useScopedCameraPreview({
            client: mockClient,
            token: 'token-abc',
            sessionScope: 'user-1',
            siteId: siteA,
            cameraId: cameraA,
          }),
        { wrapper: createWrapper() },
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(result.current.status).toBe('UNAVAILABLE');
      expect(result.current.error).toContain('429');
      expect(getPreviewSpy).toHaveBeenCalledTimes(1);

      // Advance 10s (before 45s Retry-After): should NOT refetch yet
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10000);
      });
      expect(getPreviewSpy).toHaveBeenCalledTimes(1);

      // Advance remaining 35s to complete 45s Retry-After delay
      await act(async () => {
        await vi.advanceTimersByTimeAsync(35050);
      });
      expect(getPreviewSpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('exposes errorStatus synchronously for 401 and 403, and resets to null upon scope change', async () => {
    const mockClient = new SmartSiteManagementClient('http://localhost:3000');
    const getPreviewSpy = vi
      .spyOn(mockClient, 'getCameraPreview')
      .mockRejectedValue(new ApiError('http', 'Unauthorized', 401));

    let currentSite = siteA;
    const { result, rerender } = renderHook(
      () =>
        useScopedCameraPreview({
          client: mockClient,
          token: 'token-abc',
          sessionScope: 'user-1',
          siteId: currentSite,
          cameraId: cameraA,
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.status).toBe('UNAVAILABLE');
      expect(result.current.errorStatus).toBe(401);
    });

    // When scope changes to another site, errorStatus resets synchronously to null
    getPreviewSpy.mockReturnValue(new Promise(() => {}));
    currentSite = 'site-other-999';
    rerender();

    expect(result.current.errorStatus).toBeNull();
  });

  it('schedules next poll after default 1000ms completion delay when cadenceMs is omitted', async () => {
    vi.useFakeTimers();
    try {
      let seq = 1;
      const getPreviewSpy = vi
        .spyOn(mockClient, 'getCameraPreview')
        .mockImplementation(async () =>
          createFakeResponse(
            siteA,
            cameraA,
            'CAM-01',
            'LIVE',
            new Date().toISOString(),
            String(seq++),
          ),
        );

      const { result } = renderHook(
        () =>
          useScopedCameraPreview({
            client: mockClient,
            token: 'token-abc',
            sessionScope: 'user-1',
            siteId: siteA,
            cameraId: cameraA,
          }),
        { wrapper: createWrapper() },
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(result.current.status).toBe('LIVE');
      expect(getPreviewSpy).toHaveBeenCalledTimes(1);

      // After 600ms completion delay: should NOT have polled yet (default is 1000ms)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      expect(getPreviewSpy).toHaveBeenCalledTimes(1);

      // After 450ms more (total >1000ms): should have polled the 2nd frame
      await act(async () => {
        await vi.advanceTimersByTimeAsync(450);
      });
      expect(getPreviewSpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('schedules next poll after 500ms completion delay when cadenceMs is 500 for focused view', async () => {
    vi.useFakeTimers();
    try {
      let seq = 1;
      const getPreviewSpy = vi
        .spyOn(mockClient, 'getCameraPreview')
        .mockImplementation(async () =>
          createFakeResponse(
            siteA,
            cameraA,
            'CAM-01',
            'LIVE',
            new Date().toISOString(),
            String(seq++),
          ),
        );

      const { result } = renderHook(
        () =>
          useScopedCameraPreview({
            client: mockClient,
            token: 'token-abc',
            sessionScope: 'user-1',
            siteId: siteA,
            cameraId: cameraA,
            cadenceMs: 500,
          }),
        { wrapper: createWrapper() },
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(result.current.status).toBe('LIVE');
      expect(getPreviewSpy).toHaveBeenCalledTimes(1);

      // At 250ms completion delay: should NOT poll yet
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });
      expect(getPreviewSpy).toHaveBeenCalledTimes(1);

      // At 300ms more (total 550ms > 500ms): schedules and resolves 2nd poll
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(getPreviewSpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('dynamically adapts cadence when transitioning from unselected (1000ms) to focused (500ms)', async () => {
    vi.useFakeTimers();
    try {
      let seq = 1;
      const getPreviewSpy = vi
        .spyOn(mockClient, 'getCameraPreview')
        .mockImplementation(async () =>
          createFakeResponse(
            siteA,
            cameraA,
            'CAM-01',
            'LIVE',
            new Date().toISOString(),
            String(seq++),
          ),
        );

      let currentCadence = 1000;
      const { rerender } = renderHook(
        () =>
          useScopedCameraPreview({
            client: mockClient,
            token: 'token-abc',
            sessionScope: 'user-1',
            siteId: siteA,
            cameraId: cameraA,
            cadenceMs: currentCadence,
          }),
        { wrapper: createWrapper() },
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(getPreviewSpy).toHaveBeenCalledTimes(1);

      // Switch to focused cadence (500ms)
      currentCadence = 500;
      rerender();

      // Within 550ms, the next poll fires under the accelerated 500ms schedule
      await act(async () => {
        await vi.advanceTimersByTimeAsync(550);
      });
      expect(getPreviewSpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('pauses automatic polling when document is hidden and resumes cleanly on visibilitychange without burst', async () => {
    vi.useFakeTimers();
    try {
      let seq = 1;
      const getPreviewSpy = vi
        .spyOn(mockClient, 'getCameraPreview')
        .mockImplementation(async () =>
          createFakeResponse(
            siteA,
            cameraA,
            'CAM-01',
            'LIVE',
            new Date().toISOString(),
            String(seq++),
          ),
        );

      // Emulate document becoming hidden before hook completes first frame
      Object.defineProperty(document, 'hidden', {
        value: true,
        writable: true,
        configurable: true,
      });

      renderHook(
        () =>
          useScopedCameraPreview({
            client: mockClient,
            token: 'token-abc',
            sessionScope: 'user-1',
            siteId: siteA,
            cameraId: cameraA,
            cadenceMs: 500,
          }),
        { wrapper: createWrapper() },
      );

      // First query runs upon mount
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(getPreviewSpy).toHaveBeenCalledTimes(1);

      // Advance by 3000ms while hidden: scheduler must NOT poll in background
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(getPreviewSpy).toHaveBeenCalledTimes(1);

      // Tab becomes visible again: dispatch event in its own act, then advance timers in next act
      Object.defineProperty(document, 'hidden', {
        value: false,
        writable: true,
        configurable: true,
      });
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });

      // Exactly 1 resume refetch triggered without burst
      expect(getPreviewSpy).toHaveBeenCalledTimes(2);
    } finally {
      Object.defineProperty(document, 'hidden', {
        value: false,
        writable: true,
        configurable: true,
      });
      vi.useRealTimers();
    }
  });

  it('guarantees 429 Retry-After floor of at least 1000ms even when focused cadence is 500ms', async () => {
    vi.useFakeTimers();
    try {
      // 429 error with 0.4s retry-after header
      const rateLimitError = new ApiError('http', 'Too Many Requests', 429, undefined, 0.4);
      const getPreviewSpy = vi
        .spyOn(mockClient, 'getCameraPreview')
        .mockRejectedValue(rateLimitError);

      const { result } = renderHook(
        () =>
          useScopedCameraPreview({
            client: mockClient,
            token: 'token-abc',
            sessionScope: 'user-1',
            siteId: siteA,
            cameraId: cameraA,
            cadenceMs: 500,
          }),
        { wrapper: createWrapper() },
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(result.current.status).toBe('UNAVAILABLE');
      expect(getPreviewSpy).toHaveBeenCalledTimes(1);

      // At 600ms: even though cadence is 500ms, 429 floor requires minimum 1000ms
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      expect(getPreviewSpy).toHaveBeenCalledTimes(1);

      // At 500ms more (total >1000ms): next retry fires
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(getPreviewSpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves 429 Retry-After deadline when tab is hidden and shown BEFORE deadline with ZERO early requests, and late visibility schedules only one', async () => {
    vi.useFakeTimers();
    try {
      // 429 error with 10s Retry-After
      const rateLimitError = new ApiError('http', 'Too Many Requests', 429, undefined, 10);
      const getPreviewSpy = vi
        .spyOn(mockClient, 'getCameraPreview')
        .mockRejectedValue(rateLimitError);

      const { result } = renderHook(
        () =>
          useScopedCameraPreview({
            client: mockClient,
            token: 'token-abc',
            sessionScope: 'user-1',
            siteId: siteA,
            cameraId: cameraA,
            cadenceMs: 500,
          }),
        { wrapper: createWrapper() },
      );

      // Initial request runs and fails with 429
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(result.current.status).toBe('UNAVAILABLE');
      expect(getPreviewSpy).toHaveBeenCalledTimes(1);

      // At 2000ms: tab is hidden
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1950);
      });
      Object.defineProperty(document, 'hidden', {
        value: true,
        writable: true,
        configurable: true,
      });
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(getPreviewSpy).toHaveBeenCalledTimes(1);

      // At 4000ms (BEFORE 10s retry deadline): tab is shown again
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      Object.defineProperty(document, 'hidden', {
        value: false,
        writable: true,
        configurable: true,
      });
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      // Visibility return MUST NOT bypass Retry-After: ZERO new requests dispatched
      expect(getPreviewSpy).toHaveBeenCalledTimes(1);

      // Advance by another 4000ms (at 8050ms, still before 10s deadline): still ZERO new requests
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000);
      });
      expect(getPreviewSpy).toHaveBeenCalledTimes(1);

      // Advance past the 10s deadline (reaching 10100ms): re-armed timer fires exactly once
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2100);
      });
      expect(getPreviewSpy).toHaveBeenCalledTimes(2);

      // Now test late visibility: tab is hidden again
      Object.defineProperty(document, 'hidden', {
        value: true,
        writable: true,
        configurable: true,
      });
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });

      // Advance far beyond the 10s deadline while hidden (30s)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30000);
      });
      // Zero requests while hidden
      expect(getPreviewSpy).toHaveBeenCalledTimes(2);

      // Late visibility resume: tab becomes visible
      Object.defineProperty(document, 'hidden', {
        value: false,
        writable: true,
        configurable: true,
      });
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      // Exactly ONE request scheduled and dispatched upon late resume
      expect(getPreviewSpy).toHaveBeenCalledTimes(3);

      // Advance another 500ms: no burst occurs
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(getPreviewSpy).toHaveBeenCalledTimes(3);
    } finally {
      Object.defineProperty(document, 'hidden', {
        value: false,
        writable: true,
        configurable: true,
      });
      vi.useRealTimers();
    }
  });

  it.each([429, 503])(
    'preserves completion delay after a fast 429-to-%s response without a request burst',
    async (nextStatus) => {
      vi.useFakeTimers();
      const requestTimes: number[] = [];
      const firstError = new ApiError('http', 'Too Many Requests', 429, undefined, 2);
      const nextError = new ApiError('http', 'Preview unavailable', nextStatus, undefined, 2);
      vi.spyOn(mockClient, 'getCameraPreview').mockImplementation(() => {
        requestTimes.push(Date.now());
        return Promise.reject(requestTimes.length === 1 ? firstError : nextError);
      });
      const { result } = renderHook(
        () =>
          useScopedCameraPreview({
            client: mockClient,
            token: 'token-abc',
            sessionScope: 'user-1',
            siteId: siteA,
            cameraId: cameraA,
            cadenceMs: 500,
          }),
        { wrapper: createWrapper() },
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(requestTimes).toHaveLength(1);
      expect(result.current.errorStatus).toBe(429);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2100);
      });
      expect(requestTimes).toHaveLength(2);
      expect(requestTimes[1]! - requestTimes[0]!).toBeGreaterThanOrEqual(2000);
      expect(result.current.errorStatus).toBe(nextStatus);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(requestTimes).toHaveLength(2);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(nextStatus === 429 ? 1700 : 200);
      });
      expect(requestTimes).toHaveLength(3);
      expect(requestTimes[2]! - requestTimes[1]!).toBeGreaterThanOrEqual(
        nextStatus === 429 ? 2000 : 500,
      );
    },
  );

  it('bounds cadence safely to 500 or 1000, falling back to 1000 on nonfinite/NaN values without spinning in 0ms', async () => {
    vi.useFakeTimers();
    try {
      let seq = 1;
      const getPreviewSpy = vi
        .spyOn(mockClient, 'getCameraPreview')
        .mockImplementation(async () =>
          createFakeResponse(
            siteA,
            cameraA,
            'CAM-01',
            'LIVE',
            new Date().toISOString(),
            String(seq++),
          ),
        );

      // Pass NaN to verify Math.max(500, NaN) 0ms spin trap is prevented
      const { result } = renderHook(
        () =>
          useScopedCameraPreview({
            client: mockClient,
            token: 'token-abc',
            sessionScope: 'user-1',
            siteId: siteA,
            cameraId: cameraA,
            cadenceMs: NaN,
          }),
        { wrapper: createWrapper() },
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(result.current.status).toBe('LIVE');
      expect(getPreviewSpy).toHaveBeenCalledTimes(1);

      // If NaN caused a 0ms spin loop, it would fire immediately.
      // With safe fallback to 1000ms, at 500ms it MUST NOT have polled again.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(getPreviewSpy).toHaveBeenCalledTimes(1);

      // At 1050ms (total >1000ms completion delay), fallback 1000ms fires cleanly
      await act(async () => {
        await vi.advanceTimersByTimeAsync(550);
      });
      expect(getPreviewSpy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('bounds any cadence <= 500 to 500ms and > 500 to 1000ms via resolveSafeCadence', () => {
    expect(resolveSafeCadence(undefined)).toBe(1000);
    expect(resolveSafeCadence(null as unknown as number)).toBe(1000);
    expect(resolveSafeCadence(NaN)).toBe(1000);
    expect(resolveSafeCadence(Infinity)).toBe(1000);
    expect(resolveSafeCadence(-Infinity)).toBe(1000);
    expect(resolveSafeCadence(0)).toBe(500);
    expect(resolveSafeCadence(200)).toBe(500);
    expect(resolveSafeCadence(500)).toBe(500);
    expect(resolveSafeCadence(750)).toBe(1000);
    expect(resolveSafeCadence(1000)).toBe(1000);
    expect(resolveSafeCadence(2000)).toBe(1000);
  });
});
