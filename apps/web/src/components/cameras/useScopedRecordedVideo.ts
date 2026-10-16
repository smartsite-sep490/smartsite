import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ApiError,
  SmartSiteManagementClient,
} from '@smartsite/api-client';

export type ScopedRecordedVideoStatus =
  | 'IDLE'
  | 'LOADING'
  | 'READY'
  | 'ERROR'
  | 'HALTED';

export interface UseScopedRecordedVideoOptions {
  apiUrl?: string;
  client?: SmartSiteManagementClient;
  token?: string | null;
  sessionScope?: string | null;
  siteId?: string | null;
  cameraId?: string | null;
  cameraExternalId?: string | null;
  isRecorded?: boolean;
  enabled?: boolean;
}

export interface UseScopedRecordedVideoResult {
  videoUrl: string | null;
  status: ScopedRecordedVideoStatus;
  error: string | null;
  errorStatus: number | null;
  isLoading: boolean;
  retry: () => void;
}

/**
 * Hook for consuming authenticated recorded MP4 video for a single selected REPLAY camera.
 *
 * Strict constraints & protections:
 * - Only enabled for known recorded replay demo cameras (core5-recorded-demo, helmet-vest-recorded-demo).
 * - Synchronously scope-bound: returned videoUrl is immediately nullified if render scope changes,
 *   preventing old video flash before useEffect runs.
 * - One objectURL per source + credential scope; calls URL.revokeObjectURL on cleanup or scope change.
 * - Aborts in-flight fetches on unmount, scope change, or when document becomes hidden.
 * - 401/403: permanent HALT; dispatches smartsite:session-expired on 401.
 * - Absolutely NO video blobs or object URLs stored in TanStack Query cache.
 */
