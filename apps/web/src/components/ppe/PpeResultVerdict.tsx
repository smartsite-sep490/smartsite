import type { PpeResultState } from '../cameras/monitoringUtils';
import type { ScopedPreviewStatus } from '../cameras/useScopedCameraPreview';
import { useLocale } from '../../i18n/ppe-locale';

export type PpeStreamViewMode = 'live-raw' | 'recorded-raw' | 'ai-analyzed';

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

  return (
    <div
      data-testid="ppe-result-verdict"
      className={`rounded-r-xl border-l-[3px] px-3 py-2 ${
        ppeResultState === 'CONFIRMED_MISSING'
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
          ppeResultState === 'CONFIRMED_MISSING'
            ? 'text-red-600'
            : ppeResultState === 'COMPLIANT'
              ? 'text-emerald-700'
              : 'text-slate-700'
        }`}
      >
        {ppeResultState === 'CONFIRMED_MISSING' ? (
          <span>{t('ppe.result.missingDetected')}</span>
        ) : ppeResultState === 'COMPLIANT' ? (
          hasExpandedReported ? (
            <span>{t('ppe.result.coreAndReportedDetected')}</span>
          ) : (
            <span>{t('ppe.result.helmetAndVestDetected')}</span>
          )
        ) : !hasPreview || activeStatus === 'UNAVAILABLE' ? (
          <span>{t('ppe.result.evidenceUnavailable')}</span>
        ) : detectionsCount === 0 ? (
          <span>{t('ppe.result.noObservations')}</span>
        ) : (
          <span>{t('ppe.result.scanningSnapshot')}</span>
        )}
      </div>
      <p className="text-xs text-slate-600 leading-relaxed">
        {!hasPreview || activeStatus === 'UNAVAILABLE'
          ? effectiveStreamViewMode === 'live-raw'
            ? t('ppe.result.descRawUnavailable')
            : t('ppe.result.descSnapshotOffline')
          : ppeResultState === 'COMPLIANT'
            ? hasExpandedReported
              ? t('ppe.result.descCompliantExpanded')
              : t('ppe.result.descCompliantCoreOnly')
            : ppeResultState === 'CONFIRMED_MISSING'
              ? t('ppe.result.descMissing')
              : detectionsCount === 0
                ? isLive
                  ? activeStatus === 'REPLAY' || activeSourceKind === 'REPLAY'
                    ? t('ppe.result.descZeroDetectionsReplay')
                    : t('ppe.result.descZeroDetectionsLive')
                  : t('ppe.result.descSnapshotOffline')
                : isLive
                  ? activeStatus === 'REPLAY' || activeSourceKind === 'REPLAY'
                    ? t('ppe.result.descStreamingReplay')
                    : t('ppe.result.descStreamingLive')
                  : t('ppe.result.descSnapshotOffline')}
      </p>
    </div>
  );
}
