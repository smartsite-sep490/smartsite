// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  ApiError,
  SmartSiteManagementClient,
  type CameraConfigurationImageResponse,
} from '@smartsite/api-client';
import { useCameraConfigurationReference } from './useCameraConfigurationReference';

const options = {
  apiUrl: 'http://127.0.0.1:4100',
  token: 'synthetic-token',
  sessionScope: 'admin-test',
  credentialId: 1,
  siteId: '11111111-1111-4111-8111-111111111111',
  cameraId: '22222222-2222-4222-8222-222222222222',
  cameraExternalId: 'camera-a',
  enabled: true,
};
const now = Date.parse('2026-10-15T09:00:00.000Z');
const bytes = [
  255, 216, 255, 192, 0, 17, 8, 0, 80, 0, 120, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0, 255, 217,
];
const payload: CameraConfigurationImageResponse = {
  schemaVersion: 1,
  purpose: 'REGION_CONFIGURATION',
  sourceKind: 'LIVE',
  siteId: options.siteId,
  cameraId: options.cameraId,
  configurationVersion: 4,
  referenceExpiresAt: new Date(now + 300_000).toISOString(),
  frame: {
    cameraExternalId: 'camera-a',
    sessionId: options.siteId,
    sequenceNumber: '1',
    capturedAt: new Date(now).toISOString(),
    width: 120,
    height: 80,
    imageDataUrl: `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`,
    imageSha256: 'a'.repeat(64),
  },
};
let decode: () => Promise<void>;
let images: FakeImage[];
class FakeImage {
  src = '';
  naturalWidth = 120;
  naturalHeight = 80;
  constructor() {
    images.push(this);
  }
  decode() {
    return decode();
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  images = [];
  decode = async () => {};
  vi.stubGlobal('Image', FakeImage);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return {
    ...renderHook((props) => useCameraConfigurationReference(props), {
      initialProps: options,
      wrapper,
    }),
    queryClient,
  };
}

it('cancels and releases a held decoder immediately on disable without waiting for decode settlement', async () => {
  vi.spyOn(SmartSiteManagementClient.prototype, 'getCameraConfigurationImage').mockResolvedValue(
    payload,
  );
  decode = () => new Promise(() => {});
  const { result, rerender, queryClient } = mount();
  let settled = false;
  await act(async () => {
    void result.current.request().then(() => {
      settled = true;
    });
    await Promise.resolve();
  });
  expect(images.length).toBe(1);
  expect(images[0]!.src).toBe(payload.frame.imageDataUrl);
  rerender({ ...options, enabled: false });
  await act(async () => {
    await Promise.resolve();
  });
  expect(settled).toBe(true);
  expect(images[0]!.src).toBe('');
  expect(result.current.reference).toBeNull();
  expect(
    queryClient
      .getQueryCache()
      .getAll()
      .every((row) => !row.state.data),
  ).toBe(true);
});

it('bounds a decoder that never settles and releases its image rather than leaving the action pending', async () => {
  vi.spyOn(SmartSiteManagementClient.prototype, 'getCameraConfigurationImage').mockResolvedValue(
    payload,
  );
  decode = () => new Promise(() => {});
  const { result } = mount();
  let settled = false;
  await act(async () => {
    void result.current.request().then(() => {
      settled = true;
    });
    await Promise.resolve();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(settled).toBe(true);
  expect(result.current.isLoading).toBe(false);
  expect(result.current.reference).toBeNull();
  expect(result.current.error).toBeInstanceOf(ApiError);
  expect(images[0]!.src).toBe('');
});

it('does not expose arbitrary transport text or private backend details through its error object', async () => {
  const privateText = 'rtsp://private-user:private-password@private-camera/stream';
  const client = vi.spyOn(SmartSiteManagementClient.prototype, 'getCameraConfigurationImage');
  const { result } = mount();
  for (const failure of [new Error(privateText), new ApiError('http', privateText, 503)]) {
    client.mockRejectedValueOnce(failure);
    await act(async () => {
      await result.current.request();
    });
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect(result.current.error!.message).not.toContain('private-');
    expect(JSON.stringify(result.current.error)).not.toContain('private-');
  }
});

it('withholds an expired reference on render even when the browser expiry timer has not fired', async () => {
  vi.spyOn(SmartSiteManagementClient.prototype, 'getCameraConfigurationImage').mockResolvedValue(
    payload,
  );
  const { result, rerender, queryClient } = mount();
  await act(async () => {
    await result.current.request();
  });
  expect(result.current.reference).not.toBeNull();
  vi.setSystemTime(now + 300_001);
  rerender({ ...options });
  expect(result.current.reference).toBeNull();
  expect(images[0]!.src).toBe('');
  expect(
    queryClient
      .getQueryCache()
      .getAll()
      .every((row) => !row.state.data),
  ).toBe(true);
});
