import React from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '@smartsite/api-client';
import { CAMERA_BUTTON_STYLES } from '../cameras/camera-dialog-styles';
import { IconAlertTriangle } from '../icons';
import { registerFeatureCatalog } from '../../i18n/feature-catalog-registry';
import { useLocale } from '../../i18n/ppe-locale';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import { getConfigurationReferenceErrorMessage } from './cameraRegionReferenceUtils';
import type { NormalizedPoint } from './region-polygon-geometry';
import type { CameraConfigurationReference } from './useCameraConfigurationReference';

const DETAILS_DISCLOSURE_KEY = 'regionSetup.reference.detailsDisclosure';

const en = {
  [DETAILS_DISCLOSURE_KEY]: 'Reference details & timestamps',
} as const;

const vi: Record<keyof typeof en, string> = {
  [DETAILS_DISCLOSURE_KEY]: 'Chi tiết & thời gian ảnh tham chiếu',
};

function ensureReferenceControlsCatalog(): void {
  registerFeatureCatalog({ en, vi });
}

ensureReferenceControlsCatalog();

export interface CameraRegionReferenceStatusCardProps {
  reference: CameraConfigurationReference | null;
  isExpired: boolean;
  expectedConfigurationVersion?: number | null;
  isLoading: boolean;
  error: ApiError | null;
  canRequest: boolean;
  isDrawingActive: boolean;
  onRequestReference: () => void;
}

