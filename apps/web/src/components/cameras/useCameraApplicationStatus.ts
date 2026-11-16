import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { RequestOptions } from '@smartsite/api-client';
import {
  parseCameraApplicationStatus,
  type CameraApplicationStatus,
} from '@smartsite/contracts/camera-application-status';
import type { CameraResponse } from '@smartsite/contracts/management';

export const CAMERA_APPLICATION_RECEIPT_MAX_AGE_MS = 60_000;

export interface CameraApplicationStatusClient {
  getCameraApplicationStatus?: (
    token: string,
    siteId: string,
    cameraId: string,
    options?: RequestOptions,
  ) => Promise<CameraApplicationStatus>;
}

export interface CameraApplicationStatusContext {
  readonly setupKey: readonly unknown[];
  readonly token: string;
  readonly siteId: string;
  readonly client: CameraApplicationStatusClient;
  readonly enabled: boolean;
  readonly onUnauthorized: () => void;
}

export interface CameraApplicationStatusResult {
  readonly query: {
    readonly isFetching: boolean;
    readonly isPending: boolean;
    readonly isError: boolean;
    readonly refetch: () => Promise<unknown>;
  };
  readonly canQuery: boolean;
  readonly errorStatus: number | undefined;
  readonly verifiedPayload:
    | {
        readonly status: CameraApplicationStatus;
        readonly fetchedAtMonotonicMs: number;
      }
    | undefined;
  readonly effectiveState: CameraApplicationStatus['applicationState'] | undefined;
  readonly effectiveReasonCode: string | null;
}

function setupErrorStatus(error: unknown): number | undefined {
  return error && typeof error === 'object' && 'status' in error && typeof error.status === 'number'
    ? error.status
    : undefined;
}

function nowMonotonicMs(): number {
  return performance.now();
}

function getRemainingLoadedFreshnessMs(
  status: CameraApplicationStatus,
  fetchedAtMonotonicMs: number,
  currentMonotonicMs: number,
): number {
  if (status.applicationState !== 'LOADED' || !status.lastReceiptAt) return 0;
  const serverAgeMs = Date.parse(status.observedAt) - Date.parse(status.lastReceiptAt);
  if (
    !Number.isFinite(serverAgeMs) ||
    serverAgeMs < 0 ||
    serverAgeMs >= CAMERA_APPLICATION_RECEIPT_MAX_AGE_MS ||
    !Number.isFinite(fetchedAtMonotonicMs) ||
    !Number.isFinite(currentMonotonicMs) ||
    currentMonotonicMs < fetchedAtMonotonicMs
  ) {
    return 0;
  }
  const elapsedClientMs = currentMonotonicMs - fetchedAtMonotonicMs;
  return Math.max(0, CAMERA_APPLICATION_RECEIPT_MAX_AGE_MS - serverAgeMs - elapsedClientMs);
}

export function useCameraApplicationStatus(
  camera: Pick<CameraResponse, 'id' | 'siteId' | 'configurationVersion'>,
  context?: CameraApplicationStatusContext,
): CameraApplicationStatusResult {
  const [, setTick] = useState(0);
  const fetchFn = context?.client.getCameraApplicationStatus;
  const canQuery = Boolean(context?.enabled && typeof fetchFn === 'function');

  const query = useQuery({
    queryKey: [
      ...(context?.setupKey ?? ['camera-setup']),
      context?.siteId ?? camera.siteId,
      'application-status',
      camera.id,
      camera.configurationVersion,
    ],
    enabled: canQuery,
    queryFn: async ({ signal }) => {
      const raw = await fetchFn!.call(context!.client, context!.token, context!.siteId, camera.id, {
        signal,
      });
      signal.throwIfAborted();
      const parsed = parseCameraApplicationStatus(raw);
      if (
        !parsed ||
        parsed.siteId.toLowerCase() !== context!.siteId.toLowerCase() ||
        parsed.cameraId.toLowerCase() !== camera.id.toLowerCase() ||
        parsed.desiredRevision !== camera.configurationVersion
      ) {
        throw new Error('Invalid camera application status response');
      }
      return { status: parsed, fetchedAtMonotonicMs: nowMonotonicMs() };
    },
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });

  const errorStatus = setupErrorStatus(query.error);

  useEffect(() => {
    if (canQuery && errorStatus === 401) {
      context?.onUnauthorized();
    }
  }, [canQuery, errorStatus, context]);

  const verifiedPayload =
    canQuery &&
    query.isSuccess &&
    !query.isFetching &&
    !query.isError &&
    query.data.status.siteId.toLowerCase() === context!.siteId.toLowerCase() &&
    query.data.status.cameraId.toLowerCase() === camera.id.toLowerCase() &&
    query.data.status.desiredRevision === camera.configurationVersion
      ? query.data
      : undefined;

  const remainingFreshnessMs = verifiedPayload
    ? getRemainingLoadedFreshnessMs(
        verifiedPayload.status,
        verifiedPayload.fetchedAtMonotonicMs,
        nowMonotonicMs(),
      )
    : 0;

  useEffect(() => {
    if (!verifiedPayload || verifiedPayload.status.applicationState !== 'LOADED') return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      const remaining = getRemainingLoadedFreshnessMs(
        verifiedPayload.status,
        verifiedPayload.fetchedAtMonotonicMs,
        nowMonotonicMs(),
      );
      if (remaining <= 0) {
        setTick((n) => n + 1);
        return;
      }
      timer = setTimeout(() => {
        setTick((n) => n + 1);
      }, remaining);
    };
    const onFocusOrVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      setTick((n) => n + 1);
      schedule();
    };
    schedule();
    window.addEventListener('focus', onFocusOrVisibility);
    document.addEventListener('visibilitychange', onFocusOrVisibility);
    return () => {
      if (timer !== null) clearTimeout(timer);
      window.removeEventListener('focus', onFocusOrVisibility);
      document.removeEventListener('visibilitychange', onFocusOrVisibility);
    };
  }, [verifiedPayload]);

  const rawStatus = verifiedPayload?.status;
  const isLocallyExpired = Boolean(
    rawStatus && rawStatus.applicationState === 'LOADED' && remainingFreshnessMs <= 0,
  );
  const effectiveState = rawStatus
    ? isLocallyExpired
      ? 'STALE'
      : rawStatus.applicationState
    : undefined;
  const effectiveReasonCode = rawStatus
    ? isLocallyExpired
      ? 'APPLICATION_RECEIPT_STALE'
      : rawStatus.reasonCode
    : null;

  return {
    query,
    canQuery,
    errorStatus,
    verifiedPayload,
    effectiveState,
    effectiveReasonCode,
  };
}
