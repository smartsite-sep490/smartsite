// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError, SmartSiteManagementClient } from '@smartsite/api-client';
import { useScopedCameraPreview } from './useScopedCameraPreview';

const siteId = '11111111-1111-4111-8111-111111111111';
const cameras = [2, 3, 4, 5].map((id) => `${id}`.repeat(8) + '-2222-4222-8222-222222222222');
const sessionId = '66666666-6666-4666-8666-666666666666';
const originalImage = globalThis.Image;
let queryClient: QueryClient;
let api: SmartSiteManagementClient;
let calls: Array<{ token: string; camera: string; at: number }>;

function response(cameraId: string) {
  return {
    siteId,
    cameraId,
    cameraExternalId: cameraId,
    sourceKind: 'LIVE' as const,
    frame: {
      type: 'frame' as const,
      previewVersion: 1 as const,
      cameraExternalId: cameraId,
      sessionId,
      sequenceNumber: String(calls.length),
      capturedAt: new Date().toISOString(),
      width: 640,
      height: 480,
      imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      detections: [],
      zoneDetections: [],
      zonePolygons: [],
    },
  };
}

async function advance(ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += 100)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.min(100, ms - elapsed));
    });
}

function mount(cameraId: string, cadence = 1000, apiUrl = 'http://localhost:3000') {
  return renderHook(
    ({ token, enabled, cadenceMs }) =>
      useScopedCameraPreview({
        client: api,
        apiUrl,
        token,
        sessionScope: token,
        siteId,
        cameraId,
        enabled,
        cadenceMs,
      }),
    {
      initialProps: { token: 'token-a', enabled: true, cadenceMs: cadence },
      wrapper: ({ children }: { children: React.ReactNode }) =>
        React.createElement(QueryClientProvider, { client: queryClient }, children),
    },
  );
}

describe('aggregate scoped preview transport budget', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-06T00:00:00Z'));
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    api = new SmartSiteManagementClient('http://localhost:3000');
    calls = [];
    vi.spyOn(api, 'getCameraPreview').mockImplementation(async (token, _site, camera) => {
      calls.push({ token, camera, at: Date.now() });
      return response(camera);
    });
    globalThis.Image = class {
      src = '';
      naturalWidth = 640;
      naturalHeight = 480;
      async decode() {}
    } as unknown as typeof Image;
  });
  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
    globalThis.Image = originalImage;
  });

  it('keeps four actual transports below the server budget across focus changes and duplicate viewers', async () => {
    const viewers = cameras.map((camera, index) => mount(camera, index === 0 ? 500 : 1000));
    const duplicate = mount(cameras[0]!);
    await advance(100);
    expect(calls).toHaveLength(4);
    for (let interval = 0; interval < 60; interval++) {
      if (interval === 30) {
        viewers[0]!.rerender({ token: 'token-a', enabled: true, cadenceMs: 1000 });
        viewers[1]!.rerender({ token: 'token-a', enabled: true, cadenceMs: 500 });
      }
      await advance(1000);
    }
    expect(calls.length).toBeLessThanOrEqual(100);
    console.info(
      JSON.stringify({
        aggregatePreviewReads: calls.length,
        observedMs: 60100,
        cameras: cameras.length,
      }),
    );
    for (const camera of cameras)
      expect(calls.filter((r) => r.camera === camera).length).toBeGreaterThan(10);
    for (const viewer of [...viewers, duplicate])
      expect(viewer.result.current.preview).not.toBeNull();
  }, 15000);

  it('drops queued old credentials and disabled viewers before a transport permit arrives', async () => {
    const viewers = cameras.map((camera, index) => mount(camera, index === 0 ? 500 : 1000));
    await advance(600);
    expect(calls).toHaveLength(4);
    expect(viewers[0]!.result.current.isPolling).toBe(true);
    viewers[0]!.rerender({ token: 'token-b', enabled: true, cadenceMs: 500 });
    expect(viewers[0]!.result.current.preview).toBeNull();
    await advance(100);
    expect(
      calls.filter((r) => r.camera === cameras[0] && r.at > Date.parse('2026-11-06T00:00:00Z')),
    ).toEqual([expect.objectContaining({ token: 'token-b' })]);
    await advance(500);
    viewers[0]!.rerender({ token: 'token-b', enabled: false, cadenceMs: 500 });
    const before = calls.filter((r) => r.camera === cameras[0]).length;
    await advance(2000);
    expect(calls.filter((r) => r.camera === cameras[0])).toHaveLength(before);
    for (const viewer of viewers) viewer.unmount();
    queryClient.clear();
    await advance(100);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shares Retry-After across cameras, remount and manual retry', async () => {
    vi.mocked(api.getCameraPreview).mockImplementationOnce(async (token, _site, camera) => {
      calls.push({ token, camera, at: Date.now() });
      throw new ApiError('http', 'Synthetic rate limit', 429, undefined, 3);
    });
    const viewers = cameras.map((camera) => mount(camera, 500));
    await advance(100);
    expect(calls).toHaveLength(4);
    viewers[0]!.unmount();
    const replacement = mount(cameras[0]!, 500);
    act(() => replacement.result.current.retry());
    await advance(2800);
    expect(calls).toHaveLength(4);
    await advance(200);
    expect(calls.length).toBeGreaterThan(4);
  });

  it('shares permits between absolute and relative URLs for the same API origin', async () => {
    cameras.forEach((camera) => mount(camera, 1000, window.location.origin));
    mount(cameras[0]!, 1000, '');
    await advance(100);
    expect(calls).toHaveLength(4);
    await advance(600);
    expect(calls).toHaveLength(5);
  });
});