export function CameraRegionReferenceStatusCard({
  reference,
  isExpired,
  expectedConfigurationVersion,
  isLoading,
  error,
  canRequest,
  isDrawingActive,
  onRequestReference,
}: CameraRegionReferenceStatusCardProps) {
  ensureReferenceControlsCatalog();
  const { t } = useLocale();
  const { t: tSafety } = useTranslation(SAFETY_NAMESPACE);
  const errorMessage = getConfigurationReferenceErrorMessage(error, t);
  const isRevisionMismatch = Boolean(
    reference &&
    typeof expectedConfigurationVersion === 'number' &&
    reference.configurationVersion !== expectedConfigurationVersion,
  );

  return (
    <div className="min-w-0 space-y-2.5 rounded-2xl border border-slate-200/90 bg-slate-50/90 p-3.5 text-xs text-slate-700 shadow-xs">
      <div className="min-w-0 flex flex-wrap items-center justify-between gap-2.5">
        <div className="min-w-0 flex flex-1 flex-wrap items-center gap-2">
          <p className="min-w-0 break-words [overflow-wrap:anywhere] text-xs font-semibold text-[#111111]">
            {t('regionSetup.reference.heading')}
          </p>

          {reference && (
            <div className="min-w-0 flex flex-wrap items-center gap-1.5 font-mono text-[11px] tabular-nums">
              <span
                className={`inline-flex items-center rounded-full border px-2.5 py-0.5 font-bold uppercase tracking-wider ${
                  reference.sourceKind === 'LIVE'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-amber-200 bg-amber-50 text-amber-900'
                }`}
              >
                {reference.sourceKind}
              </span>
              <span className="inline-flex max-w-full items-center break-words rounded-full border border-slate-200 bg-white px-2.5 py-0.5 font-semibold text-slate-700">
                {t('regionSetup.reference.revisionBadge', {
                  version: reference.configurationVersion,
                })}
              </span>
              {isExpired && (
                <span className="inline-flex max-w-full items-center break-words rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 font-semibold text-rose-800">
                  {t('regionSetup.reference.expiredBadge')}
                </span>
              )}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onRequestReference}
          disabled={!canRequest || isLoading}
          aria-label={
            isDrawingActive
              ? t('regionSetup.reference.reviewNewBtn')
              : t('regionSetup.reference.getBtn')
          }
          className={`${CAMERA_BUTTON_STYLES.compactSecondary} min-w-0 max-w-full break-words [overflow-wrap:anywhere] whitespace-normal text-left`}
        >
          {isDrawingActive
            ? isLoading
              ? t('regionSetup.reference.loadingCandidateBtn')
              : t('regionSetup.reference.reviewNewBtn')
            : isLoading
              ? t('regionSetup.reference.loadingBtn')
              : t('regionSetup.reference.getBtn')}
        </button>
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="min-w-0 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800"
        >
          <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">{errorMessage}</span>
        </div>
      )}

      {!isDrawingActive && !reference && !errorMessage && (
        <p className="min-w-0 break-words [overflow-wrap:anywhere] text-xs text-slate-600">
          {t('regionSetup.reference.noneLoadedHint')}
        </p>
      )}

      {!isDrawingActive && reference && isExpired && (
        <p className="min-w-0 break-words [overflow-wrap:anywhere] text-xs font-medium text-amber-800">
          {t('regionSetup.reference.expiredHint')}
        </p>
      )}

      {!isDrawingActive && reference && !isExpired && isRevisionMismatch && (
        <p className="min-w-0 break-words [overflow-wrap:anywhere] text-xs font-medium text-amber-800">
          {t('regionSetup.reference.revisionChangedHint', {
            version: expectedConfigurationVersion!,
          })}
        </p>
      )}

      <details
        data-testid="reference-status-details"
        className="group/ref-details min-w-0 text-[11px] text-slate-500"
      >
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-slate-500 hover:bg-slate-200/60 hover:text-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900">
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">
            {tSafety(DETAILS_DISCLOSURE_KEY)}
          </span>
          <span
            aria-hidden="true"
            className="shrink-0 text-[10px] text-slate-400 transition-transform duration-150 group-open/ref-details:rotate-180"
          >
            ▾
          </span>
        </summary>
        <div className="mt-1.5 min-w-0 space-y-1.5 rounded-xl border border-slate-200/80 bg-white px-3 py-2 text-xs text-slate-600">
          <p className="min-w-0 break-words [overflow-wrap:anywhere] leading-relaxed text-[#6B6B6B]">
            {t('regionSetup.reference.purposeNote')}
          </p>
          {reference && (
            <div className="min-w-0 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] tabular-nums text-slate-600">
              <span className="min-w-0 max-w-full break-all">
                {t('regionSetup.reference.capturedAt', { time: reference.frame.capturedAt })}
              </span>
              <span className="min-w-0 max-w-full break-all">
                {t('regionSetup.reference.expiresAt', { time: reference.referenceExpiresAt })}
              </span>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

export interface CameraRegionCandidateReviewPanelProps {
  candidateReference: CameraConfigurationReference;
  isCandidateExpired: boolean;
  draftPoints: NormalizedPoint[];
  isSaving: boolean;
  onAcceptCandidate: () => void;
  onCancelReview: () => void;
}

export function CameraRegionCandidateReviewPanel({
  candidateReference,
  isCandidateExpired,
  draftPoints,
  isSaving,
  onAcceptCandidate,
  onCancelReview,
}: CameraRegionCandidateReviewPanelProps) {
  ensureReferenceControlsCatalog();
  const { t } = useLocale();
  const { t: tSafety } = useTranslation(SAFETY_NAMESPACE);
  const { frame } = candidateReference;

  return (
    <div
      role="region"
      aria-label={t('regionSetup.reference.candidateHeading')}
      className="min-w-0 space-y-3 rounded-2xl border border-amber-300 bg-amber-50/90 p-3.5 text-xs text-amber-950"
    >
      <div className="min-w-0 space-y-1.5">
        <div className="min-w-0 flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 break-words [overflow-wrap:anywhere] text-xs font-bold text-[#111111]">
            {t('regionSetup.reference.candidateHeading')}
          </p>
          <div className="min-w-0 flex flex-wrap items-center gap-1.5 font-mono text-[11px] tabular-nums text-amber-950">
            <span className="rounded-md border border-amber-300 bg-white px-2 py-0.5 font-bold uppercase">
              {candidateReference.sourceKind}
            </span>
            <span className="rounded-md border border-amber-300 bg-white px-2 py-0.5 font-semibold">
              v{candidateReference.configurationVersion}
            </span>
            {isCandidateExpired && (
              <span className="rounded-md border border-rose-200 bg-rose-50 px-2 py-0.5 font-semibold text-rose-800">
                {t('regionSetup.reference.expiredBadge')}
              </span>
            )}
          </div>
        </div>
        <p className="min-w-0 break-words [overflow-wrap:anywhere] text-xs leading-relaxed text-amber-900">
          {t('regionSetup.reference.candidateDescription', {
            version: candidateReference.configurationVersion,
          })}
        </p>
        <details
          data-testid="candidate-reference-details"
          className="group/candidate-details min-w-0 text-[11px] text-amber-900"
        >
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-amber-900 hover:bg-amber-100/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-950">
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">
              {tSafety(DETAILS_DISCLOSURE_KEY)}
            </span>
            <span
              aria-hidden="true"
              className="shrink-0 text-[10px] text-amber-700 transition-transform duration-150 group-open/candidate-details:rotate-180"
            >
              ▾
            </span>
          </summary>
          <div className="mt-1.5 min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-amber-200/90 bg-white/90 px-3 py-2 font-mono text-[11px] tabular-nums text-amber-950">
            <span className="min-w-0 max-w-full break-all">
              {t('regionSetup.reference.capturedAt', { time: candidateReference.frame.capturedAt })}
            </span>
            <span aria-hidden="true">·</span>
            <span className="min-w-0 max-w-full break-all">
              {t('regionSetup.reference.expiresAt', {
                time: candidateReference.referenceExpiresAt,
              })}
            </span>
          </div>
        </details>
      </div>

      <div
        className="relative w-full max-w-md border border-slate-800 rounded-xl overflow-hidden bg-slate-950 select-none"
        style={{ aspectRatio: `${frame.width} / ${frame.height}` }}
      >
        {isCandidateExpired ? (
          <div className="absolute inset-0 flex items-center justify-center p-3 text-center text-xs text-amber-200">
            {t('regionSetup.reference.candidateExpiredNotice')}
          </div>
        ) : (
          <svg
            aria-label={t('regionSetup.reference.candidateCanvasAria')}
            viewBox={`0 0 ${frame.width} ${frame.height}`}
            preserveAspectRatio="xMidYMid meet"
            className="absolute inset-0 w-full h-full pointer-events-none"
          >
            <image href={frame.imageDataUrl} width={frame.width} height={frame.height} />
            {draftPoints.length >= 2 && (
              <polyline
                points={draftPoints
                  .map(([x, y]) => `${x * frame.width},${y * frame.height}`)
                  .join(' ')}
                fill={draftPoints.length >= 3 ? 'rgba(59, 130, 246, 0.25)' : 'none'}
                stroke="#3B82F6"
                strokeWidth="2.5"
                strokeDasharray={draftPoints.length >= 3 ? 'none' : '4 2'}
              />
            )}
            {draftPoints.map(([x, y], idx) => (
              <circle
                key={idx}
                cx={x * frame.width}
                cy={y * frame.height}
                r="5"
                fill="#3B82F6"
                stroke="#FFFFFF"
                strokeWidth="2"
              />
            ))}
          </svg>
        )}
      </div>

      <div className="min-w-0 flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancelReview}
          disabled={isSaving}
          data-control-priority="subordinate"
          className={`${CAMERA_BUTTON_STYLES.compactSecondary} min-w-0 max-w-full break-words [overflow-wrap:anywhere] whitespace-normal text-left`}
        >
          {t('regionSetup.reference.cancelReviewBtn')}
        </button>
        <button
          type="button"
          onClick={onAcceptCandidate}
          disabled={isCandidateExpired || isSaving}
          data-control-priority="primary"
          className={`${CAMERA_BUTTON_STYLES.primary} min-w-0 max-w-full break-words [overflow-wrap:anywhere] whitespace-normal text-left`}
        >
          {t('regionSetup.reference.useNewBtn')}
        </button>
      </div>
    </div>
  );
}
