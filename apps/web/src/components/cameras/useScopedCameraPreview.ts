import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { ApiError, SmartSiteManagementClient } from '@smartsite/api-client';
import { parseRealtimePreview, type RealtimePreview } from './realtimePreview';
import type { DecodedPreview } from './useRealtimePreview';

export type ScopedPreviewStatus = 'LIVE' | 'REPLAY' | 'UNAVAILABLE' | 'CONNECTING';

export interface UseScopedCameraPreviewOptions {
  apiUrl?: string;
  client?: SmartSiteManagementClient;
  token?: string | null;
  sessionScope?: string | null;
  siteId?: string | null;
  cameraId?: string | null;
  enabled?: boolean;
  now?: () => number;
  cadenceMs?: number;
}

export interface UseScopedCameraPreviewResult {
  preview: DecodedPreview | null;
  sourceKind: 'LIVE' | 'REPLAY' | null;
  status: ScopedPreviewStatus;
  error: string | null;
  errorStatus: number | null;
  isLoading: boolean;
  isPolling: boolean;
  cameraExternalId: string | null;
  capturedAt: string | null;
  siteId: string | null;
  cameraId: string | null;
  retry: () => void;
}

interface ScopedDecodedState {
  preview: DecodedPreview;
  sourceKind: 'LIVE' | 'REPLAY';
  client: SmartSiteManagementClient;
  apiUrl: string;
  token: string;
  sessionScope: string;
  siteId: string;
  cameraId: string;
  cameraExternalId: string;
  sequenceNumber: bigint;
  capturedAt: string;
  receivedAt: number;
  sessionId: string;
  epoch: number;
}

// Query hashes serialize class instances. Use opaque identities instead, and retain
// only the most recent credential per QueryClient (never place a token in a key).
const clientIds = new WeakMap<SmartSiteManagementClient, number>();
const authIds = new WeakMap<QueryClient, { token: string | null; id: number }>();
let nextScopeId = 0;
function clientIdentity(client: SmartSiteManagementClient): number {
  const existing = clientIds.get(client);
  if (existing !== undefined) return existing;
  const id = ++nextScopeId;
  clientIds.set(client, id);
  return id;
}
function authIdentity(client: QueryClient, token: string | null): number {
  const existing = authIds.get(client);
  if (existing?.token === token) return existing.id;
  const id = ++nextScopeId;
  authIds.set(client, { token, id });
  return id;
}

async function decodeImage(frame: RealtimePreview): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = frame.imageDataUrl;
  await image.decode();
  if (image.naturalWidth !== frame.width || image.naturalHeight !== frame.height) {
    throw new Error('Preview image dimensions do not match metadata');
  }
  return image;
}

export function resolveSafeCadence(cadenceMs?: number): number {
  if (typeof cadenceMs !== 'number' || !Number.isFinite(cadenceMs) || Number.isNaN(cadenceMs)) {
    return 1000;
  }
  // Bounded safely to 500 or 1000
  if (cadenceMs <= 500) {
    return 500;
  }
  return 1000;
}

