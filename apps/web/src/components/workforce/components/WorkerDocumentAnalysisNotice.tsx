import type { WorkerDocumentResponse } from '@smartsite/api-client';
import { translate as tr } from '../../../i18n';

export function WorkerDocumentAnalysisNotice({
  analysis,
  reference,
  kind,
}: {
  analysis: NonNullable<WorkerDocumentResponse['aiAnalysis']>;
  reference: string | null;
  kind: WorkerDocumentResponse['kind'];
}) {
  const unknown = tr('documents.notDetermined');

  return (
    <div className="min-w-0 space-y-2 rounded-xl border border-slate-200 bg-white p-3 text-xs leading-6 text-slate-700 [overflow-wrap:anywhere]">
      <h4 className="font-bold">{tr('documents.aiAnalysis')}</h4>
      {analysis.status === 'ANALYZING' ? (
        <p>{tr('documents.aiAnalyzing')}</p>
      ) : analysis.status === 'UNAVAILABLE' ? (
        <p>{tr('documents.aiUnavailable')}</p>
      ) : (
        <>
          <p className={analysis.kindMismatch ? 'font-bold text-amber-900' : 'font-semibold'}>
            {tr(
              analysis.kindMismatch
                ? 'documents.aiKindMismatch'
                : analysis.detectedKind
                  ? 'documents.aiKindMatch'
                  : 'documents.aiInsufficient',
            )}
          </p>
          <dl className="grid min-w-0 grid-cols-1 gap-x-3 gap-y-1 @min-[480px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] [&_dd]:min-w-0 [&_dt]:text-slate-500">
            <dt>{tr('documents.aiSelectedKind')}</dt>
            <dd>{tr('documents.' + kind)}</dd>
            <dt>{tr('documents.aiDetectedKind')}</dt>
            <dd>
              {analysis.detectedKind === 'OTHER'
                ? tr('documents.aiOtherKind')
                : analysis.detectedKind
                  ? tr('documents.' + analysis.detectedKind)
                  : unknown}
            </dd>
            <dt>{tr('documents.aiIssuedOn')}</dt>
            <dd>{analysis.issuedOn ?? unknown}</dd>
            <dt>{tr('documents.aiExpiresOn')}</dt>
            <dd>{analysis.expiresOn ?? unknown}</dd>
            <dt>{tr('documents.dateDeclared')}</dt>
            <dd>{analysis.dateCheck.submittedDate ?? unknown}</dd>
            <dt>{tr('documents.aiNationalId')}</dt>
            <dd>{analysis.nationalId ?? unknown}</dd>
            <dt>{tr('documents.aiReferenceId')}</dt>
            <dd>{reference ?? unknown}</dd>
          </dl>
          {(analysis.validity === 'EXPIRED' || analysis.validity === 'NOT_YET_VALID') && (
            <p className="font-semibold text-amber-900">
              {tr(
                analysis.validity === 'EXPIRED' ? 'documents.aiExpired' : 'documents.aiNotYetValid',
              )}
            </p>
          )}
          {analysis.dateCheck.status === 'MISMATCH' && (
            <p className="font-semibold text-amber-900">{tr('documents.aiDateMismatch')}</p>
          )}
          {analysis.identityCheck === 'MISMATCH' && (
            <p className="font-semibold text-amber-900">{tr('documents.aiIdentityMismatch')}</p>
          )}
        </>
      )}
    </div>
  );
}
