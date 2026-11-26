import { CheckCircle, CircleNotch, Info, Warning, WarningCircle } from '@phosphor-icons/react';
import type { WorkerDocumentResponse } from '@smartsite/api-client';
import type { ReactNode } from 'react';
import { translate as tr } from '../../../i18n';

type Analysis = WorkerDocumentResponse['aiAnalysis'];
type CompletedAnalysis = Extract<NonNullable<Analysis>, { status: 'COMPLETE' }>;

const states = {
  idle: {
    label: 'documents.aiNotScanned',
    Icon: Info,
    color: 'border-slate-200 bg-slate-50 text-slate-700',
  },
  analyzing: {
    label: 'documents.aiAnalyzing',
    Icon: CircleNotch,
    color: 'border-blue-200 bg-blue-50 text-blue-900',
  },
  unavailable: {
    label: 'documents.aiUnavailable',
    Icon: Info,
    color: 'border-slate-200 bg-slate-50 text-slate-700',
  },
  matched: {
    label: 'documents.aiStatus.NO_DISCREPANCY',
    Icon: CheckCircle,
    color: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  },
  uncertain: {
    label: 'documents.aiNeedsReview',
    Icon: Warning,
    color: 'border-amber-200 bg-amber-50 text-amber-950',
  },
  mismatch: {
    label: 'documents.aiDiscrepancy',
    Icon: WarningCircle,
    color: 'border-rose-200 bg-rose-50 text-rose-950',
  },
};

function dateCheckLabel(kind: WorkerDocumentResponse['kind'], field: 'ISSUED_ON' | 'EXPIRES_ON') {
  if (field === 'EXPIRES_ON') return tr('documents.expiresOn');
  if (kind === 'HEALTH_CERTIFICATE') return tr('documents.examinationOn');
  if (kind === 'PERSONAL_INSURANCE') return tr('documents.coverageStartsOn');
  return tr('documents.cardIssuedOn');
}

function compareStatus(analysis: CompletedAnalysis, checks: CompletedAnalysis['dateCheck'][]) {
  if (
    analysis.kindMismatch ||
    checks.some((check) => check.status === 'MISMATCH') ||
    analysis.validity === 'EXPIRED' ||
    analysis.validity === 'NOT_YET_VALID'
  ) {
    return states.mismatch;
  }
  return analysis.detectedKind &&
    analysis.validity === 'CURRENT' &&
    checks.every((check) => check.status === 'MATCH')
    ? states.matched
    : states.uncertain;
}

export function WorkerDocumentAnalysisNotice({
  analysis,
  kind,
  children,
}: {
  analysis?: Analysis;
  kind: WorkerDocumentResponse['kind'];
  children?: ReactNode;
}) {
  const complete = analysis?.status === 'COMPLETE' ? analysis : undefined;
  const checks = complete
    ? [...(complete.startDateCheck ? [complete.startDateCheck] : []), complete.dateCheck]
    : [];
  const { label, Icon, color } = complete
    ? compareStatus(complete, checks)
    : analysis?.status === 'ANALYZING'
      ? states.analyzing
      : analysis?.status === 'UNAVAILABLE'
        ? states.unavailable
        : states.idle;
  const dateValues = (check: CompletedAnalysis['dateCheck']) =>
    tr('documents.aiComparisonValues', {
      declared: check.submittedDate ?? tr('documents.notDetermined'),
      detected: check.detectedDate ?? tr('documents.notDetermined'),
    });

  return (
    <div className={'min-w-0 rounded-lg border px-3 py-2 text-sm ' + color}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex min-w-0 items-start gap-2 font-semibold" role="status">
          <Icon aria-hidden className="mt-0.5 size-4 shrink-0" weight="bold" />
          {tr(label)}
        </p>
        {children}
      </div>
      {complete && (
        <>
          {complete.kindMismatch && <p className="mt-1">{tr('documents.aiKindMismatch')}</p>}
          {checks
            .filter((check) => check.status === 'MISMATCH')
            .map((check) => (
              <p key={check.field} className="mt-1 [overflow-wrap:anywhere]">
                <strong>{dateCheckLabel(kind, check.field)}</strong>
                <span className="ml-2">{dateValues(check)}</span>
              </p>
            ))}
          {(complete.validity === 'EXPIRED' || complete.validity === 'NOT_YET_VALID') && (
            <p className="mt-1">
              {tr(
                complete.validity === 'EXPIRED' ? 'documents.aiExpired' : 'documents.aiNotYetValid',
              )}
            </p>
          )}
          <p className="mt-1 text-xs">{tr('documents.aiAdvisory')}</p>
          <details className="mt-2 text-xs">
            <summary className="cursor-pointer font-semibold">
              {tr('documents.aiComparisonDetails')}
            </summary>
            <dl className="mt-2 grid gap-1 [overflow-wrap:anywhere]">
              <div>
                <dt className="inline font-medium">{tr('documents.aiSelectedKind')}</dt>{' '}
                <dd className="inline">{tr('documents.' + kind)}</dd>
              </div>
              <div>
                <dt className="inline font-medium">{tr('documents.aiDetectedKind')}</dt>{' '}
                <dd className="inline">
                  {tr(
                    complete.detectedKind === 'OTHER'
                      ? 'documents.aiOtherKind'
                      : complete.detectedKind
                        ? 'documents.' + complete.detectedKind
                        : 'documents.notDetermined',
                  )}
                </dd>
              </div>
              {checks.map((check) => (
                <div key={check.field}>
                  <dt className="font-medium">{dateCheckLabel(kind, check.field)}</dt>
                  <dd>{dateValues(check)}</dd>
                </div>
              ))}
            </dl>
          </details>
        </>
      )}
    </div>
  );
}
