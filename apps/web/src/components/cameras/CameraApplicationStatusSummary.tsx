import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  parseCameraApplicationStatus,
  type CameraApplicationStatus,
} from '@smartsite/contracts/camera-application-status';
import type { CameraResponse } from '@smartsite/contracts/management';
import type { RequestOptions } from '@smartsite/api-client';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import { CAMERA_BUTTON_STYLES } from './camera-dialog-styles';
import { KNOWN_APPLICATION_STATUS_REASON_KEYS } from './camera-application-status-copy';
import { setupErrorStatus } from './useSetupCatalog';

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

export function CameraApplicationStatusSummary({
  camera,
  context,
}: {
  camera: CameraResponse;
  context?: CameraApplicationStatusContext;
}) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
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

  if (!verifiedPayload) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-busy={query.isFetching ? 'true' : 'false'}
        data-testid="camera-application-status"
        data-application-state="UNAVAILABLE"
        className="mt-2 min-w-0 space-y-1 rounded-lg border border-slate-200/80 bg-slate-50/80 px-3 py-2 text-xs text-slate-600"
      >
        <div className="min-w-0 flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 break-words [overflow-wrap:anywhere]">
            {t('cameraSetup.savedConfigVersionStatus', {
              version: camera.configurationVersion,
            })}
          </p>
          {canQuery && errorStatus !== 401 && errorStatus !== 403 && (
            <button
              type="button"
              className={CAMERA_BUTTON_STYLES.compactSecondary}
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              {t('cameraSetup.appStatus.refresh')}
            </button>
          )}
        </div>
        {query.isFetching && (
          <p className="min-w-0 break-words [overflow-wrap:anywhere] text-[11px] text-slate-500">
            {t('cameraSetup.appStatus.checking')}
          </p>
        )}
        {query.isError && !query.isFetching && errorStatus !== 401 && (
          <p className="min-w-0 break-words [overflow-wrap:anywhere] text-[11px] text-amber-900">
            {t(
              errorStatus === 403 || errorStatus === 404
                ? 'cameraSetup.appStatus.forbidden'
                : 'cameraSetup.appStatus.error',
            )}
          </p>
        )}
      </div>
    );
  }

  const rawStatus = verifiedPayload.status;
  const isLocallyExpired = rawStatus.applicationState === 'LOADED' && remainingFreshnessMs <= 0;
  const effectiveState: CameraApplicationStatus['applicationState'] = isLocallyExpired
    ? 'STALE'
    : rawStatus.applicationState;
  const effectiveReasonCode = isLocallyExpired ? 'APPLICATION_RECEIPT_STALE' : rawStatus.reasonCode;
  const reportedLabel =
    rawStatus.reportedRevision === null
      ? t('cameraSetup.appStatus.reportedNone')
      : t('cameraSetup.appStatus.reportedVersion', { version: rawStatus.reportedRevision });
  const lastReceiptLabel = rawStatus.lastReceiptAt ?? t('cameraSetup.appStatus.reportedNone');
  const reasonKey = effectiveReasonCode
    ? KNOWN_APPLICATION_STATUS_REASON_KEYS[effectiveReasonCode]
    : undefined;
  const reasonDescription = effectiveReasonCode
    ? t(reasonKey ?? 'cameraSetup.appStatus.reason.OTHER')
    : null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="false"
      data-testid="camera-application-status"
      data-application-state={effectiveState}
      data-view-validity={rawStatus.viewValidity}
      className="mt-2 min-w-0 space-y-1.5 rounded-lg border border-slate-200/80 bg-slate-50/80 px-3 py-2 text-xs text-slate-700"
    >
      <div className="min-w-0 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold text-slate-900">
            {t('cameraSetup.appStatus.revisions', {
              desired: rawStatus.desiredRevision,
              reported: reportedLabel,
            })}
          </span>
          <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5 font-medium text-slate-800">
            {t(`cameraSetup.appStatus.state.${effectiveState}`, {
              reported: rawStatus.reportedRevision ?? reportedLabel,
            })}
          </span>
        </div>
        <button
          type="button"
          className={CAMERA_BUTTON_STYLES.compactSecondary}
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          {t('cameraSetup.appStatus.refresh')}
        </button>
      </div>
      <p
        data-testid="camera-view-validity-warning"
        className="min-w-0 break-words [overflow-wrap:anywhere] text-[11px] text-amber-900"
      >
        {t(`cameraSetup.appStatus.viewValidity.${rawStatus.viewValidity}`)}
      </p>
      <details className="group min-w-0 text-[11px] text-slate-500">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md px-1 py-0.5 font-medium text-slate-600 hover:bg-slate-200/60 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900">
          <span>{t('cameraSetup.appStatus.details')}</span>
          <span
            aria-hidden="true"
            className="text-[10px] text-slate-400 transition-transform duration-150 group-open:rotate-180"
          >
            ▾
          </span>
        </summary>
        <div className="mt-1 min-w-0 space-y-1 rounded-md border border-slate-200/80 bg-white px-2.5 py-1.5 text-slate-600">
          <p className="min-w-0 break-words [overflow-wrap:anywhere] font-mono tabular-nums">
            {t('cameraSetup.appStatus.timestamps', {
              observedAt: rawStatus.observedAt,
              lastReceiptAt: lastReceiptLabel,
            })}
          </p>
          {effectiveReasonCode && reasonDescription && (
            <p className="min-w-0 break-words [overflow-wrap:anywhere] text-amber-900">
              {t('cameraSetup.appStatus.reasonLine', {
                reason: reasonDescription,
                code: effectiveReasonCode,
              })}
            </p>
          )}
          <p className="min-w-0 break-words [overflow-wrap:anywhere]">
            {t('cameraSetup.appStatus.caveat')}
          </p>
        </div>
      </details>
    </div>
  );
}
