// @vitest-environment jsdom
import {
  ApiError,
  SmartSiteManagementClient,
  type CameraConfigurationImageReference,
  type CameraConfigurationImageResponse,
  type CameraConfigurationReferenceResponse,
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
  imageOverrides: Partial<CameraConfigurationImageResponse> = {},
  referenceOverrides: Partial<CameraConfigurationImageReference> = {},
): CameraConfigurationReferenceResponse {
  const image: CameraConfigurationImageResponse = {
    siteId: baseOptions.siteId,
    cameraId: baseOptions.cameraId,
    schemaVersion: 1,
    purpose: 'REGION_CONFIGURATION',
    configurationVersion: 4,
    sourceKind: 'LIVE',
    referenceExpiresAt: '2026-10-15T09:05:00.000Z',
    frame: buildFrame(),
    ...imageOverrides,
  };
  const reference: CameraConfigurationImageReference = {
    schemaVersion: '1.0.0',
    purpose: 'REGION_CONFIGURATION',
    sourceKind: image.sourceKind,
    referenceId: '44444444-4444-4444-8444-444444444444',
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
    viewRevision: 2,
    ...referenceOverrides,
  };
  return { image, reference, viewValidity: 'UNCONFIRMED' };
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

function spyOnConfigReference() {
  return vi.spyOn(SmartSiteManagementClient.prototype, 'getCameraConfigurationReference');
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
    let resolveFetch!: (value: CameraConfigurationReferenceResponse) => void;
    const legacyImageSpy = vi.spyOn(
      SmartSiteManagementClient.prototype,
      'getCameraConfigurationImage',
    );
    const configRefSpy = spyOnConfigReference().mockImplementation(
      () =>
        new Promise<CameraConfigurationReferenceResponse>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const { result, rerender } = mountHook();

    expect(configRefSpy).not.toHaveBeenCalled();
    expect(legacyImageSpy).not.toHaveBeenCalled();
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
    expect(configRefSpy).not.toHaveBeenCalled();

    let firstCall!: Promise<void>;
    let secondCall!: Promise<void>;
    act(() => {
      firstCall = result.current.request();
      secondCall = result.current.request();
    });

    expect(configRefSpy).toHaveBeenCalledTimes(1);
    expect(legacyImageSpy).not.toHaveBeenCalled();
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
    expect(result.current.reference?.issuedReference.referenceId).toBe(
      '44444444-4444-4444-8444-444444444444',
    );
    expect(result.current.reference?.issuedReference.viewRevision).toBe(2);

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(configRefSpy).toHaveBeenCalledTimes(1);
    expect(legacyImageSpy).not.toHaveBeenCalled();
  });

  it('retains LIVE/REPLAY sourceKind, issuedReference metadata, and waits for Image.decode() before exposing reference', async () => {
    let resolveDecode!: () => void;
    decodeImpl = () =>
      new Promise<void>((resolve) => {
        resolveDecode = resolve;
      });

    const configRefSpy = spyOnConfigReference()
      .mockResolvedValueOnce(buildResponse({ sourceKind: 'LIVE' }))
      .mockResolvedValueOnce(
        buildResponse(
          { sourceKind: 'REPLAY' },
          { referenceId: '55555555-5555-4555-8555-555555555555', viewRevision: 3 },
        ),
      );

    const { result } = mountHook();

    let pendingRequest!: Promise<void>;
    await act(async () => {
      pendingRequest = result.current.request();
      await Promise.resolve();
    });

    expect(configRefSpy).toHaveBeenCalledTimes(1);
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
    expect(result.current.reference?.issuedReference.viewRevision).toBe(2);

    decodeImpl = () => Promise.resolve();
    await triggerRequest(result);

    expect(result.current.reference?.sourceKind).toBe('REPLAY');
    expect(result.current.reference?.issuedReference.referenceId).toBe(
      '55555555-5555-4555-8555-555555555555',
    );
    expect(result.current.reference?.issuedReference.viewRevision).toBe(3);
  });

  it('produces no reference when Image.decode fails, dimensions mismatch, or reference expires during decode', async () => {
    spyOnConfigReference().mockResolvedValue(buildResponse());
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
    spyOnConfigReference().mockResolvedValue(buildResponse());
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

  it('cancels and clears immediately on scope/token change, disabled, or unmount and ignores late completions', async () => {
    const signals: AbortSignal[] = [];
    let resolveHeldNetwork!: (value: CameraConfigurationReferenceResponse) => void;
    let resolveHeldDecode!: () => void;

    const configRefSpy = spyOnConfigReference()
      .mockResolvedValueOnce(buildResponse())
      .mockImplementationOnce((_token, _siteId, _cameraId, options) => {
        if (options?.signal) signals.push(options.signal);
        return new Promise<CameraConfigurationReferenceResponse>((resolve) => {
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
    expect(configRefSpy).toHaveBeenCalledTimes(3);

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

  it('fails closed on mismatched scope, unissued legacy image payload, or incoherent reference metadata', async () => {
    spyOnConfigReference()
      .mockResolvedValueOnce(buildResponse({ siteId: 'wrong-site' }))
      .mockResolvedValueOnce(buildResponse({ cameraId: 'wrong-camera-id' }))
      .mockResolvedValueOnce(buildResponse({ frame: buildFrame('wrong-external-id') }))
      .mockResolvedValueOnce(buildResponse({}, { configurationVersion: 99 }))
      .mockResolvedValueOnce(
        buildResponse().image as unknown as CameraConfigurationReferenceResponse,
      );

    const { result } = mountHook();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await triggerRequest(result);
      expect(result.current.reference).toBeNull();
      expect(result.current.error).toBeInstanceOf(ApiError);
      expect(result.current.error?.code).toBe('invalid-response');
    }
  });

  it('clears a previous reference when refresh fails with 401, 403, or 404 and never leaks raw tokens in errors or query keys', async () => {
    const configRefSpy = spyOnConfigReference();
    const { queryClient, result, rerender } = mountHook();

    for (const status of [401, 403, 404]) {
      configRefSpy.mockResolvedValueOnce(buildResponse());
      await triggerRequest(result);
      expect(result.current.reference).not.toBeNull();

      configRefSpy.mockRejectedValueOnce(
        new ApiError('http', `Request failed with status ${status}: ${baseOptions.token}`, status),
      );
      await triggerRequest(result);

      expect(result.current.reference).toBeNull();
      expect(result.current.error?.status).toBe(status);
      expect(result.current.error?.message).not.toContain(baseOptions.token);
    }

    configRefSpy.mockResolvedValue(buildResponse());
    await triggerRequest(result);
    const rotatedToken = 'secret-jwt-token-second-rotation';
    rerender({ ...baseOptions, token: rotatedToken, credentialId: 1 });
    await triggerRequest(result);

    const serializedKeys = queryClient
      .getQueryCache()
      .getAll()
      .map((query) => JSON.stringify(query.queryKey));
    expect(new Set(serializedKeys).size).toBeGreaterThanOrEqual(2);
    for (const serializedKey of serializedKeys) {
      expect(serializedKey).not.toContain(baseOptions.token);
      expect(serializedKey).not.toContain(rotatedToken);
    }
  });
});
