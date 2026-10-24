import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useInfiniteQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { ApiError, type SmartSiteManagementClient } from '@smartsite/api-client';
import {
  parseCameraObservationZones,
  type CameraObservationZones,
} from '@smartsite/contracts/camera-observation-zones';

const OBSERVATION_ZONES_PAGE_LIMIT = 20;
const MAX_OBSERVATION_ZONES_TOTAL = 64;
const MAX_OBSERVATION_ZONES_PAGES = 64;

const tokenNoncesByClient = new WeakMap<QueryClient, Map<string, number>>();
let nextTokenNonce = 0;

function getOpaqueTokenNonce(queryClient: QueryClient, token: string): number {
  if (!token) return 0;
  let clientMap = tokenNoncesByClient.get(queryClient);
  if (!clientMap) {
    clientMap = new Map<string, number>();
    tokenNoncesByClient.set(queryClient, clientMap);
  }
  const existing = clientMap.get(token);
  if (existing !== undefined) return existing;
  const assigned = ++nextTokenNonce;
  clientMap.set(token, assigned);
  return assigned;
}

function extractErrorStatus(err: unknown): number | null {
  if (err instanceof ApiError && typeof err.status === 'number') {
    return err.status;
  }
  if (err && typeof err === 'object' && 'status' in err) {
    const status = (err as { status: unknown }).status;
    if (typeof status === 'number') return status;
  }
  return null;
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  if ('name' in err && (err as { name: unknown }).name === 'AbortError') return true;
  if (err instanceof ApiError && err.code === 'cancelled') return true;
  return false;
}

function isMatchingPageScope(
  page: CameraObservationZones | null | undefined,
  siteId: string,
  cameraId: string,
  configurationVersion: number,
): page is CameraObservationZones {
  return Boolean(
    page &&
    page.siteId.toLowerCase() === siteId.toLowerCase() &&
    page.cameraId.toLowerCase() === cameraId.toLowerCase() &&
    page.configurationVersion === configurationVersion,
  );
}

export interface ObservationZoneItem {
  id: string;
  code: string;
  name: string;
}

export interface UseCameraObservationZonesOptions {
  apiUrl: string;
  client: SmartSiteManagementClient;
  token: string;
  sessionScope: string;
  credentialId: number;
  siteId: string;
  cameraId: string;
  configurationVersion: number;
}

export interface CameraObservationZonesState {
  zones: ObservationZoneItem[];
  rawLoadedCount: number;
  total: number;
  unresolvedRegionCount: number;
  isInitialLoading: boolean;
  isBaseError: boolean;
  isNextPageError: boolean;
  isFetchingNextPage: boolean;
  isTrueEmpty: boolean;
  canLoadMore: boolean;
  errorStatus: number | null;
  loadMore: () => void;
  retryBase: () => void;
}