export function useScopedCameraPreview({
  apiUrl = 'http://localhost:3000',
  client: externalClient,
  token,
  sessionScope,
  siteId,
  cameraId,
  enabled = true,
  now,
  cadenceMs,
}: UseScopedCameraPreviewOptions): UseScopedCameraPreviewResult {
  const queryClient = useQueryClient();
  const managementClient = useMemo(() => {
    if (externalClient) return externalClient;
    return new SmartSiteManagementClient(apiUrl);
  }, [externalClient, apiUrl]);

  const [decodedState, setDecodedState] = useState<ScopedDecodedState | null>(null);
  const [decodeError, setDecodeError] = useState<string | null>(null);
  const [decodeAttempt, setDecodeAttempt] = useState(0);
  const decodedRef = useRef<ScopedDecodedState | null>(null);

  // Epoch counter invalidates in-flight decode & sequence mutations on scope/token/client/enabled changes
  const generationRef = useRef(0);

  // Document visibility state drives re-arming of completion scheduler without direct refetches
  const [isDocumentVisible, setIsDocumentVisible] = useState(() => {
    if (typeof document !== 'undefined') {
      return !document.hidden;
    }
    return true;
  });

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handleVisibilityChange = () => {
      setIsDocumentVisible(!document.hidden);
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  const retryDeadlineRef = useRef<number>(0);
  const prevFetchingRef = useRef<boolean>(false);
  const completedQueryRef = useRef({ dataUpdatedAt: 0, errorUpdateCount: 0 });

  const isScopeReady = Boolean(token && sessionScope && siteId && cameraId && enabled);

  // Invalidate pending decode. Query lifecycle owns transport cancellation.
  useEffect(() => {
    generationRef.current++;
    decodedRef.current = null;
    retryDeadlineRef.current = 0;
    prevFetchingRef.current = false;
    completedQueryRef.current = { dataUpdatedAt: 0, errorUpdateCount: 0 };
  }, [apiUrl, sessionScope, siteId, cameraId, token, enabled, managementClient]);

  const credentialId = useMemo(
    () => authIdentity(queryClient, token ?? null),
    [queryClient, token],
  );
  const injectedClientId = useMemo(
    () => (externalClient ? clientIdentity(externalClient) : 0),
    [externalClient],
  );
  // Equivalent default clients share reads; distinct injected adapters never do.
  const queryKey = useMemo(
    () => [
      'scoped-camera-preview',
      apiUrl,
      credentialId,
      sessionScope ?? '',
      siteId ?? '',
      cameraId ?? '',
      injectedClientId,
    ],
    [apiUrl, credentialId, sessionScope, siteId, cameraId, injectedClientId],
  );
  const [stateScope, setStateScope] = useState(queryKey);
  if (stateScope !== queryKey) {
    setStateScope(queryKey);
    setDecodedState(null);
    setDecodeError(null);
  }

  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      if (!token || !siteId || !cameraId) {
        throw new ApiError('invalid-response', 'Camera preview scope is incomplete');
      }
      const response = await managementClient.getCameraPreview(token, siteId, cameraId, {
        signal,
        timeoutMs: 3000,
      });

      // Strict envelope scope check
      if (response.siteId !== siteId || response.cameraId !== cameraId) {
        throw new ApiError(
          'invalid-response',
          'Camera preview response scope does not match request',
        );
      }

      // Canonical validation of the wire frame
      const canonicalFrame = parseRealtimePreview(response.frame);

      // Check timestamps: reject stale frames (>5s) and future frames (>30s)
      const currentTime = now ? now() : Date.now();
      const capturedTime = Date.parse(canonicalFrame.capturedAt);
      if (!Number.isFinite(capturedTime)) {
        throw new ApiError('invalid-response', 'Preview frame has invalid capturedAt timestamp');
      }
      if (currentTime - capturedTime > 5000) {
        throw new ApiError('invalid-response', 'Preview frame is stale (>5s old)');
      }
      if (capturedTime - currentTime > 30000) {
        throw new ApiError(
          'invalid-response',
          'Preview frame timestamp is too far in the future (>30s)',
        );
      }

      // Check sequence number within the same stream sessionId
      const seq = BigInt(canonicalFrame.sequenceNumber);
      const currentSessionId = canonicalFrame.sessionId;
      const previous = queryClient.getQueryData<{
        canonicalFrame: RealtimePreview;
        receivedAt: number;
      }>(queryKey);

      let isDuplicate = false;
      if (previous?.canonicalFrame.sessionId === currentSessionId) {
        const previousSequence = BigInt(previous.canonicalFrame.sequenceNumber);
        if (seq < previousSequence) {
          throw new ApiError(
            'invalid-response',
            `Out-of-order sequence number: ${seq} < ${previousSequence}`,
          );
        }
        isDuplicate = seq === previousSequence;
      }

      return {
        response,
        canonicalFrame,
        isDuplicate,
        receivedAt: isDuplicate && previous ? previous.receivedAt : currentTime,
      };
    },
    enabled: isScopeReady,
    gcTime: 0, // No private pixel retention; TanStack Query auto garbage-collects when observers reach 0
    refetchInterval: false, // Refetch interval managed explicitly via effect to guarantee 1s after completion
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: false, // Window focus cannot bypass polling delay or 429 backoff
    refetchOnReconnect: false, // Reconnect cannot bypass polling delay or 429 backoff
    retry: false, // Completion scheduler is the sole owner of automatic retries.
  });
  if (query.isError && decodedState !== null) setDecodedState(null);
  const { isFetching, error: queryError, refetch, dataUpdatedAt, errorUpdateCount } = query;

  // Polling scheduler: re-armed by visibility state and completion transitions,
  // strictly preserving 429 Retry-After deadline, halting permanently on 401/403, and preventing bursts.
  useEffect(() => {
    if (!isScopeReady) {
      retryDeadlineRef.current = 0;
      prevFetchingRef.current = false;
      completedQueryRef.current = { dataUpdatedAt: 0, errorUpdateCount: 0 };
      return;
    }

    // Permanently halt polling on auth failure
    if (
      queryError instanceof ApiError &&
      (queryError.status === 401 || queryError.status === 403)
    ) {
      retryDeadlineRef.current = 0;
      prevFetchingRef.current = false;
      return;
    }

    const safeCadence = resolveSafeCadence(cadenceMs);

    // Fast requests can settle between React renders, hiding the fetching edge.
    // Query completion markers also advance when the same error is returned again.
    const completionChanged =
      dataUpdatedAt !== completedQueryRef.current.dataUpdatedAt ||
      errorUpdateCount !== completedQueryRef.current.errorUpdateCount;
    if (!isFetching && (prevFetchingRef.current || completionChanged)) {
      let delayMs = safeCadence;
      if (queryError instanceof ApiError && queryError.status === 429) {
        const retryAfter = queryError.retryAfterSeconds ?? 4;
        // Safely honor Retry-After up to 60 seconds, maintaining minimum 1000ms
        delayMs = Math.min(60000, Math.max(1000, retryAfter * 1000));
      }
      retryDeadlineRef.current = Date.now() + delayMs;
      completedQueryRef.current = { dataUpdatedAt, errorUpdateCount };
    }
    prevFetchingRef.current = isFetching;

    // Do not schedule while currently fetching or while document is hidden
    if (isFetching) return;
    if (!isDocumentVisible) return;

    const nowMs = Date.now();
    // Adapt to focused cadence (500ms) dynamically if not bound by 429 rate limit
    if (
      !(queryError instanceof ApiError && queryError.status === 429) &&
      retryDeadlineRef.current > nowMs + safeCadence
    ) {
      retryDeadlineRef.current = nowMs + safeCadence;
    }

    // If query has settled but deadline was cleared (e.g. scope change), assign safeCadence
    if (retryDeadlineRef.current === 0) {
      retryDeadlineRef.current = nowMs + safeCadence;
    }

    const remainingMs = Math.max(0, retryDeadlineRef.current - nowMs);

    const timer = setTimeout(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void refetch({ cancelRefetch: false });
    }, remainingMs);

    return () => {
      clearTimeout(timer);
    };
  }, [
    isScopeReady,
    isFetching,
    queryError,
    refetch,
    isDocumentVisible,
    cadenceMs,
    dataUpdatedAt,
    errorUpdateCount,
    queryKey,
  ]);

  // Handle image decode when fresh query data arrives; query.isError cancels pending decode immediately
  const responseData = query.data;
  useEffect(() => {
    if (!responseData || !isScopeReady || query.isError) {
      return;
    }

    const lastDecoded = decodedRef.current;
    // Dedupe each viewer's successful bitmap, not a shared query's fetch.
    if (
      lastDecoded &&
      lastDecoded.token === token &&
      lastDecoded.client === managementClient &&
      lastDecoded.sessionScope === sessionScope &&
      lastDecoded.siteId === siteId &&
      lastDecoded.cameraId === cameraId &&
      lastDecoded.apiUrl === apiUrl &&
      lastDecoded.sessionId === responseData.canonicalFrame.sessionId &&
      lastDecoded.sequenceNumber === BigInt(responseData.canonicalFrame.sequenceNumber)
    ) {
      return;
    }

    const currentEpoch = generationRef.current;
    const targetSessionScope = sessionScope ?? '';
    const targetSiteId = siteId ?? '';
    const targetCameraId = cameraId ?? '';
    const targetToken = token ?? '';
    const targetApiUrl = apiUrl;
    const targetClient = managementClient;
    const { response, canonicalFrame, receivedAt } = responseData;
    const remainingLife = () => {
      const currentTime = now ? now() : Date.now();
      return Math.min(
        5000 - (currentTime - receivedAt),
        5000 - Math.max(0, currentTime - Date.parse(canonicalFrame.capturedAt)),
      );
    };
    if (remainingLife() <= 0) return;

    let cancelled = false;

    decodeImage(canonicalFrame)
      .then((image) => {
        // Late decode cannot publish across scope/generation change, query error, or if cancelled
        if (
          cancelled ||
          query.isError ||
          generationRef.current !== currentEpoch ||
          remainingLife() <= 0
        ) {
          return;
        }

        const decoded: ScopedDecodedState = {
          preview: { frame: canonicalFrame, image },
          sourceKind: response.sourceKind,
          client: targetClient,
          apiUrl: targetApiUrl,
          token: targetToken,
          sessionScope: targetSessionScope,
          siteId: targetSiteId,
          cameraId: targetCameraId,
          cameraExternalId: canonicalFrame.cameraExternalId,
          sequenceNumber: BigInt(canonicalFrame.sequenceNumber),
          capturedAt: canonicalFrame.capturedAt,
          receivedAt,
          sessionId: canonicalFrame.sessionId,
          epoch: currentEpoch,
        };
        decodedRef.current = decoded;
        setDecodedState(decoded);
        setDecodeError(null);
      })
      .catch((err) => {
        if (!cancelled && !query.isError && generationRef.current === currentEpoch) {
          decodedRef.current = null;
          setDecodedState(null);
          setDecodeError(err instanceof Error ? err.message : 'Image decode failed');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    responseData,
    isScopeReady,
    query.isError,
    sessionScope,
    siteId,
    cameraId,
    token,
    apiUrl,
    managementClient,
    decodeAttempt,
    now,
  ]);

  // If query errored, clear decoded frame immediately
  useEffect(() => {
    if (query.isError) {
      decodedRef.current = null;
    }
  }, [query.isError]);

  // State Expiry Timer: frame expires at min(5s from receipt, 5s from capturedAt if in the past).
  // Future clock skew (up to 30s) cannot extend life past 5s from receipt.
  useEffect(() => {
    if (!decodedState) return;

    const currentTime = now ? now() : Date.now();
    const capturedTime = Date.parse(decodedState.capturedAt);
    const timeSinceCaptured = currentTime - capturedTime;

    const timeSinceReceived = currentTime - decodedState.receivedAt;
    const remainingFromReceipt = Math.max(0, 5000 - timeSinceReceived);
    const remainingFromCaptured = Math.max(0, 5000 - Math.max(0, timeSinceCaptured));
    const remainingTime = Math.min(remainingFromReceipt, remainingFromCaptured);

    const timer = setTimeout(() => {
      if (decodedRef.current !== decodedState) return;
      decodedRef.current = null;
      setDecodedState(null);
    }, remainingTime);

    return () => {
      clearTimeout(timer);
    };
  }, [decodedState, now]);

  // Synchronous gating in render pass (pure function of state/props, no Date.now/ref calls, React 19 safe):
  // Returns null immediately if query errors, decode errors, or scope/client mismatches.
  const isCurrent =
    decodedState !== null &&
    isScopeReady &&
    !query.isError &&
    !decodeError &&
    decodedState.client === managementClient &&
    decodedState.apiUrl === apiUrl &&
    decodedState.token === (token ?? '') &&
    decodedState.sessionScope === (sessionScope ?? '') &&
    decodedState.siteId === (siteId ?? '') &&
    decodedState.cameraId === (cameraId ?? '');

  const activePreview = isCurrent ? decodedState.preview : null;
  const activeSourceKind = isCurrent ? decodedState.sourceKind : null;
  const activeCameraExternalId = isCurrent ? decodedState.cameraExternalId : null;
  const activeCapturedAt = isCurrent ? decodedState.capturedAt : null;
  const activeSiteId = isCurrent ? decodedState.siteId : null;
  const activeCameraId = isCurrent ? decodedState.cameraId : null;

  const errorMessage = useMemo(() => {
    if (decodeError) return decodeError;
    if (query.error) {
      if (query.error instanceof ApiError) {
        if (query.error.status === 401 || query.error.status === 403) {
          return 'Phiên làm việc hết hạn hoặc không có quyền xem camera này.';
        }
        if (query.error.status === 429) {
          return 'Giới hạn tần suất yêu cầu (429). Đang chờ giảm tải...';
        }
        if (query.error.status === 503) {
          return 'Nguồn camera hiện không khả dụng (503).';
        }
        return query.error.message;
      }
      return (query.error as Error).message;
    }
    return null;
  }, [decodeError, query.error]);

  const errorStatus: number | null = useMemo(() => {
    if (!isScopeReady) return null;
    if (query.error) {
      if (query.error instanceof ApiError) {
        return query.error.status ?? null;
      }
      if (typeof query.error === 'object' && query.error !== null && 'status' in query.error) {
        const st = (query.error as { status: unknown }).status;
        if (typeof st === 'number') return st;
      }
    }
    return null;
  }, [isScopeReady, query.error]);

  const status: ScopedPreviewStatus = useMemo(() => {
    if (!isScopeReady) return 'UNAVAILABLE';
    if (errorMessage || query.isError) return 'UNAVAILABLE';
    if (activePreview && activeSourceKind) {
      return activeSourceKind;
    }
    if (query.isLoading || query.isFetching) return 'CONNECTING';
    return 'UNAVAILABLE';
  }, [
    isScopeReady,
    errorMessage,
    query.isError,
    activePreview,
    activeSourceKind,
    query.isLoading,
    query.isFetching,
  ]);

  return {
    preview: activePreview,
    sourceKind: activeSourceKind,
    status,
    error: errorMessage,
    errorStatus,
    isLoading: query.isLoading && !activePreview,
    isPolling: query.isFetching,
    cameraExternalId: activeCameraExternalId,
    capturedAt: activeCapturedAt,
    siteId: activeSiteId,
    cameraId: activeCameraId,
    retry: () => {
      if (!isScopeReady || isFetching) return;
      if (queryError instanceof ApiError) {
        if (queryError.status === 401 || queryError.status === 403) return;
        if (
          queryError.status === 429 &&
          Date.now() <
            query.errorUpdatedAt +
              Math.min(60000, Math.max(1000, (queryError.retryAfterSeconds ?? 4) * 1000))
        )
          return;
      }
      setDecodeError(null);
      setDecodeAttempt((attempt) => attempt + 1);
      void refetch({ cancelRefetch: false });
    },
  };
}
