// @vitest-environment jsdom
import {
  ApiError,
  SmartSiteManagementClient,
  type CameraConfigurationImageResponse,
} from '@smartsite/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCameraConfigurationReference } from './useCameraConfigurationReference';

const syntheticJpegBase64 = Buffer.from([
  255, 216, 255, 192, 0, 17, 8, 0, 80, 0, 120, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0, 255, 217,
]).toString('base64');

const BASE_TIME_MS = Date.parse('2026-10-15T09:00:00.000Z');

const baseOptions = {
  apiUrl: 'http://127.0.0.1:4100',
  token: 'secret-jwt-token-alpha',
  sessionScope: 'operator-1:SITE_SUPERVISOR:site-1',
  credentialId: 1,
  siteId: '11111111-1111-4111-8111-111111111111',
  cameraId: '22222222-2222-4222-8222-222222222222',
  cameraExternalId: 'cam-1',
  enabled: true,
};

type HookOptions = typeof baseOptions;

function buildFrame(cameraExternalId = 'cam-1'): CameraConfigurationImageResponse['frame'] {
  return {
    cameraExternalId,
    width: 120,
    height: 80,
    sessionId: '33333333-3333-4333-8333-333333333333',
    sequenceNumber: '1',
    capturedAt: '2026-10-15T09:00:00.000Z',
    imageDataUrl: `data:image/jpeg;base64,${syntheticJpegBase64}`,
    imageSha256: 'a'.repeat(64),
  };
}

function buildResponse(
  overrides: Partial<CameraConfigurationImageResponse> = {},
): CameraConfigurationImageResponse {
  return {
    siteId: baseOptions.siteId,
    cameraId: baseOptions.cameraId,
    schemaVersion: 1,
    purpose: 'REGION_CONFIGURATION',
    configurationVersion: 4,
    sourceKind: 'LIVE',
    referenceExpiresAt: '2026-10-15T09:05:00.000Z',
    frame: buildFrame(),
    ...overrides,
  };
}

let nextDecodedWidth = 120;
let nextDecodedHeight = 80;
let decodeImpl: () => Promise<void> = () => Promise.resolve();

class MockImage {
  naturalWidth = nextDecodedWidth;
  naturalHeight = nextDecodedHeight;
  private currentSrc = '';

  get src(): string {
    return this.currentSrc;
  }

  set src(value: string) {
    this.currentSrc = value;
    this.naturalWidth = value ? nextDecodedWidth : 0;
    this.naturalHeight = value ? nextDecodedHeight : 0;
  }

  decode(): Promise<void> {
    return decodeImpl();
  }
}

function spyOnConfigImage() {
  return vi.spyOn(SmartSiteManagementClient.prototype, 'getCameraConfigurationImage');
}

function mountHook(initialProps: HookOptions = baseOptions) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  const hook = renderHook((props: HookOptions) => useCameraConfigurationReference(props), {
    initialProps,
    wrapper,
  });
  return { queryClient, ...hook };
}

async function triggerRequest(result: { current: { request: () => Promise<void> } }) {
  await act(async () => {
    await result.current.request();
  });
}

