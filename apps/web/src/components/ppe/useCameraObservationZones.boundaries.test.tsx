// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  SmartSiteManagementClient,
  registerSessionCredential,
  unregisterSessionCredential,
} from '@smartsite/api-client';
import type { CameraObservationZones } from '@smartsite/contracts/camera-observation-zones';
import {
  useCameraObservationZones,
  type UseCameraObservationZonesOptions,
} from './useCameraObservationZones';

const API_URL = 'https://backend.invalid';
const SITE_ID = '11111111-1111-4111-8111-111111111111';
const CAMERA_A = '22222222-2222-4222-8222-222222222222';
const CAMERA_B = '33333333-3333-4333-8333-333333333333';

function makeZoneItem(index: number) {
  const suffix = String(index).padStart(12, '0');
  return {
    id: `00000000-0000-4000-8000-${suffix}`,
    code: `ZONE-${String(index).padStart(2, '0')}`,
    name: `Observation Zone ${index}`,
  };
}

function makeZoneRange(startInclusive: number, count: number) {
  return Array.from({ length: count }, (_, idx) => makeZoneItem(startInclusive + idx));
}

function makeZonesPage(params: {
  siteId?: string;
  cameraId?: string;
  configurationVersion?: number;
  items: { id: string; code: string; name: string }[];
  total: number;
  unresolvedRegionCount?: number;
}): CameraObservationZones {
  return {
    siteId: params.siteId ?? SITE_ID,
    cameraId: params.cameraId ?? CAMERA_A,
    configurationVersion: params.configurationVersion ?? 1,
    items: params.items,
    total: params.total,
    unresolvedRegionCount: params.unresolvedRegionCount ?? 0,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createAbortableDeferred<T>(signal?: AbortSignal) {
  const deferred = createDeferred<T>();
  const onAbort = () => {
    deferred.reject(new ApiError('cancelled', 'Request cancelled.'));
  };
  if (signal?.aborted) {
    onAbort();
  } else {
    signal?.addEventListener('abort', onAbort, { once: true });
  }
  return {
    promise: deferred.promise,
    resolve: (value: T) => {
      signal?.removeEventListener('abort', onAbort);
      deferred.resolve(value);
    },
    reject: (reason?: unknown) => {
      signal?.removeEventListener('abort', onAbort);
      deferred.reject(reason);
    },
  };
}

describe('useCameraObservationZones auth, pagination, and cancellation boundaries', () => {
  let queryClient: QueryClient;
  let client: SmartSiteManagementClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    });
    client = new SmartSiteManagementClient(API_URL);
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.restoreAllMocks();
  });

  function mountZonesHook(initialProps: UseCameraObservationZonesOptions) {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    return renderHook(
      (props: UseCameraObservationZonesOptions) => useCameraObservationZones(props),
      {
        initialProps,
        wrapper,
      },
    );
  }

  it('suppresses cached old success and late 401 when token rotates under the same site, camera, credentialId, and sessionScope', async () => {
    const sessionExpiredEvents: Event[] = [];
    const onSessionExpired = (event: Event) => sessionExpiredEvents.push(event);
    window.addEventListener('smartsite:session-expired', onSessionExpired);

    const oldTokenNextPage = createDeferred<CameraObservationZones>();
    const newTokenBasePage = createDeferred<CameraObservationZones>();
    const capturedSignals: Array<{ token: string; offset: number; signal?: AbortSignal }> = [];

    const spy = vi
      .spyOn(client, 'getCameraObservationZones')
      .mockImplementation((token, _siteId, _cameraId, paging, options) => {
        const offset = paging?.offset ?? 0;
        capturedSignals.push({ token, offset, signal: options?.signal });
        if (token === 'token-secret-old' && offset === 0) {
          return Promise.resolve(
            makeZonesPage({
              configurationVersion: 2,
              items: makeZoneRange(1, 20),
              total: 25,
              unresolvedRegionCount: 1,
            }),
          );
        }
        if (token === 'token-secret-old' && offset === 20) {
          return oldTokenNextPage.promise;
        }
        if (token === 'token-secret-new' && offset === 0) {
          return newTokenBasePage.promise;
        }
        throw new Error(`Unexpected call: token=${token} offset=${offset}`);
      });

    registerSessionCredential('token-secret-old', 'scope-shared');
    registerSessionCredential('token-secret-new', 'scope-shared');

    try {
      const baseProps: UseCameraObservationZonesOptions = {
        apiUrl: API_URL,
        client,
        token: 'token-secret-old',
        sessionScope: 'scope-shared',
        credentialId: 7,
        siteId: SITE_ID,
        cameraId: CAMERA_A,
        configurationVersion: 2,
      };

      const { result, rerender } = mountZonesHook(baseProps);

      await waitFor(() => {
        expect(result.current.zones).toHaveLength(20);
      });
      expect(result.current.rawLoadedCount).toBe(20);
      expect(result.current.total).toBe(25);
      expect(result.current.canLoadMore).toBe(true);

      // Start an in-flight request under old token before rotating token
      act(() => {
        result.current.loadMore();
      });
      await waitFor(() => {
        expect(spy).toHaveBeenCalledTimes(2);
      });

      // Rotate ONLY token while keeping siteId, cameraId, credentialId, and sessionScope identical
      rerender({
        ...baseProps,
        token: 'token-secret-new',
      });

      // Cached old success must be immediately suppressed while the new token base fetch is pending
      expect(result.current.zones).toEqual([]);
      expect(result.current.rawLoadedCount).toBe(0);
      expect(result.current.total).toBe(0);
      expect(result.current.isInitialLoading).toBe(true);
      expect(result.current.isBaseError).toBe(false);
      expect(result.current.errorStatus).toBeNull();

      // Superseded old-token in-flight request signal must be aborted
      const oldNextCall = capturedSignals.find(
        (c) => c.token === 'token-secret-old' && c.offset === 20,
      );
      expect(oldNextCall?.signal?.aborted).toBe(true);

      // Raw JWT strings must never appear in TanStack Query keys
      const serializedKeys = JSON.stringify(
        queryClient
          .getQueryCache()
          .getAll()
          .map((q) => q.queryKey),
      );
      expect(serializedKeys).not.toContain('token-secret-old');
      expect(serializedKeys).not.toContain('token-secret-new');

      // Late 401 from the superseded old token must be ignored and must not emit session expiry on new scope
      await act(async () => {
        oldTokenNextPage.reject(new ApiError('http', 'Old token expired', 401));
      });
      expect(result.current.isBaseError).toBe(false);
      expect(result.current.errorStatus).toBeNull();
      expect(sessionExpiredEvents).toHaveLength(0);

      // Resolve new token base page and verify fresh zones render cleanly
      await act(async () => {
        newTokenBasePage.resolve(
          makeZonesPage({
            configurationVersion: 2,
            items: [makeZoneItem(99)],
            total: 1,
            unresolvedRegionCount: 0,
          }),
        );
      });

      await waitFor(() => {
        expect(result.current.zones).toEqual([makeZoneItem(99)]);
      });
      expect(result.current.isBaseError).toBe(false);
      expect(result.current.errorStatus).toBeNull();
      expect(sessionExpiredEvents).toHaveLength(0);
    } finally {
      window.removeEventListener('smartsite:session-expired', onSessionExpired);
      unregisterSessionCredential('token-secret-old', 'scope-shared');
      unregisterSessionCredential('token-secret-new', 'scope-shared');
    }
  });

  it('hides old zones on hard 403 next-page error, whereas 503 retains loaded zones and retries the exact same offset', async () => {
    let nextPageAttempt = 0;
    const spy = vi
      .spyOn(client, 'getCameraObservationZones')
      .mockImplementation(async (_token, _siteId, cameraId, paging) => {
        const offset = paging?.offset ?? 0;
        if (offset === 0) {
          return makeZonesPage({
            cameraId,
            configurationVersion: 1,
            items: makeZoneRange(1, 20),
            total: 25,
            unresolvedRegionCount: 2,
          });
        }
        if (cameraId === CAMERA_A && offset === 20) {
          nextPageAttempt += 1;
          if (nextPageAttempt === 1) {
            throw new ApiError('http', 'Temporary upstream outage', 503);
          }
          return makeZonesPage({
            cameraId: CAMERA_A,
            configurationVersion: 1,
            items: makeZoneRange(21, 5),
            total: 25,
            unresolvedRegionCount: 2,
          });
        }
        if (cameraId === CAMERA_B && offset === 20) {
          throw new ApiError('http', 'Forbidden camera observation context', 403);
        }
        throw new Error(`Unexpected call: cameraId=${cameraId} offset=${offset}`);
      });

    const propsA: UseCameraObservationZonesOptions = {
      apiUrl: API_URL,
      client,
      token: 'token-operator',
      sessionScope: 'scope-operator',
      credentialId: 1,
      siteId: SITE_ID,
      cameraId: CAMERA_A,
      configurationVersion: 1,
    };

    const { result, rerender } = mountZonesHook(propsA);

    await waitFor(() => {
      expect(result.current.zones).toHaveLength(20);
    });

    // 1. Next page fails with transient 503 -> retains old 20 zones, sets isNextPageError, allows retry of same offset 20
    act(() => {
      result.current.loadMore();
    });

    await waitFor(() => {
      expect(result.current.isNextPageError).toBe(true);
    });
    expect(result.current.isBaseError).toBe(false);
    expect(result.current.errorStatus).toBe(503);
    expect(result.current.zones).toHaveLength(20);
    expect(result.current.rawLoadedCount).toBe(20);
    expect(result.current.total).toBe(25);
    expect(result.current.unresolvedRegionCount).toBe(2);
    expect(result.current.canLoadMore).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2);

    // Explicit retry via loadMore() must request the exact same offset (20) and append remaining 5 zones
    act(() => {
      result.current.loadMore();
    });

    await waitFor(() => {
      expect(result.current.zones).toHaveLength(25);
    });
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy.mock.calls[2]?.[3]).toEqual({ offset: 20, limit: 20 });
    expect(result.current.isNextPageError).toBe(false);
    expect(result.current.isBaseError).toBe(false);
    expect(result.current.errorStatus).toBeNull();
    expect(result.current.canLoadMore).toBe(false);

    // 2. Switch to CAMERA_B where page 0 succeeds (20 zones) and next page fails with hard 403
    rerender({
      ...propsA,
      cameraId: CAMERA_B,
    });

    await waitFor(() => {
      expect(result.current.zones).toHaveLength(20);
    });

    act(() => {
      result.current.loadMore();
    });

    await waitFor(() => {
      expect(result.current.isBaseError).toBe(true);
    });
    expect(result.current.isNextPageError).toBe(false);
    expect(result.current.errorStatus).toBe(403);
    expect(result.current.zones).toEqual([]);
    expect(result.current.canLoadMore).toBe(false);
  });

  it('hides stale multi-page context when a later base refetch fails with 503 (isFetchNextPageError boundary)', async () => {
    let failBaseRefetch = false;
    const spy = vi
      .spyOn(client, 'getCameraObservationZones')
      .mockImplementation(async (_token, _siteId, _cameraId, paging) => {
        const offset = paging?.offset ?? 0;
        if (offset === 0) {
          return makeZonesPage({
            configurationVersion: 1,
            items: makeZoneRange(1, 20),
            total: 25,
            unresolvedRegionCount: 1,
          });
        }
        if (failBaseRefetch) {
          throw new ApiError('http', 'Service unavailable on base refetch', 503);
        }
        return makeZonesPage({
          configurationVersion: 1,
          items: makeZoneRange(21, 5),
          total: 25,
          unresolvedRegionCount: 1,
        });
      });

    const { result } = mountZonesHook({
      apiUrl: API_URL,
      client,
      token: 'token-refetch',
      sessionScope: 'scope-refetch',
      credentialId: 1,
      siteId: SITE_ID,
      cameraId: CAMERA_A,
      configurationVersion: 1,
    });

    await waitFor(() => {
      expect(result.current.zones).toHaveLength(20);
    });

    act(() => {
      result.current.loadMore();
    });

    await waitFor(() => {
      expect(result.current.zones).toHaveLength(25);
    });
    expect(result.current.isBaseError).toBe(false);
    expect(result.current.isNextPageError).toBe(false);

    // Base refetch succeeds at offset 0 and fails with 503 at offset 20 after 2 pages are cached
    failBaseRefetch = true;
    act(() => {
      result.current.retryBase();
    });

    await waitFor(() => {
      expect(result.current.isBaseError).toBe(true);
    });
    expect(spy.mock.calls.map((call) => call[3]?.offset ?? 0)).toEqual([0, 20, 0, 20]);
    expect(result.current.isNextPageError).toBe(false);
    expect(result.current.errorStatus).toBe(503);
    expect(result.current.zones).toEqual([]);
    expect(result.current.canLoadMore).toBe(false);
  });

  it('coalesces synchronous double loadMore clicks into a single pending call using rawLoadedCount offset and cancels in-flight requests on scope change and unmount', async () => {
    const signalsByOffset = new Map<number, AbortSignal | undefined>();
    let cameraBSignal: AbortSignal | undefined;
    let pendingOffset40: ReturnType<typeof createAbortableDeferred<CameraObservationZones>> | null =
      null;
    let pendingCameraB: ReturnType<typeof createAbortableDeferred<CameraObservationZones>> | null =
      null;

    const spy = vi
      .spyOn(client, 'getCameraObservationZones')
      .mockImplementation((_token, _siteId, cameraId, paging, options) => {
        const offset = paging?.offset ?? 0;
        if (cameraId === CAMERA_B) {
          cameraBSignal = options?.signal;
          pendingCameraB = createAbortableDeferred<CameraObservationZones>(options?.signal);
          return pendingCameraB.promise;
        }
        signalsByOffset.set(offset, options?.signal);
        if (offset === 0) {
          return Promise.resolve(
            makeZonesPage({
              configurationVersion: 1,
              items: makeZoneRange(1, 20),
              total: 45,
              unresolvedRegionCount: 0,
            }),
          );
        }
        if (offset === 20) {
          // 2 overlapping IDs with page 0 (items 19 & 20) + 18 new IDs (21..38) => 20 raw items, 38 deduplicated
          return Promise.resolve(
            makeZonesPage({
              configurationVersion: 1,
              items: [makeZoneItem(19), makeZoneItem(20), ...makeZoneRange(21, 18)],
              total: 45,
              unresolvedRegionCount: 0,
            }),
          );
        }
        if (offset === 40) {
          pendingOffset40 = createAbortableDeferred<CameraObservationZones>(options?.signal);
          return pendingOffset40.promise;
        }
        throw new Error(`Unexpected offset: ${offset}`);
      });

    const baseProps: UseCameraObservationZonesOptions = {
      apiUrl: API_URL,
      client,
      token: 'token-double-click',
      sessionScope: 'scope-double-click',
      credentialId: 1,
      siteId: SITE_ID,
      cameraId: CAMERA_A,
      configurationVersion: 1,
    };

    const { result, rerender, unmount } = mountZonesHook(baseProps);

    await waitFor(() => {
      expect(result.current.zones).toHaveLength(20);
    });

    // Load page 2 (offset 20), producing 38 deduplicated zones but 40 rawLoadedCount
    act(() => {
      result.current.loadMore();
    });

    await waitFor(() => {
      expect(result.current.rawLoadedCount).toBe(40);
    });
    expect(result.current.zones).toHaveLength(38);
    expect(result.current.canLoadMore).toBe(true);
    expect(spy).toHaveBeenCalledTimes(2);

    // Synchronous double click on loadMore() must issue only ONE pending request using raw offset 40 (not 38)
    act(() => {
      result.current.loadMore();
      result.current.loadMore();
    });

    await waitFor(() => {
      expect(spy).toHaveBeenCalledTimes(3);
    });
    expect(spy.mock.calls[2]?.[3]).toEqual({ offset: 40, limit: 20 });

    // Scope change (camera A -> camera B) aborts the pending offset 40 request with ApiError('cancelled')
    rerender({
      ...baseProps,
      cameraId: CAMERA_B,
    });

    expect(signalsByOffset.get(40)?.aborted).toBe(true);
    await waitFor(() => {
      expect(spy).toHaveBeenCalledTimes(4);
    });
    expect(result.current.isBaseError).toBe(false);
    expect(result.current.errorStatus).toBeNull();

    // Unmounting while camera B request is in-flight aborts camera B's request signal immediately
    expect(cameraBSignal?.aborted).toBe(false);
    unmount();
    expect(cameraBSignal?.aborted).toBe(true);
  });
});