export function useCameraObservationZones({
  apiUrl,
  client,
  token,
  sessionScope,
  credentialId,
  siteId,
  cameraId,
  configurationVersion,
}: UseCameraObservationZonesOptions): CameraObservationZonesState {
  const queryClient = useQueryClient();
  const tokenNonce = useMemo(() => getOpaqueTokenNonce(queryClient, token), [queryClient, token]);

  const hasValidRevision = Number.isSafeInteger(configurationVersion) && configurationVersion >= 1;
  const queryEnabled = Boolean(
    apiUrl && token && sessionScope && siteId && cameraId && hasValidRevision,
  );

  const activeScopeKey = `${apiUrl}|${sessionScope}|${credentialId}|${tokenNonce}|${siteId.toLowerCase()}|${cameraId.toLowerCase()}|${configurationVersion}`;
  const activeScopeKeyRef = useRef(activeScopeKey);
  useLayoutEffect(() => {
    activeScopeKeyRef.current = activeScopeKey;
  }, [activeScopeKey]);

  const inFlightControllersRef = useRef<Set<AbortController>>(new Set());
  useEffect(() => {
    const controllers = inFlightControllersRef.current;
    return () => {
      for (const ctrl of controllers) {
        ctrl.abort();
      }
      controllers.clear();
    };
  }, [activeScopeKey]);

  const infiniteQuery = useInfiniteQuery<CameraObservationZones>({
    queryKey: [
      'ppe-wall-observation-zones',
      apiUrl,
      sessionScope,
      credentialId,
      tokenNonce,
      siteId,
      cameraId,
      configurationVersion,
    ],
    initialPageParam: 0,
    queryFn: async ({ pageParam = 0, signal }) => {
      const offset = typeof pageParam === 'number' ? pageParam : 0;
      const requestScopeKey = activeScopeKey;
      const controller = new AbortController();
      const onOuterAbort = () => controller.abort();

      if (signal?.aborted) {
        controller.abort();
      } else {
        signal?.addEventListener('abort', onOuterAbort, { once: true });
      }
      inFlightControllersRef.current.add(controller);

      try {
        const rawPage = await client.getCameraObservationZones(
          token,
          siteId,
          cameraId,
          { offset, limit: OBSERVATION_ZONES_PAGE_LIMIT },
          { signal: controller.signal },
        );

        if (controller.signal.aborted || activeScopeKeyRef.current !== requestScopeKey) {
          throw new DOMException('Observation zones request superseded', 'AbortError');
        }

        const page = parseCameraObservationZones(rawPage);
        if (!isMatchingPageScope(page, siteId, cameraId, configurationVersion)) {
          throw new Error('Observation zones scope or configurationVersion mismatch');
        }
        if (
          page.items.length > OBSERVATION_ZONES_PAGE_LIMIT ||
          (page.items.length === 0 && offset < page.total) ||
          (offset > 0 && offset >= page.total)
        ) {
          throw new Error('Invalid or non-progressing observation zones page');
        }
        return page;
      } finally {
        signal?.removeEventListener('abort', onOuterAbort);
        inFlightControllersRef.current.delete(controller);
      }
    },
    getNextPageParam: (lastPage, allPages) => {
      if (
        allPages.length >= MAX_OBSERVATION_ZONES_PAGES ||
        !allPages.every((p) => isMatchingPageScope(p, siteId, cameraId, configurationVersion))
      ) {
        return undefined;
      }
      const rawCount = allPages.reduce((sum, page) => sum + page.items.length, 0);
      if (
        lastPage.items.length === 0 ||
        rawCount >= lastPage.total ||
        rawCount >= MAX_OBSERVATION_ZONES_TOTAL
      ) {
        return undefined;
      }
      return rawCount;
    },
    enabled: queryEnabled,
    gcTime: 0,
    retry: false,
  });

  const validPages = useMemo(() => {
    const pages = infiniteQuery.data?.pages;
    if (!pages) return [];
    return pages.every((p) => isMatchingPageScope(p, siteId, cameraId, configurationVersion))
      ? pages
      : [];
  }, [infiniteQuery.data, siteId, cameraId, configurationVersion]);

  const rawLoadedCount = useMemo(
    () => validPages.reduce((sum, page) => sum + page.items.length, 0),
    [validPages],
  );

  const deduplicatedZones = useMemo(() => {
    const seen = new Set<string>();
    const items: ObservationZoneItem[] = [];
    for (const page of validPages) {
      for (const item of page.items) {
        const key = item.id.trim().toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          items.push({ id: item.id, code: item.code, name: item.name });
        }
      }
    }
    return items;
  }, [validPages]);

  const latestPage = validPages.at(-1) ?? null;
  const total = latestPage?.total ?? 0;
  const unresolvedRegionCount = latestPage?.unresolvedRegionCount ?? 0;

  const activeError =
    queryEnabled && infiniteQuery.error && !isAbortError(infiniteQuery.error)
      ? infiniteQuery.error
      : null;
  const errorStatus = activeError ? extractErrorStatus(activeError) : null;
  const isHardAuthOrScopeError = errorStatus === 401 || errorStatus === 403 || errorStatus === 404;

  const isBaseError = Boolean(
    !hasValidRevision ||
    (activeError &&
      (isHardAuthOrScopeError || !infiniteQuery.isFetchNextPageError || validPages.length === 0)),
  );

  const isNextPageError = Boolean(
    hasValidRevision &&
    activeError &&
    !isHardAuthOrScopeError &&
    infiniteQuery.isFetchNextPageError &&
    validPages.length > 0,
  );

  const zones = isBaseError ? [] : deduplicatedZones;
  const isInitialLoading = Boolean(
    queryEnabled && infiniteQuery.isLoading && validPages.length === 0 && !isBaseError,
  );
  const canLoadMore = Boolean(
    queryEnabled &&
    !isInitialLoading &&
    !isBaseError &&
    (infiniteQuery.hasNextPage || isNextPageError) &&
    rawLoadedCount < total &&
    rawLoadedCount < MAX_OBSERVATION_ZONES_TOTAL,
  );
  const isTrueEmpty = Boolean(
    queryEnabled &&
    !isInitialLoading &&
    !isBaseError &&
    !isNextPageError &&
    validPages.length > 0 &&
    total === 0 &&
    zones.length === 0 &&
    unresolvedRegionCount === 0 &&
    !infiniteQuery.hasNextPage,
  );

  const nextPageInFlightRef = useRef(false);
  useLayoutEffect(() => {
    nextPageInFlightRef.current = false;
  }, [activeScopeKey]);

  const loadMore = useCallback(() => {
    if (!canLoadMore || infiniteQuery.isFetchingNextPage || nextPageInFlightRef.current) {
      return;
    }
    nextPageInFlightRef.current = true;
    void infiniteQuery.fetchNextPage().finally(() => {
      nextPageInFlightRef.current = false;
    });
  }, [canLoadMore, infiniteQuery]);

  const retryBase = useCallback(() => {
    if (!queryEnabled || infiniteQuery.isFetching) return;
    void infiniteQuery.refetch();
  }, [queryEnabled, infiniteQuery]);

  return {
    zones,
    rawLoadedCount,
    total,
    unresolvedRegionCount,
    isInitialLoading,
    isBaseError,
    isNextPageError,
    isFetchingNextPage: infiniteQuery.isFetchingNextPage,
    isTrueEmpty,
    canLoadMore,
    errorStatus: isBaseError || isNextPageError ? errorStatus : null,
    loadMore,
    retryBase,
  };
}