describe('useCameraConfigurationReference', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE_TIME_MS);
    nextDecodedWidth = 120;
    nextDecodedHeight = 80;
    decodeImpl = () => Promise.resolve();
    vi.stubGlobal('Image', MockImage);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('does not request on mount, focus, or scope change until request() is called and deduplicates pending clicks without polling', async () => {
    let resolveFetch!: (value: CameraConfigurationImageResponse) => void;
    const configImageSpy = spyOnConfigImage().mockImplementation(
      () =>
        new Promise<CameraConfigurationImageResponse>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const { result, rerender } = mountHook();

    expect(configImageSpy).not.toHaveBeenCalled();
    expect(result.current.reference).toBeNull();
    expect(result.current.isLoading).toBe(false);

    act(() => {
      window.dispatchEvent(new Event('focus'));
      vi.advanceTimersByTime(60_000);
    });
    rerender({
      ...baseOptions,
      cameraId: '88888888-8888-4888-8888-888888888888',
      cameraExternalId: 'cam-2',
    });
    expect(configImageSpy).not.toHaveBeenCalled();

    let firstCall!: Promise<void>;
    let secondCall!: Promise<void>;
    act(() => {
      firstCall = result.current.request();
      secondCall = result.current.request();
    });

    expect(configImageSpy).toHaveBeenCalledTimes(1);
    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      resolveFetch(
        buildResponse({
          cameraId: '88888888-8888-4888-8888-888888888888',
          frame: buildFrame('cam-2'),
        }),
      );
      await Promise.all([firstCall, secondCall]);
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.reference?.cameraId).toBe('88888888-8888-4888-8888-888888888888');

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(configImageSpy).toHaveBeenCalledTimes(1);
  });

  it('retains LIVE and REPLAY sourceKind labels and waits for Image.decode() before exposing reference', async () => {
    let resolveDecode!: () => void;
    decodeImpl = () =>
      new Promise<void>((resolve) => {
        resolveDecode = resolve;
      });

    const configImageSpy = spyOnConfigImage()
      .mockResolvedValueOnce(buildResponse({ sourceKind: 'LIVE' }))
      .mockResolvedValueOnce(buildResponse({ sourceKind: 'REPLAY' }));

    const { result } = mountHook();

    let pendingRequest!: Promise<void>;
    await act(async () => {
      pendingRequest = result.current.request();
      await Promise.resolve();
    });

    expect(configImageSpy).toHaveBeenCalledTimes(1);
    expect(result.current.reference).toBeNull();
    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      resolveDecode();
      await pendingRequest;
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.reference?.sourceKind).toBe('LIVE');
    expect(result.current.reference?.image.naturalWidth).toBe(120);
    expect(result.current.reference?.image.naturalHeight).toBe(80);

    decodeImpl = () => Promise.resolve();
    await triggerRequest(result);

    expect(result.current.reference?.sourceKind).toBe('REPLAY');
  });

  it('produces no reference when Image.decode fails, dimensions mismatch, or reference expires during decode', async () => {
    spyOnConfigImage().mockResolvedValue(buildResponse());

    const { result } = mountHook();

    decodeImpl = () => Promise.reject(new Error('Decode failed'));
    await triggerRequest(result);
    expect(result.current.reference).toBeNull();
    expect(result.current.error).toBeInstanceOf(ApiError);

    nextDecodedWidth = 640;
    nextDecodedHeight = 480;
    decodeImpl = () => Promise.resolve();
    await triggerRequest(result);
    expect(result.current.reference).toBeNull();
    expect(result.current.error).toBeInstanceOf(ApiError);

    nextDecodedWidth = 120;
    nextDecodedHeight = 80;
    decodeImpl = async () => {
      vi.advanceTimersByTime(300_001);
    };
    await triggerRequest(result);
    expect(result.current.reference).toBeNull();
    expect(result.current.error).toBeInstanceOf(ApiError);
  });

  it('remains valid after 5s and expires at referenceExpiresAt (up to 5min), clearing cached pixels', async () => {
    spyOnConfigImage().mockResolvedValue(buildResponse());

    const { queryClient, result } = mountHook();

    await triggerRequest(result);
    expect(result.current.reference?.frame.imageDataUrl).toBe(
      `data:image/jpeg;base64,${syntheticJpegBase64}`,
    );

    act(() => {
      vi.advanceTimersByTime(6_000);
    });
    expect(result.current.reference?.frame.imageDataUrl).toBe(
      `data:image/jpeg;base64,${syntheticJpegBase64}`,
    );

    act(() => {
      vi.advanceTimersByTime(294_000);
    });
    expect(result.current.reference).toBeNull();

    const cachedPayloads = queryClient
      .getQueryCache()
      .getAll()
      .map((query) => query.state.data)
      .filter(Boolean);
    expect(cachedPayloads).toHaveLength(0);
  });

  it('cancels and clears immediately on scope/token change (including reused credentialId), disabled, or unmount and ignores late completions', async () => {
    const signals: AbortSignal[] = [];
    let resolveHeldNetwork!: (value: CameraConfigurationImageResponse) => void;
    let resolveHeldDecode!: () => void;

    const configImageSpy = spyOnConfigImage()
      .mockResolvedValueOnce(buildResponse())
      .mockImplementationOnce((_token, _siteId, _cameraId, options) => {
        if (options?.signal) signals.push(options.signal);
        return new Promise<CameraConfigurationImageResponse>((resolve) => {
          resolveHeldNetwork = resolve;
        });
      })
      .mockImplementationOnce((_token, _siteId, _cameraId, options) => {
        if (options?.signal) signals.push(options.signal);
        return Promise.resolve(
          buildResponse({
            siteId: '99999999-9999-4999-8999-999999999999',
            cameraId: '88888888-8888-4888-8888-888888888888',
            frame: buildFrame('cam-2'),
          }),
        );
      });

    const { result, rerender, unmount } = mountHook();
    await triggerRequest(result);
    expect(result.current.reference?.siteId).toBe('11111111-1111-4111-8111-111111111111');

    act(() => {
      void result.current.request();
    });
    expect(signals[0]?.aborted).toBe(false);

    rerender({ ...baseOptions, token: 'secret-jwt-token-rotated', credentialId: 1 });
    expect(result.current.reference).toBeNull();
    expect(signals[0]?.aborted).toBe(true);

    await act(async () => {
      resolveHeldNetwork(buildResponse());
      await Promise.resolve();
    });
    expect(result.current.reference).toBeNull();

    decodeImpl = () =>
      new Promise<void>((resolve) => {
        resolveHeldDecode = resolve;
      });
    const scopedOptions: HookOptions = {
      ...baseOptions,
      token: 'secret-jwt-token-rotated',
      siteId: '99999999-9999-4999-8999-999999999999',
      cameraId: '88888888-8888-4888-8888-888888888888',
      cameraExternalId: 'cam-2',
    };
    rerender(scopedOptions);

    await act(async () => {
      void result.current.request();
      await Promise.resolve();
    });
    expect(configImageSpy).toHaveBeenCalledTimes(3);

    rerender({ ...scopedOptions, enabled: false });
    expect(result.current.reference).toBeNull();
    expect(signals[1]?.aborted).toBe(true);

    await act(async () => {
      resolveHeldDecode();
      await Promise.resolve();
    });
    expect(result.current.reference).toBeNull();
    unmount();
  });

  it('rejects mismatched siteId, cameraId, or frame.cameraExternalId returned by a client mock', async () => {
    spyOnConfigImage()
      .mockResolvedValueOnce(buildResponse({ siteId: 'wrong-site' }))
      .mockResolvedValueOnce(buildResponse({ cameraId: 'wrong-camera-id' }))
      .mockResolvedValueOnce(buildResponse({ frame: buildFrame('wrong-external-id') }));

    const { result } = mountHook();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await triggerRequest(result);
      expect(result.current.reference).toBeNull();
      expect(result.current.error).toBeInstanceOf(ApiError);
    }
  });

  it('clears a previous reference when refresh fails with 401, 403, or 404 and exposes a safe ApiError', async () => {
    const configImageSpy = spyOnConfigImage();
    const { result } = mountHook();

    for (const status of [401, 403, 404]) {
      configImageSpy.mockResolvedValueOnce(buildResponse());
      await triggerRequest(result);
      expect(result.current.reference).not.toBeNull();

      configImageSpy.mockRejectedValueOnce(
        new ApiError('http', `Request failed with status ${status}`, status),
      );
      await triggerRequest(result);

      expect(result.current.reference).toBeNull();
      expect(result.current.error).toBeInstanceOf(ApiError);
      expect(result.current.error?.status).toBe(status);
      expect(result.current.error?.message).not.toContain(baseOptions.token);
    }
  });

  it('never stores raw token in QueryClient keys and never calls preview, media, AI status, or demo apply endpoints', async () => {
    spyOnConfigImage().mockResolvedValue(buildResponse());
    const previewSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'getCameraPreview');
    const streamSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'streamCameraVideo');
    const recordedSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'readRecordedCameraVideo');
    const demoStatusSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'getMf05DemoStatus');
    const demoApplySpy = vi.spyOn(SmartSiteManagementClient.prototype, 'applyMf05DemoRegion');

    const { queryClient, result, rerender } = mountHook();
    await triggerRequest(result);

    const rotatedToken = 'secret-jwt-token-second-rotation';
    rerender({ ...baseOptions, token: rotatedToken, credentialId: 1 });
    await triggerRequest(result);

    const serializedKeys = queryClient
      .getQueryCache()
      .getAll()
      .map((query) => JSON.stringify(query.queryKey));
    expect(serializedKeys.length).toBeGreaterThanOrEqual(2);
    for (const serializedKey of serializedKeys) {
      expect(serializedKey).not.toContain(baseOptions.token);
      expect(serializedKey).not.toContain(rotatedToken);
    }
    expect(new Set(serializedKeys).size).toBeGreaterThanOrEqual(2);

    expect(previewSpy).not.toHaveBeenCalled();
    expect(streamSpy).not.toHaveBeenCalled();
    expect(recordedSpy).not.toHaveBeenCalled();
    expect(demoStatusSpy).not.toHaveBeenCalled();
    expect(demoApplySpy).not.toHaveBeenCalled();
  });
});
