import { useMemo, useState, type JSX } from 'react';
import { Alert, AlertDescription } from '../ui';
import { IdentificationResponseForm, type NamedCandidate } from './SafetyIdentificationForms';
import { SafetyIdentificationAdminCard } from './SafetyIdentificationAdminCard';
import { SafetyIdentificationDetailOverview } from './SafetyIdentificationDetailOverview';
import { SafetyIdentificationHistorySection } from './SafetyIdentificationHistorySection';
import { SafetyIdentificationReviewCard } from './SafetyIdentificationReviewCard';
import {
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
}: SafetyIdentificationDetailPanelProps & { originCameraId?: string }): JSX.Element {
  const [responseContractorId, setResponseContractorId] = useState<string | null>(null);

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

  return (
    <div className="space-y-4" aria-label={copy.detail.title}>
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

      {approvedEvidence}

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
