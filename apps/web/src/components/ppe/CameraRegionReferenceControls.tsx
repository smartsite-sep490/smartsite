import React from 'react';
import { ApiError } from '@smartsite/api-client';
import { CAMERA_BUTTON_STYLES } from '../cameras/camera-dialog-styles';
import { IconAlertTriangle } from '../icons';
import { useLocale } from '../../i18n/ppe-locale';
import { getConfigurationReferenceErrorMessage } from './cameraRegionReferenceUtils';
import type { NormalizedPoint } from './region-polygon-geometry';
import type { CameraConfigurationReference } from './useCameraConfigurationReference';

export interface CameraRegionReferenceStatusCardProps {
  reference: CameraConfigurationReference | null;
  isExpired: boolean;
  isLoading: boolean;
  error: ApiError | null;
  canRequest: boolean;
  isDrawingActive: boolean;
  onRequestReference: () => void;
}

export function CameraRegionReferenceStatusCard({
  reference,
  isExpired,
  isLoading,
  error,
  canRequest,
  isDrawingActive,
  onRequestReference,
}: CameraRegionReferenceStatusCardProps) {
  const { t } = useLocale();
  const errorMessage = getConfigurationReferenceErrorMessage(error, t);

  return (
    <div className="min-w-0 space-y-2.5 rounded-2xl border border-slate-200/90 bg-slate-50/90 p-3.5 text-xs text-slate-700 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-2.5 min-w-0">
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-xs font-semibold text-[#111111] break-words">
            {t('regionSetup.reference.heading')}
          </p>
          <p className="text-xs leading-relaxed text-[#6B6B6B] break-words">
            {t('regionSetup.reference.purposeNote')}
          </p>
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
          className={CAMERA_BUTTON_STYLES.compactSecondary}
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

      {reference && (
        <div className="flex flex-wrap items-center gap-2 pt-1 font-mono text-[11px] tabular-nums">
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 font-bold uppercase tracking-wider ${
              reference.sourceKind === 'LIVE'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-amber-200 bg-amber-50 text-amber-900'
            }`}
          >
            {reference.sourceKind}
          </span>
          <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-0.5 font-semibold text-slate-700">
            {t('regionSetup.reference.revisionBadge', {
              version: reference.configurationVersion,
            })}
          </span>
          <span className="text-slate-600">
            {t('regionSetup.reference.capturedAt', { time: reference.frame.capturedAt })}
          </span>
          <span className="text-slate-600">
            {t('regionSetup.reference.expiresAt', { time: reference.referenceExpiresAt })}
          </span>
          {isExpired && (
            <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 font-semibold text-rose-800">
              {t('regionSetup.reference.expiredBadge')}
            </span>
          )}
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800 flex items-center gap-2"
        >
          <IconAlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
          <span>{errorMessage}</span>
        </div>
      )}

      {!isDrawingActive && !reference && !errorMessage && (
        <p className="text-xs text-slate-600">{t('regionSetup.reference.noneLoadedHint')}</p>
      )}

      {!isDrawingActive && reference && isExpired && (
        <p className="text-xs text-amber-800">{t('regionSetup.reference.expiredHint')}</p>
      )}
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
  const { t } = useLocale();
  const { frame } = candidateReference;

  return (
    <div
      role="region"
      aria-label={t('regionSetup.reference.candidateHeading')}
      className="min-w-0 space-y-3 rounded-2xl border border-amber-300 bg-amber-50/90 p-3.5 text-xs text-amber-950"
    >
      <div className="space-y-1">
        <p className="text-xs font-bold text-[#111111]">
          {t('regionSetup.reference.candidateHeading')}
        </p>
        <p className="text-xs leading-relaxed text-amber-900">
          {t('regionSetup.reference.candidateDescription', {
            version: candidateReference.configurationVersion,
          })}
        </p>
        <div className="flex flex-wrap items-center gap-2 pt-1 font-mono text-[11px] tabular-nums text-amber-950">
          <span className="rounded-md border border-amber-300 bg-white px-2 py-0.5 font-bold uppercase">
            {candidateReference.sourceKind}
          </span>
          <span className="rounded-md border border-amber-300 bg-white px-2 py-0.5 font-semibold">
            v{candidateReference.configurationVersion}
          </span>
          <span>{candidateReference.frame.capturedAt}</span>
          <span>·</span>
          <span>{candidateReference.referenceExpiresAt}</span>
        </div>
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

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onCancelReview}
          disabled={isSaving}
          className={CAMERA_BUTTON_STYLES.compactSecondary}
        >
          {t('regionSetup.reference.cancelReviewBtn')}
        </button>
        <button
          type="button"
          onClick={onAcceptCandidate}
          disabled={isCandidateExpired || isSaving}
          className={CAMERA_BUTTON_STYLES.primary}
        >
          {t('regionSetup.reference.useNewBtn')}
        </button>
      </div>
    </div>
  );
}
