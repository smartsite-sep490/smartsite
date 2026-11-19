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
    <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-700">
      <h4 className="font-bold">{tr('documents.aiAnalysis')}</h4>
      {analysis.status === 'UNAVAILABLE' ? (
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
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
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
