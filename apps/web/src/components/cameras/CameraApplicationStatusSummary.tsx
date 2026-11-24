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

const STATE_TEXT_TONES = {
  LOADED: { dot: 'bg-emerald-600', text: 'text-emerald-800' },
  PENDING: { dot: 'bg-amber-600', text: 'text-amber-900' },
  UNCONFIRMED: { dot: 'bg-amber-600', text: 'text-amber-900' },
  REJECTED: { dot: 'bg-rose-600', text: 'text-rose-800' },
  STALE: { dot: 'bg-rose-600', text: 'text-rose-800' },
} as const;

const VIEW_VALIDITY_TONES = {
  UNCONFIRMED: { text: 'text-slate-600', dot: 'bg-slate-400' },
  NEEDS_REVALIDATION: { text: 'font-medium text-amber-900', dot: 'bg-amber-600' },
  UNAVAILABLE: { text: 'font-medium text-amber-900', dot: 'bg-amber-600' },
} as const;

export type {
  CameraApplicationStatusClient,
  CameraApplicationStatusContext,
  CameraApplicationStatusResult,
};

export function CameraApplicationStatusSummary({
  camera,
  context,
  compact = false,
}: {
  camera: CameraResponse;
  context?: CameraApplicationStatusContext;
  compact?: boolean;
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
        className={
          compact
            ? 'min-w-0 space-y-1.5 border-t border-slate-100 pt-2 text-sm text-slate-700'
            : 'mt-2 min-w-0 space-y-1.5 border-t border-slate-200 pt-3 text-sm text-slate-700'
        }
      >
        <div className="min-w-0 flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 font-medium text-slate-900 break-words [overflow-wrap:anywhere]">
            {t('cameraSetup.appStatus.unavailablePrimary')}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <details
              data-testid="camera-application-technical-details"
              className="group min-w-0 text-xs text-slate-600"
            >
              <summary className="inline-flex min-h-7 cursor-pointer list-none items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900">
                <span>{t('cameraSetup.appStatus.details')}</span>
                <span
                  aria-hidden="true"
                  className="text-xs text-slate-500 transition-transform duration-150 group-open:rotate-180"
                >
                  ▾
                </span>
              </summary>
              <div className="mt-1 min-w-0 space-y-1 rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs text-slate-600">
                <p className="min-w-0 break-words [overflow-wrap:anywhere] font-mono tabular-nums">
                  {t('cameraSetup.appStatus.savedOnlyVersion', {
                    version: camera.configurationVersion,
                  })}
                </p>
                <p className="min-w-0 break-words [overflow-wrap:anywhere]">
                  {t('cameraSetup.appStatus.caveat')}
                </p>
              </div>
            </details>
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
        </div>
        {query.isFetching && (
          <p className="min-w-0 break-words [overflow-wrap:anywhere] text-sm text-slate-600">
            {t('cameraSetup.appStatus.checking')}
          </p>
        )}
        {query.isError && !query.isFetching && errorStatus !== 401 && (
          <p className="min-w-0 break-words [overflow-wrap:anywhere] text-sm text-amber-900">
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

  const stateTone = STATE_TEXT_TONES[effectiveState];
  const viewValidityTone = VIEW_VALIDITY_TONES[rawStatus.viewValidity];
  const reasonGuidanceBlock =
    effectiveState !== 'LOADED' && (reasonDescription || actionGuidance) ? (
      <div
        data-testid="camera-application-reason-guidance"
        className={`min-w-0 space-y-1 rounded-lg border px-2.5 py-1.5 text-xs ${
          effectiveState === 'REJECTED' || effectiveState === 'STALE'
            ? 'border-rose-200 bg-rose-50/70 text-rose-950'
            : 'border-amber-200 bg-amber-50/70 text-amber-950'
        }`}
      >
        {effectiveReasonCode && reasonDescription && (
          <p className="min-w-0 font-medium break-words [overflow-wrap:anywhere]">
            {t('cameraSetup.appStatus.reasonLine', {
              reason: reasonDescription,
            })}
          </p>
        )}
        {actionGuidance && (
          <p className="min-w-0 break-words [overflow-wrap:anywhere]">{actionGuidance}</p>
        )}
      </div>
    ) : null;
  const showInlineReasonInCompact = effectiveState === 'REJECTED';
  const technicalDetailsContent = (
    <div className="mt-1.5 min-w-0 space-y-1.5 rounded-xl border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs text-slate-600">
      {compact && !showInlineReasonInCompact && reasonGuidanceBlock}
      <p className="min-w-0 break-words [overflow-wrap:anywhere] font-mono tabular-nums">
        {t('cameraSetup.appStatus.revisions', {
          desired: rawStatus.desiredRevision,
          reported: reportedLabel,
        })}
      </p>
      {effectiveReasonCode && (
        <p className="min-w-0 break-words [overflow-wrap:anywhere] font-mono">
          {t('cameraSetup.appStatus.reasonCodeLine', { code: effectiveReasonCode })}
        </p>
      )}
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
  );

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="false"
      data-testid="camera-application-status"
      data-application-state={effectiveState}
      data-view-validity={rawStatus.viewValidity}
      className={
        compact
          ? 'min-w-0 space-y-1 border-t border-slate-100 pt-1.5 text-xs text-slate-700'
          : 'mt-2 min-w-0 space-y-2 border-t border-slate-200 pt-3 text-sm text-slate-700'
      }
    >
      <div
        className={`min-w-0 flex gap-x-2 gap-y-1 ${
          compact
            ? 'flex-col sm:flex-row sm:flex-nowrap sm:items-center sm:justify-between'
            : 'flex-wrap items-center justify-between'
        }`}
      >
        <div className="min-w-0 flex flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span
            data-testid="camera-application-primary-status"
            className={`inline-flex shrink-0 items-center gap-1.5 font-semibold ${compact ? 'text-xs' : 'text-sm'} ${stateTone.text}`}
          >
            <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${stateTone.dot}`} />
            {t(`cameraSetup.appStatus.state.${effectiveState}`)}
          </span>
          {compact && (
            <span
              data-testid="camera-view-validity-warning"
              className={`inline-flex min-w-0 items-center gap-1.5 break-words [overflow-wrap:anywhere] text-xs ${viewValidityTone.text}`}
            >
              <span aria-hidden="true" className="text-slate-300">
                ·
              </span>
              <span>{t(`cameraSetup.appStatus.viewValidity.${rawStatus.viewValidity}`)}</span>
            </span>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {compact && (
            <details
              data-testid="camera-application-technical-details"
              className="group min-w-0 text-xs text-slate-600"
            >
              <summary className="inline-flex min-h-7 cursor-pointer list-none items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900">
                <span>{t('cameraSetup.appStatus.details')}</span>
                <span
                  aria-hidden="true"
                  className="text-xs text-slate-500 transition-transform duration-150 group-open:rotate-180"
                >
                  ▾
                </span>
              </summary>
              {technicalDetailsContent}
            </details>
          )}
          <button
            type="button"
            className={
              compact
                ? 'inline-flex min-h-7 items-center justify-center rounded-lg border border-slate-300 bg-white px-2.5 py-0.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F172A] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer'
                : CAMERA_BUTTON_STYLES.compactSecondary
            }
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {t('cameraSetup.appStatus.refresh')}
          </button>
        </div>
      </div>
      {(!compact || showInlineReasonInCompact) && reasonGuidanceBlock}
      {!compact && (
        <>
          <p
            data-testid="camera-view-validity-warning"
            className={`flex min-w-0 items-start gap-2 break-words [overflow-wrap:anywhere] text-sm ${viewValidityTone.text}`}
          >
            <span
              aria-hidden="true"
              className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${viewValidityTone.dot}`}
            />
            <span>{t(`cameraSetup.appStatus.viewValidity.${rawStatus.viewValidity}`)}</span>
          </p>
          <details
            data-testid="camera-application-technical-details"
            className="group min-w-0 text-xs text-slate-600"
          >
            <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1.5 rounded-lg px-1.5 py-1 font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900">
              <span>{t('cameraSetup.appStatus.details')}</span>
              <span
                aria-hidden="true"
                className="text-xs text-slate-500 transition-transform duration-150 group-open:rotate-180"
              >
                ▾
              </span>
            </summary>
            {technicalDetailsContent}
          </details>
        </>
      )}
    </div>
  );
}
