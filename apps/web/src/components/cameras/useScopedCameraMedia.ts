import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ApiError,
  SmartSiteManagementClient,
  type CameraMediaFrame,
} from '@smartsite/api-client';

export type ScopedMediaStatus =
  | 'IDLE'
  | 'CONNECTING'
  | 'LIVE'
  | 'STALLED'
  | 'UNAVAILABLE'
  | 'HALTED';

export interface UseScopedCameraMediaOptions {
  apiUrl?: string;
  client?: SmartSiteManagementClient;
  token?: string | null;
  sessionScope?: string | null;
  siteId?: string | null;
  cameraId?: string | null;
  cameraExternalId?: string | null;
  isLive?: boolean;
  enabled?: boolean;
  now?: () => number;
}

export interface UseScopedCameraMediaResult {
  image: HTMLImageElement | null;
  frame: CameraMediaFrame | null;
  status: ScopedMediaStatus;
  error: string | null;
  errorStatus: number | null;
  isStreaming: boolean;
  retry: () => void;
}

async function decodeMediaImage(frame: CameraMediaFrame): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = frame.imageDataUrl;
  await image.decode();
  if (image.naturalWidth !== frame.width || image.naturalHeight !== frame.height) {
    throw new Error(
      `Decoded media image dimensions (${image.naturalWidth}x${image.naturalHeight}) do not match metadata (${frame.width}x${frame.height})`,
    );
  }
  return image;
}

/**
 * Hook for consuming authenticated raw NDJSON camera media stream for a single selected LIVE camera.
 *
 * Strict constraints & protections:
 * - Only enabled for ONE selected LIVE camera (requires cameraExternalId for readiness).
 * - Synchronously scope-bound: returned pixels are immediately nullified if render scope changes,
 *   preventing old camera image flash before useEffect runs.
 * - Single decoding job + only newest pending frame: queues at most one pending frame; older unstarted
 *   frames are discarded immediately.
 * - Post-decode monotonic & freshness checks: older slow decodes can never overwrite newer frames.
 * - CapturedAt age is rechecked after decode; stale frames (>2s old) are discarded.
 * - 2s media TTL uses remaining capture lifetime (not flat 2s after decode) and invalidates in-flight decoding.
 * - Graceful stream EOF cleans up and schedules bounded reconnection (same as network failure).
 * - 401/403: permanent HALT; 429: respects Retry-After (min 1000ms); 503/network: bounded retry.
 * - No pixels or credentials stored in TanStack Query keys or query cache.
 */
