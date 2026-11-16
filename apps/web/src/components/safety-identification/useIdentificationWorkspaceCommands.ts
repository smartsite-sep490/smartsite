import { useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@smartsite/api-client';
import type { IdentificationResponseSubmission } from './SafetyIdentificationForms';
import {
  formatIdentificationError,
  type IdentificationWorkspaceCopy,
} from './IdentificationWorkspaceCopy';
import type { DetailActionSlot, DetailPendingAction } from './SafetyIdentificationDetailPanel';
import {
  isAbortOrCancel,
  isHardDenial,
  sameId,
  type IdentificationSiteScope,
  type ManagementClient,
} from './IdentificationWorkspaceScope';
import {
  useIdentificationCommandReceipts,
  useIdentificationCreateCommand,
  type IdentificationCreateCommandResult,
} from './useIdentificationCreateCommand';
import type { IdentificationRequestRevocationResult } from './useIdentificationRequestRevocation';
import type { IdentificationWorkspaceQueriesResult } from './useIdentificationWorkspaceQueries';

interface ScopedDetailInFlight {
  opId: string;
  epoch: number;
  siteId: string;
  requestId: string;
  action: Exclude<DetailPendingAction, null>;
}

interface ScopedDetailFeedback {
  epoch: number;
  siteId: string;
  requestId: string;
  slot: DetailActionSlot;
  message: string;
  conflictLocked: boolean;
}

export interface IdentificationWorkspaceCommandsParams {
  scopeNonce: string;
  client: ManagementClient;
  accessToken: string;
  queryClient: QueryClient;
  copy: IdentificationWorkspaceCopy;
  scope: IdentificationSiteScope;
  queries: IdentificationWorkspaceQueriesResult;
  revocation: IdentificationRequestRevocationResult;
}

export interface IdentificationWorkspaceCommandsResult extends IdentificationCreateCommandResult {
  pendingAction: DetailPendingAction;
  activeConflictLocked: boolean;
  activeScopedError: { slot: DetailActionSlot; message: string } | null;
  clearDetailFeedback: () => void;
  clearDetailFeedbackForRequest: (epoch: number, requestId: string) => void;
  handleManagerRespond: (submission: IdentificationResponseSubmission) => void;
  handleOfficerReview: (decision: 'ACCEPT' | 'RETURN', reason: string) => void;
  handleOfficerReassign: (assignedTo: string, reason: string) => void;
  handleOfficerCancel: (reason: string) => void;
  handleRefreshAfterConflict: () => Promise<void>;
}

export function useIdentificationWorkspaceCommands({
  scopeNonce,
  client,
  accessToken,
  queryClient,
  copy,
  scope,
  queries,
  revocation,
}: IdentificationWorkspaceCommandsParams): IdentificationWorkspaceCommandsResult {
  const receipts = useIdentificationCommandReceipts(scopeNonce, scope);
  const createCommands = useIdentificationCreateCommand({
    client,
    accessToken,
    queryClient,
    copy,
    scope,
    queries,
    revocation,
    receipts,
  });

  const [trackedEpoch, setTrackedEpoch] = useState(scope.siteEpoch);
  const [detailInFlight, setDetailInFlight] = useState<ScopedDetailInFlight | null>(null);
  const [detailFeedback, setDetailFeedback] = useState<ScopedDetailFeedback | null>(null);

  if (trackedEpoch !== scope.siteEpoch) {
    setTrackedEpoch(scope.siteEpoch);
    setDetailInFlight(null);
    setDetailFeedback(null);
  }

  const pendingAction: DetailPendingAction =
    detailInFlight &&
    detailInFlight.epoch === scope.siteEpoch &&
    sameId(detailInFlight.siteId, scope.selectedSiteId) &&
    queries.activeRequest !== null &&
    sameId(detailInFlight.requestId, queries.activeRequest.id)
      ? detailInFlight.action
      : null;

  const activeDetailFeedback =
    detailFeedback &&
    detailFeedback.epoch === scope.siteEpoch &&
    sameId(detailFeedback.siteId, scope.selectedSiteId) &&
    queries.activeRequest !== null &&
    sameId(detailFeedback.requestId, queries.activeRequest.id)
      ? detailFeedback
      : null;

  const activeConflictLocked = Boolean(activeDetailFeedback?.conflictLocked);
  const activeScopedError = activeDetailFeedback
    ? { slot: activeDetailFeedback.slot, message: activeDetailFeedback.message }
    : null;

  function clearDetailFeedback() {
    setDetailFeedback(null);
  }

  function clearDetailFeedbackForRequest(epoch: number, requestId: string) {
    setDetailFeedback((prev) =>
      prev && prev.epoch === epoch && sameId(prev.requestId, requestId) ? null : prev,
    );
  }

  async function executeRequestMutation(
    slot: DetailActionSlot,
    pendingTag: Exclude<DetailPendingAction, null>,
    command: Parameters<typeof client.changeSafetyIdentificationRequest>[3],
    normalizedFingerprintPayload: unknown,
  ) {
    if (
      !queries.activeRequest ||
      revocation.activeRevocation !== null ||
      pendingAction !== null ||
      activeConflictLocked ||
      queries.siteQueueDenied
    ) {
      return;
    }

    const capturedEpoch = scope.siteEpoch;
    const capturedGen = scope.mutationGenerationRef.current;
    const targetSite = scope.selectedSiteId;
    const targetRequestId =
      scope.selectedRequestId && sameId(scope.selectedRequestId, queries.activeRequest.id)
        ? scope.selectedRequestId
        : queries.activeRequest.id;
    const expectedVersion = queries.activeRequest.version;
    const opId = crypto.randomUUID();
    const commandId = receipts.resolveCommandId(
      slot,
      targetRequestId,
      expectedVersion,
      normalizedFingerprintPayload,
    );

    const stampedCommand: Parameters<typeof client.changeSafetyIdentificationRequest>[3] =
      command.action === 'respond'
        ? { action: 'respond', input: { ...command.input, commandId, expectedVersion } }
        : command.action === 'review'
          ? { action: 'review', input: { ...command.input, commandId, expectedVersion } }
          : command.action === 'reassign'
            ? { action: 'reassign', input: { ...command.input, commandId, expectedVersion } }
            : { action: 'cancel', input: { ...command.input, commandId, expectedVersion } };

    const controller = new AbortController();
    scope.mutationControllersRef.current.add(controller);
    setDetailInFlight({
      opId,
      epoch: capturedEpoch,
      siteId: targetSite,
      requestId: targetRequestId,
      action: pendingTag,
    });
    setDetailFeedback(null);

    try {
      const mutation = await client.changeSafetyIdentificationRequest(
        accessToken,
        targetSite,
        targetRequestId,
        stampedCommand,
        { signal: controller.signal },
      );

      if (!scope.isCurrentSiteMutation(controller, capturedGen, capturedEpoch, targetSite)) {
        return;
      }

      const activeSelectedId = scope.activeScopeRef.current.selectedRequestId;
      const detailKeyId =
        activeSelectedId && sameId(activeSelectedId, targetRequestId)
          ? activeSelectedId
          : targetRequestId;
      const detailQueryKey = [
        ...scope.queryPrefix,
        'site',
        targetSite,
        'detail',
        detailKeyId,
      ] as const;

      receipts.clearCommandReceipt(capturedEpoch, targetSite, slot, targetRequestId);
      clearDetailFeedbackForRequest(capturedEpoch, targetRequestId);

      let detailHardDenied = false;
      if (mutation.replayed) {
        if (activeSelectedId && sameId(activeSelectedId, targetRequestId)) {
          revocation.clearRecentlyReloadedKey();
          await queryClient.invalidateQueries({
            queryKey: detailQueryKey,
            exact: true,
          });
          if (!scope.isCurrentSiteMutation(controller, capturedGen, capturedEpoch, targetSite)) {
            return;
          }
          const detailState = queryClient.getQueryState(detailQueryKey);
          if (detailState?.status === 'error' && isHardDenial(detailState.error)) {
            detailHardDenied = true;
            for (const actionSlot of ['respond', 'review', 'reassign', 'cancel'] as const) {
              receipts.clearCommandReceipt(capturedEpoch, targetSite, actionSlot, targetRequestId);
            }
            clearDetailFeedbackForRequest(capturedEpoch, targetRequestId);
            revocation.revokeRequestOnHardDenial(
              capturedEpoch,
              targetSite,
              targetRequestId,
              formatIdentificationError(detailState.error, copy),
            );
          }
        } else {
          queryClient.removeQueries({
            queryKey: detailQueryKey,
            exact: true,
          });
        }
      } else {
        queryClient.setQueryData(detailQueryKey, mutation.request);
      }

      await queryClient.invalidateQueries({
        queryKey: [...scope.queryPrefix, 'site', targetSite, 'queue'],
      });
      if (
        detailHardDenied ||
        !scope.isCurrentSiteMutation(controller, capturedGen, capturedEpoch, targetSite)
      ) {
        return;
      }
      if (scope.isOfficer) {
        await queryClient.invalidateQueries({
          queryKey: [...scope.queryPrefix, 'site', targetSite, 'history', detailKeyId],
        });
      }
    } catch (error) {
      if (!scope.aliveRef.current || isAbortOrCancel(error)) return;
      scope.guardUnauthorized(error);
      if (!scope.isCurrentSiteMutation(controller, capturedGen, capturedEpoch, targetSite)) {
        return;
      }
      const formatted = formatIdentificationError(error, copy);
      if (isHardDenial(error)) {
        for (const actionSlot of ['respond', 'review', 'reassign', 'cancel'] as const) {
          receipts.clearCommandReceipt(capturedEpoch, targetSite, actionSlot, targetRequestId);
        }
        clearDetailFeedbackForRequest(capturedEpoch, targetRequestId);
        revocation.revokeRequestOnHardDenial(capturedEpoch, targetSite, targetRequestId, formatted);
        return;
      }
      if (!sameId(scope.activeScopeRef.current.selectedRequestId, targetRequestId)) {
        return;
      }
      const isConflict = error instanceof ApiError && error.status === 409;
      setDetailFeedback({
        epoch: capturedEpoch,
        siteId: targetSite,
        requestId: targetRequestId,
        slot,
        message: formatted,
        conflictLocked: isConflict,
      });
    } finally {
      scope.mutationControllersRef.current.delete(controller);
      if (scope.aliveRef.current) {
        setDetailInFlight((prev) => (prev?.opId === opId ? null : prev));
      }
    }
  }

  function handleManagerRespond(submission: IdentificationResponseSubmission) {
    if (!queries.activeRequest) return;
    void executeRequestMutation(
      'respond',
      'respond',
      {
        action: 'respond',
        input: {
          commandId: '',
          expectedVersion: queries.activeRequest.version,
          outcome: submission.outcome,
          workerId: submission.workerId,
          contractorId: submission.contractorId,
          reason: submission.reason,
          evidenceRefs: [],
        },
      },
      {
        outcome: submission.outcome,
        workerId: submission.workerId?.toLowerCase() ?? null,
        contractorId: submission.contractorId?.toLowerCase() ?? null,
        reason: submission.reason,
      },
    );
  }

  function handleOfficerReview(decision: 'ACCEPT' | 'RETURN', reason: string) {
    if (!queries.activeRequest) return;
    void executeRequestMutation(
      'review',
      decision === 'ACCEPT' ? 'accept' : 'return',
      {
        action: 'review',
        input: {
          commandId: '',
          expectedVersion: queries.activeRequest.version,
          decision,
          reason,
        },
      },
      { decision, reason },
    );
  }

  function handleOfficerReassign(assignedTo: string, reason: string) {
    if (!queries.activeRequest) return;
    void executeRequestMutation(
      'reassign',
      'reassign',
      {
        action: 'reassign',
        input: {
          commandId: '',
          expectedVersion: queries.activeRequest.version,
          assignedTo,
          reason,
        },
      },
      { assignedTo: assignedTo.toLowerCase(), reason },
    );
  }

  function handleOfficerCancel(reason: string) {
    if (!queries.activeRequest) return;
    void executeRequestMutation(
      'cancel',
      'cancel',
      {
        action: 'cancel',
        input: {
          commandId: '',
          expectedVersion: queries.activeRequest.version,
          reason,
        },
      },
      { reason },
    );
  }

  async function handleRefreshAfterConflict() {
    if (!queries.activeRequest || pendingAction !== null) return;
    const capturedEpoch = scope.siteEpoch;
    const capturedSite = scope.selectedSiteId;
    const targetRequestId = queries.activeRequest.id;
    const detailPromise = queries.refetchDetail();
    const backgroundTasks: Promise<unknown>[] = [queries.refetchQueue()];
    if (scope.isOfficer) {
      backgroundTasks.push(queries.refetchHistory(), queries.refetchAssignee());
    }
    const [detailResult] = await Promise.all([detailPromise, Promise.all(backgroundTasks)]);
    if (
      !scope.aliveRef.current ||
      scope.activeScopeRef.current.epoch !== capturedEpoch ||
      !sameId(scope.activeScopeRef.current.siteId, capturedSite) ||
      !sameId(scope.activeScopeRef.current.selectedRequestId, targetRequestId)
    ) {
      return;
    }
    if (!detailResult.isError) {
      setDetailFeedback(null);
    }
  }

  return {
    ...createCommands,
    pendingAction,
    activeConflictLocked,
    activeScopedError,
    clearDetailFeedback,
    clearDetailFeedbackForRequest,
    handleManagerRespond,
    handleOfficerReview,
    handleOfficerReassign,
    handleOfficerCancel,
    handleRefreshAfterConflict,
  };
}