export function useScopedRecordedVideo({
  apiUrl = 'http://localhost:3000',
  client: externalClient,
  token,
  sessionScope,
  siteId,
  cameraId,
  cameraExternalId,
  isRecorded = false,
  enabled = true,
}: UseScopedRecordedVideoOptions): UseScopedRecordedVideoResult {
  const managementClient = useMemo(() => {
    if (externalClient) return externalClient;
    return new SmartSiteManagementClient(apiUrl);
  }, [externalClient, apiUrl]);

  const isScopeReady = Boolean(
    enabled &&
      isRecorded &&
      token &&
      sessionScope &&
      siteId &&
      cameraId &&
      cameraExternalId,
  );

  // Track document visibility to pause/abort requests when hidden
  const [isDocumentVisible, setIsDocumentVisible] = useState<boolean>(() => {
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

  const accessScope = useMemo(
    () => ({ managementClient, apiUrl, token, sessionScope, siteId, cameraId, cameraExternalId }),
    [managementClient, apiUrl, token, sessionScope, siteId, cameraId, cameraExternalId],
  );
  const currentScopeKey = useMemo(
    () => ({ accessScope, isRecorded, enabled, isDocumentVisible }),
    [accessScope, isRecorded, enabled, isDocumentVisible],
  );
  // Hiding the page or disabling playback must not clear an access denial.
  const denialRef = useRef<{
    scope: typeof accessScope;
    error: string;
    status: 401 | 403;
  } | null>(null);

  const generationRef = useRef<number>(0);
  const controllerRef = useRef<AbortController | null>(null);
  const activeObjectUrlRef = useRef<string | null>(null);

  // Synchronously abort in-flight requests and revoke old object URL on scope change or unmount
  useLayoutEffect(() => {
    const generation = generationRef;
    return () => {
      generation.current++;
      if (controllerRef.current) {
        controllerRef.current.abort();
        controllerRef.current = null;
      }
      if (activeObjectUrlRef.current) {
        URL.revokeObjectURL(activeObjectUrlRef.current);
        activeObjectUrlRef.current = null;
      }
    };
  }, [currentScopeKey]);

  const [committedState, setCommittedState] = useState<{
    scopeKey: typeof currentScopeKey;
    videoUrl: string | null;
    status: ScopedRecordedVideoStatus;
    error: string | null;
    errorStatus: number | null;
  }>({
    scopeKey: currentScopeKey,
    videoUrl: null,
    status: isScopeReady && isDocumentVisible ? 'LOADING' : 'IDLE',
    error: null,
    errorStatus: null,
  });

  const [retryTrigger, setRetryTrigger] = useState<number>(0);

  const retry = useCallback(() => {
    if (!isScopeReady || document.hidden || denialRef.current?.scope === accessScope) return;
    if (committedState.scopeKey === currentScopeKey && committedState.status === 'LOADING') return;
    setRetryTrigger((c) => c + 1);
  }, [isScopeReady, accessScope, committedState, currentScopeKey]);

  useEffect(() => {
    const fetchGeneration = ++generationRef.current;
    if (denialRef.current?.scope !== accessScope) denialRef.current = null;

    if (
      !isScopeReady ||
      !isDocumentVisible ||
      !token ||
      !siteId ||
      !cameraId ||
      !cameraExternalId
    ) {
      return;
    }

    const denial = denialRef.current;
    if (denial) {
      setCommittedState({
        scopeKey: currentScopeKey, videoUrl: null, status: 'HALTED',
        error: denial.error, errorStatus: denial.status,
      });
      return;
    }

    setCommittedState({
      scopeKey: currentScopeKey, videoUrl: null, status: 'LOADING',
      error: null, errorStatus: null,
    });

    const controller = new AbortController();
    controllerRef.current = controller;

    managementClient
      .readRecordedCameraVideo(token, siteId, cameraId, {
        signal: controller.signal,
        expectedCameraExternalId: cameraExternalId,
      })
      .then((blob) => {
        if (fetchGeneration !== generationRef.current || controller.signal.aborted) {
          return;
        }

        // Revoke any previous object URL before storing new one
        if (activeObjectUrlRef.current) {
          URL.revokeObjectURL(activeObjectUrlRef.current);
          activeObjectUrlRef.current = null;
        }

        const objectUrl = URL.createObjectURL(blob);
        activeObjectUrlRef.current = objectUrl;

        setCommittedState({
          scopeKey: currentScopeKey,
          videoUrl: objectUrl,
          status: 'READY',
          error: null,
          errorStatus: null,
        });
      })
      .catch((err: unknown) => {
        if (fetchGeneration !== generationRef.current || controller.signal.aborted) {
          return;
        }

        if (activeObjectUrlRef.current) {
          URL.revokeObjectURL(activeObjectUrlRef.current);
          activeObjectUrlRef.current = null;
        }

        const status = err instanceof ApiError ? err.status ?? null : null;
        const message = err instanceof Error ? err.message : 'Failed to load recorded video.';

        if (status === 401 || status === 403) {
          denialRef.current = { scope: accessScope, error: message, status };
        }

        if (status === 401) {
          if (typeof window !== 'undefined' && sessionScope) {
            window.dispatchEvent(
              new CustomEvent('smartsite:session-expired', {
                detail: { sessionScopes: [sessionScope] },
              }),
            );
          }
          setCommittedState({
            scopeKey: currentScopeKey,
            videoUrl: null,
            status: 'HALTED',
            error: message,
            errorStatus: 401,
          });
          return;
        }

        if (status === 403) {
          setCommittedState({
            scopeKey: currentScopeKey,
            videoUrl: null,
            status: 'HALTED',
            error: message,
            errorStatus: 403,
          });
          return;
        }

        setCommittedState({
          scopeKey: currentScopeKey,
          videoUrl: null,
          status: 'ERROR',
          error: message,
          errorStatus: status,
        });
      });

    return () => {
      controller.abort();
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    };
  }, [
    managementClient,
    accessScope,
    currentScopeKey,
    token,
    sessionScope,
    siteId,
    cameraId,
    cameraExternalId,
    isRecorded,
    enabled,
    isScopeReady,
    isDocumentVisible,
    retryTrigger,
  ]);

  // Synchronous scope guard: if current scope does not match committed state,
  // return null immediately (zero render flash of old camera video before effect runs)
  const isScopeMatch = committedState.scopeKey === currentScopeKey;
  const activeVideoUrl = isScopeMatch ? committedState.videoUrl : null;
  const activeError = isScopeMatch ? committedState.error : null;
  const activeErrorStatus = isScopeMatch ? committedState.errorStatus : null;
  const activeStatus: ScopedRecordedVideoStatus = isScopeMatch
    ? committedState.status
    : isScopeReady && isDocumentVisible
      ? 'LOADING'
      : 'IDLE';

  return {
    videoUrl: activeVideoUrl,
    status: activeStatus,
    error: activeError,
    errorStatus: activeErrorStatus,
    isLoading: activeStatus === 'LOADING',
    retry,
  };
}
