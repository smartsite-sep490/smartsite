import type { EvidenceApproval } from './safetyIdentificationFormTypes';
import { useRef, useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@smartsite/api-client';
import {
  formatIdentificationError,
  type IdentificationWorkspaceCopy,
} from './IdentificationWorkspaceCopy';
import {
  isAbortOrCancel,
  isHardDenial,
  sameId,
  type IdentificationSiteScope,
  type ManagementClient,
} from './IdentificationWorkspaceScope';
import type { IdentificationRequestRevocationResult } from './useIdentificationRequestRevocation';
import type { IdentificationWorkspaceQueriesResult } from './useIdentificationWorkspaceQueries';

interface CommandReceipt {
  fingerprint: string;
  commandId: string;
}

interface ScopedCreateInFlight {
  opId: string;
  epoch: number;
  siteId: string;
  episodeId: string;
}

interface ScopedCreateFeedback {
  epoch: number;
  siteId: string;
  episodeId: string;
  message: string | null;
  conflictLocked: boolean;
}

export interface IdentificationCommandReceipts {
  resolveCommandId: (
    slot: string,
    targetId: string,
    expectedVersion: number,
    payload: unknown,
  ) => string;
  clearCommandReceipt: (epoch: number, siteId: string, slot: string, targetId: string) => void;
}

export interface IdentificationCreateCommandParams {
  client: ManagementClient;
  accessToken: string;
  queryClient: QueryClient;
  copy: IdentificationWorkspaceCopy;
  scope: IdentificationSiteScope;
  queries: IdentificationWorkspaceQueriesResult;
  revocation: IdentificationRequestRevocationResult;
  receipts: IdentificationCommandReceipts;
}

export interface IdentificationCreateCommandResult {
  createPending: boolean;
  createConflictLocked: boolean;
  createError: string | null;
  clearCreateFeedback: () => void;
  handleCreateSubmit: (trimmedReason: string, evidenceApproval?: EvidenceApproval) => Promise<void>;
  handleRefreshCreateAfterConflict: () => Promise<void>;
}

export function useIdentificationCommandReceipts(
  scopeNonce: string,
  scope: IdentificationSiteScope,
): IdentificationCommandReceipts {
  const commandReceiptsRef = useRef<Map<string, CommandReceipt>>(new Map());

  function resolveCommandId(
    slot: string,
    targetId: string,
    expectedVersion: number,
    payload: unknown,
  ): string {
    const mapKey = `${scope.siteEpoch}:${scope.selectedSiteId.toLowerCase()}:${slot}:${targetId.toLowerCase()}`;
    const fingerprint = JSON.stringify({
      scopeNonce,
      siteEpoch: scope.siteEpoch,
      siteId: scope.selectedSiteId.toLowerCase(),
      slot,
      targetId: targetId.toLowerCase(),
      expectedVersion,
      payload,
    });
    const existing = commandReceiptsRef.current.get(mapKey);
    if (existing && existing.fingerprint === fingerprint) {
      return existing.commandId;
    }
    const nextCommandId = crypto.randomUUID();
    commandReceiptsRef.current.set(mapKey, { fingerprint, commandId: nextCommandId });
    return nextCommandId;
  }

  function clearCommandReceipt(epoch: number, siteId: string, slot: string, targetId: string) {
    const mapKey = `${epoch}:${siteId.toLowerCase()}:${slot}:${targetId.toLowerCase()}`;
    commandReceiptsRef.current.delete(mapKey);
  }

  return {
    resolveCommandId,
    clearCommandReceipt,
  };
}

export function useIdentificationCreateCommand({
  client,
  accessToken,
  queryClient,
  copy,
  scope,
  queries,
  revocation,
  receipts,
}: IdentificationCreateCommandParams): IdentificationCreateCommandResult {
  const [trackedEpoch, setTrackedEpoch] = useState(scope.siteEpoch);
  const [trackedCreateResetNonce, setTrackedCreateResetNonce] = useState(
    scope.createFeedbackResetNonce,
  );
  const [createInFlight, setCreateInFlight] = useState<ScopedCreateInFlight | null>(null);
  const [createFeedback, setCreateFeedback] = useState<ScopedCreateFeedback | null>(null);

  if (trackedEpoch !== scope.siteEpoch) {
    setTrackedEpoch(scope.siteEpoch);
    setTrackedCreateResetNonce(scope.createFeedbackResetNonce);
    setCreateInFlight(null);
    setCreateFeedback(null);
  } else if (trackedCreateResetNonce !== scope.createFeedbackResetNonce) {
    setTrackedCreateResetNonce(scope.createFeedbackResetNonce);
    setCreateFeedback(null);
  }

  const createPending = Boolean(
    createInFlight &&
    createInFlight.epoch === scope.siteEpoch &&
    sameId(createInFlight.siteId, scope.selectedSiteId),
  );
  const activeCreateFeedback =
    createFeedback &&
    createFeedback.epoch === scope.siteEpoch &&
    sameId(createFeedback.siteId, scope.selectedSiteId) &&
    sameId(createFeedback.episodeId || 'none', scope.createEpisodeId.trim() || 'none')
      ? createFeedback
      : null;
  const createConflictLocked = Boolean(activeCreateFeedback?.conflictLocked);
  const createError = activeCreateFeedback?.message ?? null;

  function clearCreateFeedback() {
    setCreateFeedback(null);
  }

  async function handleCreateSubmit(trimmedReason: string, evidenceApproval?: EvidenceApproval) {
    if (!scope.isOfficer || createPending || createConflictLocked || queries.siteQueueDenied) {
      return;
    }
    const episodeTarget = scope.createEpisodeId.trim();
    if (!episodeTarget) {
      setCreateFeedback({
        epoch: scope.siteEpoch,
        siteId: scope.selectedSiteId,
        episodeId: '',
        message: copy.createPanel.episodeRequiredError,
        conflictLocked: false,
      });
      return;
    }
    if (
      !queries.eligibleAssignee ||
      (evidenceApproval && !sameId(evidenceApproval.preview.episodeId, episodeTarget))
    )
      return;

    const capturedEpoch = scope.siteEpoch;
    const capturedGen = scope.mutationGenerationRef.current;
    const targetSite = scope.selectedSiteId;
    const opId = crypto.randomUUID();
    const commandId = receipts.resolveCommandId('create', episodeTarget, 0, {
      episodeId: episodeTarget.toLowerCase(),
      assignedTo: queries.eligibleAssignee.id.toLowerCase(),
      reason: trimmedReason,
      ...(evidenceApproval ? { evidenceApproval } : {}),
    });

    const controller = new AbortController();
    scope.mutationControllersRef.current.add(controller);
    setCreateInFlight({ opId, epoch: capturedEpoch, siteId: targetSite, episodeId: episodeTarget });
    setCreateFeedback(null);

    try {
      const mutation = await client.createSafetyIdentificationRequest(
        accessToken,
        targetSite,
        {
          commandId,
          episodeId: episodeTarget,
          assignedTo: queries.eligibleAssignee.id,
          reason: trimmedReason,
          ...(evidenceApproval ? { evidenceApproval } : {}),
          evidenceRefs: [],
        },
        { signal: controller.signal },
      );

      if (!scope.isCurrentSiteMutation(controller, capturedGen, capturedEpoch, targetSite)) {
        return;
      }

      const currentSelectedId = scope.activeScopeRef.current.selectedRequestId;
      const targetRequestId =
        currentSelectedId && sameId(currentSelectedId, mutation.request.id)
          ? currentSelectedId
          : mutation.request.id;
      const wasAlreadySelected = Boolean(
        currentSelectedId && sameId(currentSelectedId, targetRequestId),
      );
      const detailQueryKey = [
        ...scope.queryPrefix,
        'site',
        targetSite,
        'detail',
        targetRequestId,
      ] as const;

      receipts.clearCommandReceipt(capturedEpoch, targetSite, 'create', episodeTarget);
      revocation.clearRevocationForRequest(capturedEpoch, targetSite, targetRequestId);
      scope.setIsCreateOpen(false);
      setCreateFeedback(null);
      if (mutation.replayed) {
        if (scope.statusFilter !== 'ALL') {
          scope.setStatusFilter('ALL');
        }
      } else if (scope.statusFilter !== 'ALL' && scope.statusFilter !== mutation.request.status) {
        scope.setStatusFilter('ALL');
      }
      scope.setQueueOffset(0);
      scope.setSelectedRequestId(targetRequestId);
      scope.setHistoryOffset(0);

      let detailHardDenied = false;
      if (mutation.replayed) {
        revocation.clearRecentlyReloadedKey();
        if (!wasAlreadySelected) {
          queryClient.removeQueries({
            queryKey: detailQueryKey,
            exact: true,
          });
        } else {
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
            revocation.revokeRequestOnHardDenial(
              capturedEpoch,
              targetSite,
              targetRequestId,
              formatIdentificationError(detailState.error, copy),
            );
          }
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
      await queryClient.invalidateQueries({
        queryKey: [...scope.queryPrefix, 'site', targetSite, 'history', targetRequestId],
      });
    } catch (error) {
      if (!scope.aliveRef.current || isAbortOrCancel(error)) return;
      scope.guardUnauthorized(error);
      if (!scope.isCurrentSiteMutation(controller, capturedGen, capturedEpoch, targetSite)) {
        return;
      }
      const formatted = formatIdentificationError(error, copy);
      const isConflict = error instanceof ApiError && error.status === 409;
      setCreateFeedback({
        epoch: capturedEpoch,
        siteId: targetSite,
        episodeId: episodeTarget,
        message: isConflict ? `${formatted}${copy.createPanel.conflictLockedNotice}` : formatted,
        conflictLocked: isConflict,
      });
    } finally {
      scope.mutationControllersRef.current.delete(controller);
      if (scope.aliveRef.current) {
        setCreateInFlight((prev) => (prev?.opId === opId ? null : prev));
      }
    }
  }

  async function handleRefreshCreateAfterConflict() {
    if (createPending) return;
    const capturedEpoch = scope.siteEpoch;
    const capturedSite = scope.selectedSiteId;
    const capturedEpisode = scope.createEpisodeId.trim();
    const [assigneeRes, queueRes] = await Promise.all([
      queries.refetchAssignee(),
      queries.refetchQueue(),
    ]);
    if (
      !scope.aliveRef.current ||
      scope.activeScopeRef.current.epoch !== capturedEpoch ||
      !sameId(scope.activeScopeRef.current.siteId, capturedSite)
    ) {
      return;
    }
    if (!assigneeRes.isError && !queueRes.isError) {
      if (capturedEpisode) {
        receipts.clearCommandReceipt(capturedEpoch, capturedSite, 'create', capturedEpisode);
      }
      setCreateFeedback(null);
    }
  }

  return {
    createPending,
    createConflictLocked,
    createError,
    clearCreateFeedback,
    handleCreateSubmit,
    handleRefreshCreateAfterConflict,
  };
}
