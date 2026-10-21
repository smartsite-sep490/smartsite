import React from 'react';
import type { Mf06AssessmentResponse } from '@smartsite/api-client';
import { useLocale } from '../../i18n/ppe-locale';

export interface Mf06AssessmentReferencesProps {
  assessment: Pick<Mf06AssessmentResponse, 'assessmentId' | 'cameraId' | 'zoneId' | 'provenance'>;
}

export function Mf06AssessmentReferences({ assessment }: Mf06AssessmentReferencesProps) {
  const { t } = useLocale();

  return (
    <div className="space-y-2 pt-0.5 text-[11px] text-zinc-600 ">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 font-mono tabular-nums">
        <div className="break-all">
          <span className="font-sans font-medium text-zinc-400 ">
            {t('mf06.history.fieldCamera')}
          </span>{' '}
          <span>{assessment.cameraId}</span>
        </div>
        <div className="break-all">
          <span className="font-sans font-medium text-zinc-400 ">
            {t('mf06.history.fieldZone')}
          </span>{' '}
          <span>{assessment.zoneId}</span>
        </div>
      </div>

      <details className="rounded-lg border border-zinc-200/70 bg-white/70 px-3 py-2">
        <summary className="cursor-pointer select-none font-sans text-xs font-medium text-zinc-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 ">
          {t('mf06.history.technicalReferences')}
        </summary>
        <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 border-t border-zinc-200/60 pt-2 font-mono tabular-nums">
          <div className="break-all">
            <span className="font-sans font-medium text-zinc-400 ">
              {t('mf06.detail.field.assessmentId')}
            </span>{' '}
            <span>{assessment.assessmentId}</span>
          </div>
          <div className="break-all">
            <span className="font-sans font-medium text-zinc-400 ">
              {t('mf06.detail.field.provenance')}
            </span>{' '}
            <span>{assessment.provenance}</span>
          </div>
        </div>
      </details>
    </div>
  );
}
