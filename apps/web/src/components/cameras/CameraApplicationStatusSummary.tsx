import { useTranslation } from 'react-i18next';
import type { CameraResponse } from '@smartsite/contracts/management';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import { CAMERA_BUTTON_STYLES } from './camera-dialog-styles';
import {
  KNOWN_APPLICATION_STATUS_ACTION_KEYS,
  KNOWN_APPLICATION_STATUS_REASON_KEYS,
} from './camera-application-status-copy';
import {
  useCameraApplicationStatus,
  type CameraApplicationStatusClient,
  type CameraApplicationStatusContext,
  type CameraApplicationStatusResult,
} from './useCameraApplicationStatus';

const STATE_BADGE_TONES = {
  LOADED: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  PENDING: 'border-amber-200 bg-amber-50 text-amber-950',
  UNCONFIRMED: 'border-amber-200 bg-amber-50 text-amber-950',
  REJECTED: 'border-rose-200 bg-rose-50 text-rose-900',
  STALE: 'border-rose-200 bg-rose-50 text-rose-900',
} as const;

export type {
  CameraApplicationStatusClient,
  CameraApplicationStatusContext,
  CameraApplicationStatusResult,
};

export function CameraApplicationStatusSummary({
  camera,
  context,
}: {
  camera: CameraResponse;
  context?: CameraApplicationStatusContext;
}) {
  const { t } = useTranslation(SAFETY_NAMESPACE);
  const { query, canQuery, errorStatus, verifiedPayload, effectiveState, effectiveReasonCode } =
    useCameraApplicationStatus(camera, context);

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
          <p className="min-w-0 break-words [overflow-wrap:anywhere] text-xs text-slate-500">
            {t('cameraSetup.appStatus.checking')}
          </p>
        )}
        {query.isError && !query.isFetching && errorStatus !== 401 && (
          <p className="min-w-0 break-words [overflow-wrap:anywhere] text-xs text-amber-900">
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
  if (!effectiveState) {
    return null;
  }
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
  const actionKey = effectiveReasonCode
    ? (KNOWN_APPLICATION_STATUS_ACTION_KEYS[effectiveReasonCode] ??
      (effectiveState === 'REJECTED'
        ? 'cameraSetup.appStatus.action.REJECTED_DEFAULT'
        : 'cameraSetup.appStatus.action.OTHER'))
    : effectiveState === 'REJECTED'
      ? 'cameraSetup.appStatus.action.REJECTED_DEFAULT'
      : null;
  const actionGuidance = effectiveState !== 'LOADED' && actionKey ? t(actionKey) : null;

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
        <div className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1 tabular-nums">
          <span className="text-xs sm:text-sm font-semibold text-slate-900">
            {t('cameraSetup.appStatus.revisions', {
              desired: rawStatus.desiredRevision,
              reported: reportedLabel,
            })}
          </span>
          <span
            className={`rounded-md border px-2.5 py-0.5 text-xs font-semibold ${STATE_BADGE_TONES[effectiveState]}`}
          >
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
      {effectiveState !== 'LOADED' && (reasonDescription || actionGuidance) && (
        <div
          data-testid="camera-application-reason-guidance"
          className={`min-w-0 space-y-1 rounded-lg border px-3 py-2 text-xs ${
            effectiveState === 'REJECTED' || effectiveState === 'STALE'
              ? 'border-rose-200 bg-rose-50/90 text-rose-950'
              : 'border-amber-200 bg-amber-50/80 text-amber-950'
          }`}
        >
          {effectiveReasonCode && reasonDescription && (
            <p className="min-w-0 font-medium break-words [overflow-wrap:anywhere]">
              {t('cameraSetup.appStatus.reasonLine', {
                reason: reasonDescription,
                code: effectiveReasonCode,
              })}
            </p>
          )}
          {actionGuidance && (
            <p className="min-w-0 break-words [overflow-wrap:anywhere]">{actionGuidance}</p>
          )}
        </div>
      )}
      <p
        data-testid="camera-view-validity-warning"
        className="min-w-0 break-words [overflow-wrap:anywhere] text-xs font-medium text-amber-900"
      >
        {t(`cameraSetup.appStatus.viewValidity.${rawStatus.viewValidity}`)}
      </p>
      <details className="group min-w-0 text-xs text-slate-500">
        <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1.5 rounded-lg px-2 py-1 font-medium text-slate-600 hover:bg-slate-200/60 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900">
          <span>{t('cameraSetup.appStatus.details')}</span>
          <span
            aria-hidden="true"
            className="text-xs text-slate-400 transition-transform duration-150 group-open:rotate-180"
          >
            ▾
          </span>
        </summary>
        <div className="mt-1.5 min-w-0 space-y-1 rounded-lg border border-slate-200/80 bg-white px-3 py-2 text-xs text-slate-600">
          <p className="min-w-0 break-words [overflow-wrap:anywhere] font-mono tabular-nums">
            {t('cameraSetup.appStatus.timestamps', {
              observedAt: rawStatus.observedAt,
              lastReceiptAt: lastReceiptLabel,
            })}
          </p>
          <p className="min-w-0 break-words [overflow-wrap:anywhere]">
            {t('cameraSetup.appStatus.caveat')}
          </p>
        </div>
      </details>
    </div>
  );
}
