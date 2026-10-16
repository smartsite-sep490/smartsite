// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  SmartSiteManagementClient,
  type CameraPreviewResponse,
} from '@smartsite/api-client';
import { useScopedCameraPreview } from './useScopedCameraPreview';

const siteId = '11111111-1111-4111-8111-111111111111';
const cameraId = '22222222-2222-4222-8222-222222222222';
const frame = (sequenceNumber = '1'): CameraPreviewResponse => ({
  siteId,
  cameraId,
  cameraExternalId: 'camera-a',
  sourceKind: 'LIVE',
  frame: {
    type: 'frame',
    previewVersion: 1,
    cameraExternalId: 'camera-a',
    sessionId: '44444444-4444-4444-8444-444444444444',
    sequenceNumber,
    capturedAt: new Date().toISOString(),
    width: 640,
    height: 480,
    imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
    detections: [],
    zoneDetections: [],
    zonePolygons: [],
  },
});
const clients: QueryClient[] = [];
function setup() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(queryClient);
  const client = new SmartSiteManagementClient('http://127.0.0.1:3000');
  const options = {
    client,
    token: 'old-private-token',
    sessionScope: 'same-session',
    siteId,
    cameraId,
  };
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return { queryClient, client, options, wrapper };
}
const nativeImage = globalThis.Image;
beforeEach(() => {
  globalThis.Image = class {
    src = '';
    naturalWidth = 640;
    naturalHeight = 480;
    decode() {
      return Promise.resolve();
    }
  } as unknown as typeof Image;
});
afterEach(() => {
  cleanup();
  for (const q of clients.splice(0)) q.clear();
  vi.restoreAllMocks();
  globalThis.Image = nativeImage;
});

describe('scoped preview authorization-cache regressions', () => {
  it('never republishes old pixels under a new token with unchanged session/site/camera', async () => {
    const { client, options, wrapper, queryClient } = setup();
    const spy = vi
      .spyOn(client, 'getCameraPreview')
      .mockImplementation(async (token) =>
        token === 'old-private-token' ? frame('71') : new Promise(() => {}),
      );
    const viewer = renderHook(({ token }) => useScopedCameraPreview({ ...options, token }), {
      initialProps: { token: options.token },
      wrapper,
    });
    await waitFor(() => expect(viewer.result.current.preview?.frame.sequenceNumber).toBe('71'));
    viewer.rerender({ token: 'new-private-token' });
    expect(viewer.result.current.preview).toBeNull();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    expect(viewer.result.current.preview).toBeNull();
    expect(spy).toHaveBeenCalledWith('new-private-token', siteId, cameraId, expect.any(Object));
    const keys = JSON.stringify(
      queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey),
    );
    expect(keys).not.toContain('old-private-token');
    expect(keys).not.toContain('new-private-token');
  });

  it('aborts a pending old-token read and refuses its late response under the new token', async () => {
    const { client, options, wrapper } = setup();
    let resolveOld!: (value: CameraPreviewResponse) => void;
    let oldSignal: AbortSignal | undefined;
    vi.spyOn(client, 'getCameraPreview').mockImplementation((token, _site, _camera, request) => {
      if (token !== options.token) return new Promise(() => {});
      oldSignal = request?.signal;
      return new Promise((resolve) => {
        resolveOld = resolve;
      });
    });
    const viewer = renderHook(({ token }) => useScopedCameraPreview({ ...options, token }), {
      initialProps: { token: options.token },
      wrapper,
    });
    await waitFor(() => expect(oldSignal).toBeDefined());
    viewer.rerender({ token: 'new-private-token' });
    await waitFor(() => expect(oldSignal?.aborted).toBe(true));
    await act(async () => {
      resolveOld(frame('72'));
    });
    expect(viewer.result.current.preview).toBeNull();
  });

  it('isolates distinct injected clients with identical baseUrl', async () => {
    const { client, options, wrapper, queryClient } = setup();
    vi.spyOn(client, 'getCameraPreview').mockResolvedValue(frame('81'));
    const first = renderHook(() => useScopedCameraPreview(options), { wrapper });
    await waitFor(() => expect(first.result.current.preview).not.toBeNull());
    const other = new SmartSiteManagementClient('http://127.0.0.1:3000');
    const spy = vi.spyOn(other, 'getCameraPreview').mockImplementation(() => new Promise(() => {}));
    const second = renderHook(() => useScopedCameraPreview({ ...options, client: other }), {
      wrapper,
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    expect(spy).toHaveBeenCalledOnce();
    expect(second.result.current.preview).toBeNull();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(2);
  });

  it('decodes the buffered duplicate for a newly joined viewer', async () => {
    const { client, options, wrapper } = setup();
    const response = frame('91');
    const spy = vi.spyOn(client, 'getCameraPreview').mockResolvedValue(response);
    const first = renderHook(() => useScopedCameraPreview(options), { wrapper });
    await waitFor(() => expect(first.result.current.status).toBe('LIVE'));
    act(() => first.result.current.retry());
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    const second = renderHook(() => useScopedCameraPreview(options), { wrapper });
    await waitFor(() => expect(second.result.current.preview?.frame.sequenceNumber).toBe('91'));
    first.unmount();
    expect(second.result.current.status).toBe('LIVE');
  });

  it('can recover the same buffered frame after a failed image decode', async () => {
    const { client, options, wrapper } = setup();
    let decodes = 0;
    globalThis.Image = class {
      src = '';
      naturalWidth = 640;
      naturalHeight = 480;
      decode() {
        decodes++;
        return decodes === 1 ? Promise.reject(new Error('decode failed')) : Promise.resolve();
      }
    } as unknown as typeof Image;
    vi.spyOn(client, 'getCameraPreview').mockResolvedValue(frame('92'));
    const viewer = renderHook(() => useScopedCameraPreview(options), { wrapper });
    await waitFor(() => expect(viewer.result.current.error).toBe('decode failed'));
    act(() => viewer.result.current.retry());
    await waitFor(() => expect(viewer.result.current.preview?.frame.sequenceNumber).toBe('92'));
    expect(viewer.result.current.error).toBeNull();
  });

  it('does not let manual retry bypass an authentication denial', async () => {
    const { client, options, wrapper } = setup();
    const spy = vi
      .spyOn(client, 'getCameraPreview')
      .mockRejectedValue(new ApiError('http', 'Denied', 403));
    const viewer = renderHook(() => useScopedCameraPreview(options), { wrapper });
    await waitFor(() => expect(viewer.result.current.error).toContain('không có quyền'));
    act(() => viewer.result.current.retry());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    expect(spy).toHaveBeenCalledOnce();
    expect(viewer.result.current.preview).toBeNull();
  });
});
