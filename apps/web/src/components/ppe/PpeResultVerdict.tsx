import { useTranslation } from 'react-i18next';
import type { PpeResultState } from '../cameras/monitoringUtils';
import type { ScopedPreviewStatus } from '../cameras/useScopedCameraPreview';
import { registerFeatureCatalog } from '../../i18n/feature-catalog-registry';
import { useLocale } from '../../i18n/ppe-locale';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';

export type PpeStreamViewMode = 'live-raw' | 'recorded-raw' | 'ai-analyzed';

export const RECORDED_RAW_UNAVAILABLE_AI_KEY = 'ppe.recordedRaw.unavailableAiDesc';

registerFeatureCatalog({
  en: {
    [RECORDED_RAW_UNAVAILABLE_AI_KEY]:
      'Selected recorded-video view; no synchronized AI snapshot available for PPE inspection.',
  },
  vi: {
    [RECORDED_RAW_UNAVAILABLE_AI_KEY]:
      'Đã chọn chế độ xem video ghi sẵn; không có ảnh chụp AI đồng bộ để kiểm tra PPE.',
  },
});

export interface PpeResultVerdictProps {
  ppeResultState: PpeResultState;
  hasExpandedReported: boolean;
  hasPreview: boolean;
  activeStatus: ScopedPreviewStatus;
  detectionsCount: number;
  effectiveStreamViewMode: PpeStreamViewMode;
  isLive: boolean;
  activeSourceKind: 'LIVE' | 'REPLAY' | null;
}

export function PpeResultVerdict({
  ppeResultState,
  hasExpandedReported,
  hasPreview,
  activeStatus,
  detectionsCount,
  effectiveStreamViewMode,
  isLive,
  activeSourceKind,
}: PpeResultVerdictProps) {
  const { t } = useLocale();
  const { t: tSafety } = useTranslation(SAFETY_NAMESPACE);
  const isFrameUnavailable =
    !hasPreview || !isLive || activeStatus === 'UNAVAILABLE' || activeStatus === 'CONNECTING';
  const isReplay = activeStatus === 'REPLAY' || activeSourceKind === 'REPLAY';

  return (
    <div
      data-testid="ppe-result-verdict"
      role="status"
      aria-live="polite"
      className={`rounded-r-xl border-l-[3px] px-3 py-2 ${
        isFrameUnavailable
          ? 'border-slate-300 bg-slate-50/80'
          : ppeResultState === 'CONFIRMED_MISSING'
            ? 'border-red-500 bg-red-50/50'
            : ppeResultState === 'COMPLIANT'
              ? 'border-emerald-500 bg-emerald-50/40'
              : 'border-slate-300 bg-slate-50/80'
      }`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 mb-0.5">
        {t('ppe.result.label')}
      </p>
      <div
        className={`flex items-center gap-1.5 text-xs font-bold mb-0.5 ${
          isFrameUnavailable
            ? 'text-slate-700'
            : ppeResultState === 'CONFIRMED_MISSING'
              ? 'text-red-600'
              : ppeResultState === 'COMPLIANT'
                ? 'text-emerald-700'
                : 'text-slate-700'
        }`}
      >
        {isFrameUnavailable ? (
          <span>{t('ppe.result.evidenceUnavailable')}</span>
        ) : ppeResultState === 'CONFIRMED_MISSING' ? (
          <span>{t('ppe.result.missingDetected')}</span>
        ) : ppeResultState === 'COMPLIANT' ? (
          hasExpandedReported ? (
            <span>{t('ppe.result.coreAndReportedDetected')}</span>
          ) : (
            <span>{t('ppe.result.helmetAndVestDetected')}</span>
          )
        ) : detectionsCount === 0 ? (
          <span>{t('ppe.result.noObservations')}</span>
        ) : (
          <span>{t('ppe.result.scanningSnapshot')}</span>
        )}
      </div>
      <p className="break-words text-xs text-slate-600 leading-relaxed">
        {isFrameUnavailable
          ? effectiveStreamViewMode === 'live-raw'
            ? t('ppe.result.descRawUnavailable')
            : effectiveStreamViewMode === 'recorded-raw'
              ? tSafety(RECORDED_RAW_UNAVAILABLE_AI_KEY)
              : t('ppe.result.descSnapshotOffline')
          : ppeResultState === 'CONFIRMED_MISSING'
            ? t('ppe.result.descMissing')
            : ppeResultState === 'COMPLIANT'
              ? hasExpandedReported
                ? t('ppe.result.descCompliantExpanded')
                : t('ppe.result.descCompliantCoreOnly')
              : detectionsCount === 0
                ? isReplay
                  ? t('ppe.result.descZeroDetectionsReplay')
                  : t('ppe.result.descZeroDetectionsLive')
                : isReplay
                  ? t('ppe.result.descStreamingReplay')
                  : t('ppe.result.descStreamingLive')}
      </p>
    </div>
  );
}
