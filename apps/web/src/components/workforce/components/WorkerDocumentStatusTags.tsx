import type { WorkerComplianceResponse } from '@smartsite/api-client';
import { translate as tr } from '../../../i18n';

export function WorkerDocumentStatusTags({
  profile,
}: {
  profile: Pick<WorkerComplianceResponse, 'status' | 'submissionStatus' | 'needsSupplement'>;
}) {
  const isPending = profile.submissionStatus === 'PENDING_REVIEW';
  const isReviewed = profile.submissionStatus === 'REVIEWED';

  return (
    <div className="flex flex-wrap items-center gap-2 justify-end">
      {/* Submission status tag */}
      <span
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border shadow-2xs whitespace-nowrap ${
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

      {/* Needs supplement badge */}
      {profile.needsSupplement && (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200/90 shadow-2xs whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
          <span>{tr('documents.needsSupplement')}</span>
        </span>
      )}

      {/* Expired status */}
      {profile.status === 'EXPIRED' && (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-red-50 text-red-800 border border-red-300 shadow-2xs whitespace-nowrap">
          <span className="w-1.5 h-1.5 rounded-full bg-red-600 shrink-0" />
          <span>{tr(`documents.${profile.status}`)}</span>
        </span>
      )}
    </div>
  );
}