export function useScopedCameraMedia({
  apiUrl = 'http://localhost:3000',
  client: externalClient,
  token,
  sessionScope,
  siteId,
  cameraId,
  cameraExternalId,
  isLive = false,
  enabled = true,
  now,
}: UseScopedCameraMediaOptions): UseScopedCameraMediaResult {
  const managementClient = useMemo(() => {
    if (externalClient) return externalClient;
    return new SmartSiteManagementClient(apiUrl);
  }, [externalClient, apiUrl]);

  // cameraExternalId is strictly required for isScopeReady
  const isScopeReady = Boolean(
    enabled &&
      isLive &&
      token &&
      sessionScope &&
      siteId &&
      cameraId &&
      cameraExternalId,
  );

  // Track document visibility to pause stream without burst
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

  // Access decisions survive visibility/enable changes, but never cross credentials,
  // camera or transport adapters. Object identities also avoid delimiter collisions.
  const accessScope = useMemo(
    () => ({ managementClient, apiUrl, token, sessionScope, siteId, cameraId, cameraExternalId }),
    [managementClient, apiUrl, token, sessionScope, siteId, cameraId, cameraExternalId],
  );
  const currentScopeKey = useMemo(
    () => ({ accessScope, isLive, enabled, isDocumentVisible }),
    [accessScope, isLive, enabled, isDocumentVisible],
  );
  const retryPolicyRef = useRef<{
    scope: typeof accessScope;
    halted: boolean;
    retryAt: number;
    error: string | null;
    errorStatus: number | null;
  } | null>(null);

  const generationRef = useRef<number>(0);
  const controllerRef = useRef<AbortController | null>(null);
  const stallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // useLayoutEffect cleanup generation/AbortController: synchronously aborts in-flight requests
  // and invalidates pending async jobs on scope change or unmount without render ref mutation
  useLayoutEffect(() => {
    const generation = generationRef;
    return () => {
      generation.current++;
      if (controllerRef.current) {
        controllerRef.current.abort();
        controllerRef.current = null;
      }
      if (stallTimerRef.current) {
        clearTimeout(stallTimerRef.current);
        stallTimerRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [currentScopeKey]);

  const [committedState, setCommittedState] = useState<{
    scopeKey: typeof currentScopeKey;
    image: HTMLImageElement | null;
    frame: CameraMediaFrame | null;
    status: ScopedMediaStatus;
    error: string | null;
    errorStatus: number | null;
  }>({
    scopeKey: currentScopeKey,
    image: null,
    frame: null,
    status: isScopeReady && isDocumentVisible ? 'CONNECTING' : 'IDLE',
    error: null,
    errorStatus: null,
  });

  const [retryTrigger, setRetryTrigger] = useState<number>(0);

  const retry = useCallback(() => {
    if (!isScopeReady || document.hidden) return;
    const policy = retryPolicyRef.current;
    if (policy?.scope === accessScope && (policy.halted || Date.now() < policy.retryAt)) return;
    if (committedState.scopeKey === currentScopeKey &&
        (committedState.status === 'CONNECTING' || committedState.status === 'LIVE')) return;
    setRetryTrigger((c) => c + 1);
  }, [isScopeReady, accessScope, committedState, currentScopeKey]);

  useEffect(() => {
    const generation = generationRef;
    const streamGeneration = ++generation.current;

    // Clear any pending timers
    if (stallTimerRef.current) {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    if (retryPolicyRef.current?.scope !== accessScope) {
      retryPolicyRef.current = {
        scope: accessScope, halted: false, retryAt: 0, error: null, errorStatus: null,
      };
    }

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

    const policy = retryPolicyRef.current;
    if (policy.halted || Date.now() < policy.retryAt) {
      setCommittedState({
        scopeKey: currentScopeKey, image: null, frame: null,
        status: policy.halted ? 'HALTED' : 'UNAVAILABLE',
        error: policy.error, errorStatus: policy.errorStatus,
      });
      if (!policy.halted) {
        reconnectTimerRef.current = setTimeout(() => {
          if (generationRef.current === streamGeneration && !document.hidden) {
            setRetryTrigger((c) => c + 1);
          }
        }, policy.retryAt - Date.now());
      }
      return () => {
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
      };
    }

    setCommittedState({
      scopeKey: currentScopeKey, image: null, frame: null,
      status: 'CONNECTING', error: null, errorStatus: null,
    });

    const controller = new AbortController();
    controllerRef.current = controller;

    // Decoding state machine:
    // - At most ONE decoding job is active at any time.
    // - Holds at most ONE pending frame (the newest received); older unstarted frames are dropped.
    // - inFlightDecodeGeneration is incremented on TTL expiry or scope change to invalidate in-flight decoding.
    let isDecoding = false;
    let pendingFrame: CameraMediaFrame | null = null;
    let lastCommittedSeq = -1n;
    let committedSessionId: string | null = null;
    let inFlightDecodeGeneration = 0;

    const runDecodeLoop = async (initialFrame: CameraMediaFrame) => {
      isDecoding = true;
      let nextToDecode: CameraMediaFrame | null = initialFrame;

      try {
        while (nextToDecode) {
          const frameToProcess = nextToDecode;
          nextToDecode = null;

          if (generationRef.current !== streamGeneration || controller.signal.aborted) {
            break;
          }

          const thisDecodeGen = ++inFlightDecodeGeneration;

          let decodedImg: HTMLImageElement;
          try {
            decodedImg = await decodeMediaImage(frameToProcess);
          } catch (decodeErr) {
            if (generationRef.current !== streamGeneration || controller.signal.aborted) {
              break;
            }
            setCommittedState({
              scopeKey: currentScopeKey,
              image: null,
              frame: null,
              status: 'UNAVAILABLE',
              error:
                decodeErr instanceof Error
                  ? decodeErr.message
                  : 'Failed to decode raw media frame image.',
              errorStatus: null,
            });
            break;
          }

          // 1. Scope / abort check after decode
          if (generationRef.current !== streamGeneration || controller.signal.aborted) {
            break;
          }

          // 2. In-flight TTL invalidation check
          if (thisDecodeGen !== inFlightDecodeGeneration) {
            // Invalidate in-flight decoding when TTL expired or superseded
            nextToDecode = pendingFrame;
            pendingFrame = null;
            continue;
          }

          // 3. Monotonic sequence check AFTER decode (within same sessionId)
          const seq = BigInt(frameToProcess.sequenceNumber);
          if (frameToProcess.sessionId === committedSessionId) {
            if (seq <= lastCommittedSeq) {
              // Older slow decode must NEVER overwrite newer frame!
              nextToDecode = pendingFrame;
              pendingFrame = null;
              continue;
            }
          }

          // 4. Recheck capturedAt age (<2000ms / future <= 1000ms) AFTER decode
          const currentTime = now ? now() : Date.now();
          const capturedTime = Date.parse(frameToProcess.capturedAt);
          if (!Number.isFinite(capturedTime)) {
            nextToDecode = pendingFrame;
            pendingFrame = null;
            continue;
          }
          const ageMs = currentTime - capturedTime;
          const futureMs = capturedTime - currentTime;
          if (ageMs >= 2000 || futureMs > 1000) {
            // Frame became stale during decoding!
            nextToDecode = pendingFrame;
            pendingFrame = null;
            continue;
          }

          // 5. Valid! Commit decoded frame and image
          lastCommittedSeq = seq;
          committedSessionId = frameToProcess.sessionId;

          setCommittedState({
            scopeKey: currentScopeKey,
            image: decodedImg,
            frame: frameToProcess,
            status: 'LIVE',
            error: null,
            errorStatus: null,
          });

          // 6. TTL uses REMAINING capture lifetime, not flat 2000ms after decoding!
          const remainingTtlMs = Math.max(0, 2000 - ageMs);
          if (stallTimerRef.current) {
            clearTimeout(stallTimerRef.current);
            stallTimerRef.current = null;
          }

          if (remainingTtlMs <= 0) {
            // Frame already reached 2s age threshold
            inFlightDecodeGeneration++;
            pendingFrame = null;
            setCommittedState({
              scopeKey: currentScopeKey,
              image: null,
              frame: null,
              status: 'STALLED',
              error: null,
              errorStatus: null,
            });
          } else {
            stallTimerRef.current = setTimeout(() => {
              if (generationRef.current !== streamGeneration || controller.signal.aborted) {
                return;
              }
              // TTL invalidates any in-flight decoding and queued pending frames
              inFlightDecodeGeneration++;
              pendingFrame = null;
              setCommittedState({
                scopeKey: currentScopeKey,
                image: null,
                frame: null,
                status: 'STALLED',
                error: null,
                errorStatus: null,
              });
            }, remainingTtlMs);
          }

          // Check if a newer frame arrived while decoding
          nextToDecode = pendingFrame;
          pendingFrame = null;
        }
      } finally {
        isDecoding = false;
        pendingFrame = null;
      }
    };

    const onFrame = (incomingFrame: CameraMediaFrame) => {
      if (generationRef.current !== streamGeneration || controller.signal.aborted) {
        return;
      }
      if (isDecoding) {
        // Retain ONLY newest pending frame, dropping older queued ones
        pendingFrame = incomingFrame;
      } else {
        runDecodeLoop(incomingFrame);
      }
    };

    managementClient
      .streamCameraVideo(
        token,
        siteId,
        cameraId,
        onFrame,
        {
          signal: controller.signal,
          expectedCameraExternalId: cameraExternalId,
          now,
        },
      )
      .then(() => {
        // Graceful stream EOF reached
        if (generationRef.current !== streamGeneration || controller.signal.aborted) {
          return;
        }
        inFlightDecodeGeneration++;
        pendingFrame = null;
        if (stallTimerRef.current) {
          clearTimeout(stallTimerRef.current);
          stallTimerRef.current = null;
        }
        setCommittedState({
          scopeKey: currentScopeKey,
          image: null,
          frame: null,
          status: 'UNAVAILABLE',
          error: 'Video stream disconnected (EOF).',
          errorStatus: null,
        });
        // Bounded reconnect for graceful EOF (same as failure)
        reconnectTimerRef.current = setTimeout(() => {
          if (generationRef.current === streamGeneration && !document.hidden) {
            setRetryTrigger((c) => c + 1);
          }
        }, 1000);
      })
      .catch((err: unknown) => {
        if (generationRef.current !== streamGeneration || controller.signal.aborted) {
          return;
        }
        inFlightDecodeGeneration++;
        pendingFrame = null;
        if (stallTimerRef.current) {
          clearTimeout(stallTimerRef.current);
          stallTimerRef.current = null;
        }

        if (err instanceof ApiError) {
          if (err.status === 401 || err.status === 403) {
            // Permanent HALT on 401/403
            policy.halted = true;
            policy.error = err.message;
            policy.errorStatus = err.status;
            setCommittedState({
              scopeKey: currentScopeKey,
              image: null,
              frame: null,
              status: 'HALTED',
              error: err.message,
              errorStatus: err.status,
            });
            if (err.status === 401 && typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('smartsite:session-expired', {
                detail: { sessionScopes: [sessionScope] },
              }));
            }
            return;
          }

          if (err.status === 429) {
            const retryDelayMs = Math.max(1000, (err.retryAfterSeconds ?? 1) * 1000);
            policy.retryAt = Date.now() + retryDelayMs;
            policy.error = err.message;
            policy.errorStatus = 429;
            setCommittedState({
              scopeKey: currentScopeKey,
              image: null,
              frame: null,
              status: 'UNAVAILABLE',
              error: err.message,
              errorStatus: 429,
            });
            reconnectTimerRef.current = setTimeout(() => {
              if (generationRef.current === streamGeneration && !document.hidden) {
                setRetryTrigger((c) => c + 1);
              }
            }, retryDelayMs);
            return;
          }

          // 503 or other HTTP error
          setCommittedState({
            scopeKey: currentScopeKey,
            image: null,
            frame: null,
            status: 'UNAVAILABLE',
            error: err.message,
            errorStatus: err.status ?? null,
          });
          reconnectTimerRef.current = setTimeout(() => {
            if (generationRef.current === streamGeneration && !document.hidden) {
              setRetryTrigger((c) => c + 1);
            }
          }, 2000);
          return;
        }

        // Network or stream cancellation
        setCommittedState({
          scopeKey: currentScopeKey,
          image: null,
          frame: null,
          status: 'UNAVAILABLE',
          error: err instanceof Error ? err.message : 'Media stream connection error.',
          errorStatus: null,
        });
        reconnectTimerRef.current = setTimeout(() => {
          if (generationRef.current === streamGeneration && !document.hidden) {
            setRetryTrigger((c) => c + 1);
          }
        }, 2000);
      });

    return () => {
      generation.current++;
      controller.abort();
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
      inFlightDecodeGeneration++;
      pendingFrame = null;
      if (stallTimerRef.current) {
        clearTimeout(stallTimerRef.current);
        stallTimerRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
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
    isLive,
    enabled,
    isScopeReady,
    isDocumentVisible,
    retryTrigger,
    now,
  ]);

  // Synchronous scope guard: if current scope does not match committed state,
  // return null immediately (zero render flash of old camera images before effect runs)
  const isScopeMatch = committedState.scopeKey === currentScopeKey;
  const activeImage = isScopeMatch ? committedState.image : null;
  const activeFrame = isScopeMatch ? committedState.frame : null;
  const activeError = isScopeMatch ? committedState.error : null;
  const activeErrorStatus = isScopeMatch ? committedState.errorStatus : null;
  const activeStatus: ScopedMediaStatus = isScopeMatch
    ? committedState.status
    : isScopeReady && isDocumentVisible
      ? 'CONNECTING'
      : 'IDLE';

  return {
    image: activeImage,
    frame: activeFrame,
    status: activeStatus,
    error: activeError,
    errorStatus: activeErrorStatus,
    isStreaming: activeStatus === 'LIVE',
    retry,
  };
}
