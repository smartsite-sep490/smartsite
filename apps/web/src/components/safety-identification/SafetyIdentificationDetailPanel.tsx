import { useMemo, useState, type JSX, type ReactNode } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';
import { IconArrowRight, IconShield } from '../icons';
import { Alert, AlertDescription, Card } from '../ui';
import { IdentificationResponseForm, type NamedCandidate } from './SafetyIdentificationForms';
import { SafetyIdentificationAdminCard } from './SafetyIdentificationAdminCard';
import { SafetyIdentificationDetailOverview } from './SafetyIdentificationDetailOverview';
import { SafetyIdentificationHistorySection } from './SafetyIdentificationHistorySection';
import { SafetyIdentificationReviewCard } from './SafetyIdentificationReviewCard';
import {
  buildIdentificationOriginLinks,
  sameId,
  type DetailActionSlot,
  type DetailPendingAction,
  type SafetyIdentificationDetailPanelProps,
  type WorkerCandidateOption,
} from './safetyIdentificationDetailShared';

export type {
  DetailActionSlot,
  DetailPendingAction,
  SafetyIdentificationDetailPanelProps,
  WorkerCandidateOption,
};

const UUID_VALUE_RE = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

export function SafetyIdentificationDetailPanel({
  request,
  approvedEvidence,
  retrospectiveHistory,
  originRecipientId,
  originFrameKey,
  originCameraId,
  detailLoading,
  detailError,
  onRefreshDetail,
  currentUserId,
  isOfficer,
  isManager,
  formKeyPrefix,
  formCopy,
  copy,
  allWorkers,
  contractors,
  candidatesLoading,
  candidatesError,
  eligibleAssignee,
  assigneeLoading,
  pendingAction,
  actionError,
  conflictLocked,
  onRefreshAfterConflict,
  onRespond,
  onReview,
  onReassign,
  onCancelRequest,
  onCreateFollowUp,
  historyPage,
  historyLoading,
  historyError,
  historyOffset,
  historyPageSize,
  onHistoryOffsetChange,
  onRetryHistory,
}: SafetyIdentificationDetailPanelProps & {
  originCameraId?: string;
  retrospectiveHistory?: ReactNode;
}): JSX.Element {
  const [responseContractorId, setResponseContractorId] = useState<string | null>(null);
  const inRouter = useInRouterContext();

  const isAnyPending = pendingAction !== null;

  const scopedWorkers = useMemo<readonly NamedCandidate[]>(() => {
    if (!responseContractorId) {
      return allWorkers;
    }
    return allWorkers.filter(
      (worker) => worker.contractorId !== null && sameId(worker.contractorId, responseContractorId),
    );
  }, [allWorkers, responseContractorId]);

  const workerLabelsById = useMemo(() => {
    const map = new Map<string, string>();
    for (const worker of allWorkers) {
      map.set(worker.id.toLowerCase(), worker.displayName);
    }
    return map;
  }, [allWorkers]);

  const contractorLabelsById = useMemo(() => {
    const map = new Map<string, string>();
    for (const contractor of contractors) {
      map.set(contractor.id.toLowerCase(), contractor.displayName);
    }
    return map;
  }, [contractors]);

  const isAssignedToCurrentUser = sameId(request.assignedTo, currentUserId);
  const isRequestedByCurrentUser = sameId(request.requestedBy, currentUserId);
  const canManagerRespond =
    isManager && request.status === 'OPEN' && isAssignedToCurrentUser && !isRequestedByCurrentUser;

  const canOfficerReview = isOfficer && request.status === 'RESPONDED';
  const canOfficerAdminister =
    isOfficer && (request.status === 'OPEN' || request.status === 'RESPONDED');

  const isEligibleReassignTarget =
    eligibleAssignee !== null &&
    !sameId(eligibleAssignee.id, request.assignedTo) &&
    !sameId(eligibleAssignee.id, request.requestedBy) &&
    !sameId(eligibleAssignee.id, currentUserId);

  function resolveWorkerLabel(workerId: string | null): string {
    if (!workerId) return copy.detail.proposalNotSpecified;
    const known = workerLabelsById.get(workerId.toLowerCase());
    if (known) return known;
    return UUID_VALUE_RE.test(workerId.trim()) ? copy.detail.proposalRecordedInTechnical : workerId;
  }

  function resolveContractorLabel(contractorId: string | null): string {
    if (!contractorId) return copy.detail.proposalNotSpecified;
    const known = contractorLabelsById.get(contractorId.toLowerCase());
    if (known) return known;
    return UUID_VALUE_RE.test(contractorId.trim())
      ? copy.detail.proposalRecordedInTechnical
      : contractorId;
  }

  function resolveUserText(userId: string): string {
    if (eligibleAssignee && sameId(eligibleAssignee.id, userId)) {
      return `${eligibleAssignee.displayName} (${userId})`;
    }
    return userId;
  }

  const respondError =
    actionError?.slot === 'respond'
      ? conflictLocked
        ? `${actionError.message} — ${copy.detail.conflictBannerBody}`
        : actionError.message
      : null;

  const reviewError = actionError?.slot === 'review' ? actionError.message : null;
  const reassignError = actionError?.slot === 'reassign' ? actionError.message : null;
  const cancelError = actionError?.slot === 'cancel' ? actionError.message : null;

  const originLinks = buildIdentificationOriginLinks({
    siteId: request.siteId,
    originRecipientId,
    originFrameKey,
    originCameraId,
  });

  const hasApprovedEvidence = Array.isArray(approvedEvidence)
    ? approvedEvidence.length > 0
    : Boolean(approvedEvidence);

  return (
    <div className="space-y-4" aria-label={copy.detail.title}>
      {isOfficer && originLinks.hasValidOrigin && originLinks.inboxReturnHref && (
        <div
          data-testid="c02-origin-return-bar"
          className="flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-[#071A2B]/15 bg-[#071A2B]/[0.03] px-4 py-2.5 shadow-2xs"
        >
          <p className="text-xs font-medium text-slate-700">
            {copy.detail.originCaseContextNotice}
          </p>
          {inRouter ? (
            <Link
              to={originLinks.inboxReturnHref}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-900 transition-colors hover:border-slate-300 hover:bg-slate-50"
            >
              <span>{copy.detail.returnToInboxLink}</span>
              <IconArrowRight className="w-3.5 h-3.5" />
            </Link>
          ) : (
            <a
              href={originLinks.inboxReturnHref}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-900 transition-colors hover:border-slate-300 hover:bg-slate-50"
            >
              <span>{copy.detail.returnToInboxLink}</span>
              <IconArrowRight className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      )}

      <SafetyIdentificationDetailOverview
        request={request}
        detailLoading={detailLoading}
        detailError={detailError}
        onRefreshDetail={onRefreshDetail}
        conflictLocked={conflictLocked}
        isAnyPending={isAnyPending}
        onRefreshAfterConflict={onRefreshAfterConflict}
        copy={copy}
        resolveUserText={resolveUserText}
        resolveWorkerLabel={resolveWorkerLabel}
        resolveContractorLabel={resolveContractorLabel}
      />

      {hasApprovedEvidence && (
        <Card data-testid="c02-approved-evidence-card" className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-2.5">
            <div className="space-y-0.5">
              <h3 className="flex items-center gap-1.5 text-sm font-bold text-[#071A2B]">
                <IconShield className="h-4 w-4 text-emerald-600" />
                <span>{copy.detail.approvedEvidenceCardTitle}</span>
              </h3>
              <p className="text-xs text-slate-600">{copy.detail.approvedEvidenceCardHint}</p>
            </div>
          </div>
          <div className="space-y-2.5">{approvedEvidence}</div>
        </Card>
      )}

      {retrospectiveHistory}

      {canManagerRespond && (
        <IdentificationResponseForm
          key={`${formKeyPrefix}:${request.id}`}
          pending={pendingAction === 'respond'}
          disabled={conflictLocked || (isAnyPending && pendingAction !== 'respond')}
          error={respondError}
          workers={scopedWorkers}
          contractors={contractors}
          candidatesLoading={candidatesLoading}
          candidatesError={candidatesError}
          onContractorChange={setResponseContractorId}
          onRefresh={conflictLocked ? onRefreshAfterConflict : undefined}
          onSubmit={onRespond}
          copy={formCopy}
        />
      )}

      {isManager && !isOfficer && request.status === 'OPEN' && isRequestedByCurrentUser && (
        <Alert variant="info">
          <AlertDescription>{copy.detail.managerSelfRequestNotice}</AlertDescription>
        </Alert>
      )}

      {isManager && !isOfficer && request.status !== 'OPEN' && (
        <Alert variant="default">
          <AlertDescription>{copy.detail.managerReadOnlyStatusNotice}</AlertDescription>
        </Alert>
      )}

      <SafetyIdentificationReviewCard
        visible={canOfficerReview}
        copy={copy}
        pendingAction={pendingAction}
        isAnyPending={isAnyPending}
        conflictLocked={conflictLocked}
        reviewError={reviewError}
        onRefreshAfterConflict={onRefreshAfterConflict}
        onReview={onReview}
      />

      <SafetyIdentificationAdminCard
        visible={canOfficerAdminister}
        assignedTo={request.assignedTo}
        eligibleAssignee={eligibleAssignee}
        assigneeLoading={assigneeLoading}
        isEligibleReassignTarget={isEligibleReassignTarget}
        copy={copy}
        pendingAction={pendingAction}
        isAnyPending={isAnyPending}
        conflictLocked={conflictLocked}
        reassignError={reassignError}
        cancelError={cancelError}
        onRefreshAfterConflict={onRefreshAfterConflict}
        onReassign={onReassign}
        onCancelRequest={onCancelRequest}
      />

      <SafetyIdentificationHistorySection
        originRecipientId={originRecipientId}
        originFrameKey={originFrameKey}
        originCameraId={originCameraId}
        isOfficer={isOfficer}
        status={request.status}
        siteId={request.siteId}
        episodeId={request.episodeId}
        copy={copy}
        onCreateFollowUp={onCreateFollowUp}
        historyPage={historyPage}
        historyLoading={historyLoading}
        historyError={historyError}
        historyOffset={historyOffset}
        historyPageSize={historyPageSize}
        onHistoryOffsetChange={onHistoryOffsetChange}
        onRetryHistory={onRetryHistory}
        resolveWorkerLabel={resolveWorkerLabel}
        resolveContractorLabel={resolveContractorLabel}
      />
    </div>
  );
}
