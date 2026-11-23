import type { WorkerComplianceResponse } from '@smartsite/api-client';
import { translate as tr } from '../../../i18n';

export function WorkerDocumentStatusTags({
  profile,
  workerCode,
}: {
  profile: Pick<WorkerComplianceResponse, 'status' | 'submissionStatus' | 'needsSupplement'>;
  workerCode?: string;
}) {
  const isPending = profile.submissionStatus === 'PENDING_REVIEW';
  const isReviewed = profile.submissionStatus === 'REVIEWED';

  return (
    <div
      className={`min-w-0 flex flex-wrap items-center gap-2 ${workerCode ? 'justify-start' : 'justify-end'}`}
    >
      <span className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap">
        {workerCode && (
          <span className="rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono text-xs font-medium text-slate-600">
            {workerCode}
          </span>
        )}
        {/* Submission status tag */}
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border shadow-2xs max-w-full whitespace-normal ${
            isPending
              ? 'bg-amber-50 text-amber-800 border-amber-200/90'
              : isReviewed
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200/90'
                : 'bg-slate-100 text-slate-600 border-slate-200'
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
              isPending ? 'bg-amber-500' : isReviewed ? 'bg-emerald-500' : 'bg-slate-400'
            }`}
          />
          <span>{tr(`documents.${profile.submissionStatus ?? 'NOT_SUBMITTED'}`)}</span>
        </span>
      </span>

      {/* Needs supplement badge */}
      {profile.needsSupplement && (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200/90 shadow-2xs max-w-full whitespace-normal">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
          <span>{tr('documents.needsSupplement')}</span>
        </span>
      )}

      {/* Expired status */}
      {profile.status === 'EXPIRED' && (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-red-50 text-red-800 border border-red-300 shadow-2xs max-w-full whitespace-normal">
          <span className="w-1.5 h-1.5 rounded-full bg-red-600 shrink-0" />
          <span>{tr(`documents.${profile.status}`)}</span>
        </span>
      )}
    </div>
  );
}
