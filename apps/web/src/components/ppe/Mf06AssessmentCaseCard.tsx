import React from 'react';
import { type Mf06AssessmentResponse } from '@smartsite/api-client';
import { IconCheck, IconX, IconAlertTriangle } from '../icons';
import { useLocale, type Locale, type TranslationKey } from '../../i18n/ppe-locale';

export interface Mf06AssessmentCaseCardProps {
  assessment: Mf06AssessmentResponse;
  referencesKey: string;
  onViewAssessment: () => void;
}

const OUTCOME_CONFIG: Record<
  Mf06AssessmentResponse['outcome'],
  { labelKey: TranslationKey; badgeClass: string; icon: typeof IconCheck }
> = {
  ALLOWED: {
    labelKey: 'mf06.detail.outcome.ALLOWED',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200 ',
    icon: IconCheck,
  },
  DENIED: {
    labelKey: 'mf06.detail.outcome.DENIED',
    badgeClass: 'bg-rose-50 text-rose-700 border-rose-200 ',
    icon: IconX,
  },
  UNAVAILABLE: {
    labelKey: 'mf06.detail.outcome.UNAVAILABLE',
    badgeClass: 'bg-amber-50 text-amber-700 border-amber-200 ',
    icon: IconAlertTriangle,
  },
};

const REASON_CODE_KEYS: Record<Mf06AssessmentResponse['reasonCode'], TranslationKey> = {
  AUTHORIZED: 'mf06.detail.reason.AUTHORIZED',
  POLICY_NONE: 'mf06.detail.reason.POLICY_NONE',
  UNAUTHORIZED: 'mf06.detail.reason.UNAUTHORIZED',
  POLICY_PROHIBITED: 'mf06.detail.reason.POLICY_PROHIBITED',
  INVALID_BINDING: 'mf06.detail.reason.INVALID_BINDING',
  IDENTITY_UNAVAILABLE: 'mf06.detail.reason.IDENTITY_UNAVAILABLE',
  MEDIA_UNAVAILABLE: 'mf06.detail.reason.MEDIA_UNAVAILABLE',
  PROFILE_REVOKED: 'mf06.detail.reason.PROFILE_REVOKED',
  AUTHORITY_UNAVAILABLE: 'mf06.detail.reason.AUTHORITY_UNAVAILABLE',
  SERVICE_DISABLED: 'mf06.detail.reason.SERVICE_DISABLED',
  ABORTED: 'mf06.detail.reason.ABORTED',
};

const PURPOSE_KEYS: Record<Mf06AssessmentResponse['purpose'], TranslationKey> = {
  INITIAL_OBSERVATION_ASSESSMENT: 'mf06.detail.purpose.INITIAL_OBSERVATION_ASSESSMENT',
  RETROSPECTIVE_REVIEW: 'mf06.detail.purpose.RETROSPECTIVE_REVIEW',
};

function formatTimestamp(isoString: string, locale: Locale): string {
  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return isoString;
    return date.toLocaleString(locale === 'vi' ? 'vi-VN' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      timeZone: 'UTC',
      timeZoneName: 'short',
    });
  } catch {
    return isoString;
  }
}

export function Mf06AssessmentCaseCard({
  assessment,
  referencesKey,
  onViewAssessment,
}: Mf06AssessmentCaseCardProps) {
  const { locale, t } = useLocale();
  const outcomeMeta = OUTCOME_CONFIG[assessment.outcome] ?? OUTCOME_CONFIG.UNAVAILABLE;
  const OutcomeIcon = outcomeMeta.icon;
  const reasonKey = REASON_CODE_KEYS[assessment.reasonCode];
  const reasonLabel = reasonKey ? t(reasonKey) : assessment.reasonCode;
  const purposeKey = PURPOSE_KEYS[assessment.purpose];
  const purposeLabel = purposeKey ? t(purposeKey) : assessment.purpose;
  const assessedTime = formatTimestamp(assessment.assessedAt, locale);

  const contextRows: Array<{ label: TranslationKey; value: string }> = [
    { label: 'mf06.case.evidenceLabel', value: t('mf06.case.evidenceOpenRecord') },
    { label: 'mf06.case.identityTeamLabel', value: t('mf06.case.identityNotProjected') },
  ];

  const detailRows: Array<{ label: TranslationKey; value: React.ReactNode }> = [
    { label: 'mf06.history.fieldCamera', value: assessment.cameraId },
    { label: 'mf06.history.fieldZone', value: assessment.zoneId },
    { label: 'mf06.case.fieldPurpose', value: purposeLabel },
    { label: 'mf06.case.fieldEvaluator', value: `v${assessment.evaluatorVersion}` },
    {
      label: 'mf06.detail.field.assessed',
      value: <time dateTime={assessment.assessedAt}>{assessedTime}</time>,
    },
    { label: 'mf06.detail.field.assessmentId', value: assessment.assessmentId },
    { label: 'mf06.detail.field.requestId', value: assessment.requestId },
    { label: 'mf06.detail.field.eventId', value: assessment.eventId },
    { label: 'mf06.detail.field.provenance', value: assessment.provenance },
  ];

  return (
    <li className="rounded-xl border border-zinc-200/90 bg-zinc-50/40 p-4 space-y-2.5 transition hover:border-zinc-300 ">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-zinc-200/70 ">
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="text-xs font-semibold tracking-wide text-zinc-500 ">
            {t('mf06.case.moduleLabel')}
          </span>
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${outcomeMeta.badgeClass}`}
          >
            <OutcomeIcon className="w-3.5 h-3.5 shrink-0" />
            {t(outcomeMeta.labelKey)}
          </span>
          <time
            dateTime={assessment.capturedAt}
            className="text-xs font-mono tabular-nums text-zinc-500 "
          >
            {formatTimestamp(assessment.capturedAt, locale)}
          </time>
        </div>
        <button
          type="button"
          onClick={onViewAssessment}
          className="px-3 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-100 hover:bg-emerald-200 border border-emerald-200/80 rounded-lg transition cursor-pointer shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 "
        >
          {t('mf06.history.viewAssessment')}
        </button>
      </div>

      <p className="text-xs text-zinc-700 ">
        <span className="font-medium text-zinc-500 ">{t('mf06.case.reasonLabel')}</span>{' '}
        <span className="font-medium">{reasonLabel}</span>
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-[11px] text-zinc-600 ">
        {contextRows.map((row) => (
          <div key={row.label}>
            <span className="font-sans font-medium text-zinc-400 ">{t(row.label)}</span>{' '}
            <span>{row.value}</span>
          </div>
        ))}
      </div>

      <details
        key={referencesKey}
        className="rounded-lg border border-zinc-200/70 bg-white/70 px-3 py-2 text-[11px] text-zinc-600 "
      >
        <summary className="cursor-pointer select-none font-sans text-xs font-medium text-zinc-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 ">
          {t('mf06.history.technicalReferences')}
        </summary>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 border-t border-zinc-200/60 pt-2 font-mono tabular-nums">
          {detailRows.map((row) => (
            <div key={row.label} className="break-all">
              <span className="font-sans font-medium text-zinc-400 ">{t(row.label)}</span>{' '}
              <span>{row.value}</span>
            </div>
          ))}
        </div>
      </details>
    </li>
  );
}
