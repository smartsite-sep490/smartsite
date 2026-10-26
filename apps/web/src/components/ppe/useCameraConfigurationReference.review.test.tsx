// @vitest-environment jsdom
import { createElement, type ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  ApiError,
  SmartSiteManagementClient,
  type CameraConfigurationImageReference,
  type CameraConfigurationImageResponse,
  type CameraConfigurationReferenceResponse,
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
const sessionId = '33333333-3333-4333-8333-333333333333';
const defaultReferenceId = '44444444-4444-4444-8444-444444444444';
const imageDataUrl = `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`;

function buildPayload(
  overrides: {
    capturedAtMs?: number;
    sequenceNumber?: string;
    referenceId?: string;
    viewRevision?: number;
  } = {},
): CameraConfigurationReferenceResponse {
  const capturedAtMs = overrides.capturedAtMs ?? now;
  const capturedAt = new Date(capturedAtMs).toISOString();
  const referenceExpiresAt = new Date(capturedAtMs + 300_000).toISOString();
  const image: CameraConfigurationImageResponse = {
    schemaVersion: 1,
    purpose: 'REGION_CONFIGURATION',
    sourceKind: 'LIVE',
    siteId: options.siteId,
    cameraId: options.cameraId,
    configurationVersion: 4,
    referenceExpiresAt,
    frame: {
      cameraExternalId: 'camera-a',
      sessionId,
      sequenceNumber: overrides.sequenceNumber ?? '1',
      capturedAt,
      width: 120,
      height: 80,
      imageDataUrl,
      imageSha256: 'a'.repeat(64),
    },
  };
  const reference: CameraConfigurationImageReference = {
    schemaVersion: '1.0.0',
    purpose: 'REGION_CONFIGURATION',
    sourceKind: image.sourceKind,
    referenceId: overrides.referenceId ?? defaultReferenceId,
    siteId: image.siteId,
    cameraId: image.cameraId,
    sessionId: image.frame.sessionId,
    imageSha256: image.frame.imageSha256,
    width: image.frame.width,
    height: image.frame.height,
    capturedAt: image.frame.capturedAt,
    issuedAt: image.frame.capturedAt,
    expiresAt: image.referenceExpiresAt,
    configurationVersion: image.configurationVersion,
    viewRevision: overrides.viewRevision ?? 1,
  };
  return { image, reference, viewValidity: 'UNCONFIRMED' };
}

const payload: CameraConfigurationReferenceResponse = buildPayload();
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
  vi.spyOn(
    SmartSiteManagementClient.prototype,
    'getCameraConfigurationReference',
  ).mockResolvedValue(payload);
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
  expect(images[0]!.src).toBe(payload.image.frame.imageDataUrl);
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
  vi.spyOn(
    SmartSiteManagementClient.prototype,
    'getCameraConfigurationReference',
  ).mockResolvedValue(payload);
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
  const client = vi.spyOn(SmartSiteManagementClient.prototype, 'getCameraConfigurationReference');
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
  vi.spyOn(
    SmartSiteManagementClient.prototype,
    'getCameraConfigurationReference',
  ).mockResolvedValue(payload);
  const { result, rerender, queryClient } = mount();
  await act(async () => {
    await result.current.request();
  });
  expect(result.current.reference).not.toBeNull();
  expect(result.current.reference?.issuedReference.referenceId).toBe(defaultReferenceId);
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

it('settles same-scope query cancellation without leaving the action loading', async () => {
  vi.spyOn(
    SmartSiteManagementClient.prototype,
    'getCameraConfigurationReference',
  ).mockResolvedValue(payload);
  decode = () => new Promise(() => {});
  const { result, queryClient } = mount();
  await act(async () => {
    void result.current.request();
    await Promise.resolve();
  });
  expect(result.current.isLoading).toBe(true);
  await act(async () => {
    await queryClient.cancelQueries();
  });
  expect(result.current.isLoading).toBe(false);
  expect(result.current.reference).toBeNull();
  expect(images[0]!.src).toBe('');
});

it('does not cancel an active decode for equivalent normalized scope inputs', async () => {
  vi.spyOn(
    SmartSiteManagementClient.prototype,
    'getCameraConfigurationReference',
  ).mockResolvedValue(payload);
  let finish!: () => void;
  decode = () =>
    new Promise<void>((resolve) => {
      finish = resolve;
    });
  const { result, rerender } = mount();
  let pending!: Promise<void>;
  await act(async () => {
    pending = result.current.request();
    await Promise.resolve();
  });
  rerender({ ...options, apiUrl: options.apiUrl + '/' });
  expect(images[0]!.src).toBe(payload.image.frame.imageDataUrl);
  await act(async () => {
    finish();
    await pending;
  });
  expect(result.current.reference?.configurationVersion).toBe(4);
  expect(result.current.reference?.issuedReference.referenceId).toBe(defaultReferenceId);
});

it('rejects an already expired reference before allocating or decoding image pixels', async () => {
  vi.spyOn(
    SmartSiteManagementClient.prototype,
    'getCameraConfigurationReference',
  ).mockResolvedValue(payload);
  vi.setSystemTime(now + 300_001);
  const { result } = mount();
  await act(async () => {
    await result.current.request();
  });
  expect(result.current.reference).toBeNull();
  expect(images).toHaveLength(0);
});

it('accepts the new reference when the old reference expires during a held refresh', async () => {
  const client = vi
    .spyOn(SmartSiteManagementClient.prototype, 'getCameraConfigurationReference')
    .mockResolvedValueOnce(payload);
  const { result } = mount();
  await act(async () => {
    await result.current.request();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(299_900);
  });
  let finish!: (value: CameraConfigurationReferenceResponse) => void;
  client.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  let pending!: Promise<void>;
  await act(async () => {
    pending = result.current.request();
    await Promise.resolve();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  expect(result.current.reference).toBeNull();
  await act(async () => {
    finish(
      buildPayload({
        capturedAtMs: Date.now(),
        sequenceNumber: '2',
        referenceId: '55555555-5555-4555-8555-555555555555',
        viewRevision: 2,
      }),
    );
    await pending;
  });
  expect(result.current.reference?.frame.sequenceNumber).toBe('2');
  expect(result.current.reference?.issuedReference.referenceId).toBe(
    '55555555-5555-4555-8555-555555555555',
  );
  expect(result.current.reference?.issuedReference.viewRevision).toBe(2);
  expect(images[0]!.src).toBe('');
  expect(images[1]!.src).toBe(payload.image.frame.imageDataUrl);
});

it('keeps an authorized reference isolated from a disabled empty-token sibling using the same query client', async () => {
  vi.spyOn(
    SmartSiteManagementClient.prototype,
    'getCameraConfigurationReference',
  ).mockResolvedValue(payload);
  const active = mount();
  await act(async () => {
    await active.result.current.request();
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: active.queryClient }, children);
  renderHook(() => useCameraConfigurationReference({ ...options, token: '', enabled: false }), {
    wrapper,
  });
  active.rerender({ ...options, apiUrl: options.apiUrl + '/' });
  expect(active.result.current.reference?.configurationVersion).toBe(4);
  expect(images[0]!.src).toBe(payload.image.frame.imageDataUrl);
});
