import { IdentificationEvidenceApproval } from './IdentificationEvidenceApproval';
import React, { useId, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { LoginResponse } from '@smartsite/api-client';
import { useTranslation } from 'react-i18next';
import { useManagementClient } from '../../features/auth/auth-session';
import { IconAlertTriangle, IconEye } from '../icons';
import { Alert, AlertDescription, Button, Card, EmptyState } from '../ui';
import { getIdentificationCopy } from './IdentificationCopy';
import {
  formatIdentificationError,
  getIdentificationWorkspaceCopy,
  type IdentificationWorkspaceCopy,
} from './IdentificationWorkspaceCopy';
import {
  HISTORY_PAGE_SIZE,
  QUEUE_PAGE_SIZE,
  sameId,
  useCredentialScope,
  useIdentificationSiteScope,
  type AuthorizedSiteRole,
} from './IdentificationWorkspaceScope';
import { SafetyIdentificationEvidenceImage } from './SafetyIdentificationEvidenceImage';
import { SafetyIdentificationDetailPanel } from './SafetyIdentificationDetailPanel';
import { SafetyIdentificationQueueCard } from './SafetyIdentificationQueueCard';
import { SafetyIdentificationToolbar } from './SafetyIdentificationToolbar';
import { useIdentificationRequestRevocation } from './useIdentificationRequestRevocation';
import { useIdentificationWorkspaceCommands } from './useIdentificationWorkspaceCommands';
import { useIdentificationWorkspaceQueries } from './useIdentificationWorkspaceQueries';
import {
  sanitizeSafetyFrameKey,
  sanitizeSafetyQueryId,
  sanitizeSafetyUuid,
} from '../safety-episodes/safetyUrlParams';

export interface SafetyIdentificationWorkspaceProps {
  apiUrl: string;
  session: Pick<LoginResponse, 'accessToken' | 'user'>;
  initialEpisodeId?: string;
  initialSiteId?: string;
  originRecipientId?: string;
  originFrameKey?: string;
  originCameraId?: string;
  onClearOrigin?: () => void;
  onActiveSiteChange?: (nextSiteId: string) => void;
  onSignOut?: () => void;
}

export function SafetyIdentificationWorkspace({
  apiUrl,
  session,
  initialEpisodeId,
  initialSiteId,
  originRecipientId,
  originFrameKey,
  originCameraId,
  onClearOrigin,
  onActiveSiteChange,
  onSignOut,
}: SafetyIdentificationWorkspaceProps): React.JSX.Element {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language;
  const copy = useMemo(() => getIdentificationWorkspaceCopy(language), [language]);
  const { scopeNonce, authorizedSites, hasValidSession } = useCredentialScope(apiUrl, session);

  if (!hasValidSession) {
    return (
      <Card role="alert" className="min-w-0 space-y-2">
        <div className="flex items-center gap-2 text-rose-700">
          <IconAlertTriangle className="w-4 h-4 shrink-0" />
          <h2 className="text-base font-semibold">{copy.access.deniedTitle}</h2>
        </div>
        <p className="text-sm text-slate-600 leading-relaxed">{copy.access.deniedDescription}</p>
      </Card>
    );
  }

  return (
    <ScopedIdentificationWorkspace
      key={scopeNonce}
      scopeNonce={scopeNonce}
      apiUrl={apiUrl}
      session={session}
      authorizedSites={authorizedSites}
      initialEpisodeId={initialEpisodeId}
      initialSiteId={initialSiteId}
      originRecipientId={originRecipientId}
      originFrameKey={originFrameKey}
      originCameraId={originCameraId}
      onClearOrigin={onClearOrigin}
      onActiveSiteChange={onActiveSiteChange}
      onSignOut={onSignOut}
      language={language}
      copy={copy}
    />
  );
}

interface ScopedIdentificationWorkspaceProps {
  scopeNonce: string;
  apiUrl: string;
  session: Pick<LoginResponse, 'accessToken' | 'user'>;
  authorizedSites: readonly AuthorizedSiteRole[];
  initialEpisodeId?: string;
  initialSiteId?: string;
  originRecipientId?: string;
  originFrameKey?: string;
  originCameraId?: string;
  onClearOrigin?: () => void;
  onActiveSiteChange?: (nextSiteId: string) => void;
  onSignOut?: () => void;
  language?: string;
  copy: IdentificationWorkspaceCopy;
}

function ScopedIdentificationWorkspace({
  scopeNonce,
  apiUrl,
  session,
  authorizedSites,
  initialEpisodeId,
  initialSiteId,
  originRecipientId,
  originFrameKey,
  originCameraId,
  onClearOrigin,
  onActiveSiteChange,
  onSignOut,
  language,
  copy,
}: ScopedIdentificationWorkspaceProps): React.JSX.Element {
  const baseId = useId();
  const client = useManagementClient(apiUrl);
  const queryClient = useQueryClient();
  const formCopy = useMemo(() => getIdentificationCopy(language), [language]);

  const scope = useIdentificationSiteScope({
    scopeNonce,
    apiUrl,
    authorizedSites,
    initialSiteId,
    initialEpisodeId,
    onSignOut,
    queryClient,
  });

  const originIdentityKey = JSON.stringify([initialSiteId ?? '', initialEpisodeId ?? '']);
  const [clearedOriginKey, setClearedOriginKey] = useState<string | null>(null);
  const isOriginActive =
    clearedOriginKey !== originIdentityKey &&
    (!initialSiteId || sameId(scope.selectedSiteId, initialSiteId));
  const effectiveInitialEpisodeId =
    isOriginActive && (!scope.createEpisodeId || sameId(scope.createEpisodeId, initialEpisodeId))
      ? initialEpisodeId
      : undefined;

  function clearOriginContext() {
    setClearedOriginKey(originIdentityKey);
    onClearOrigin?.();
  }

  const revocation = useIdentificationRequestRevocation({
    client,
    accessToken: session.accessToken,
    queryClient,
    copy,
    scope,
  });

  const queries = useIdentificationWorkspaceQueries({
    client,
    accessToken: session.accessToken,
    currentUserId: session.user.id,
    initialEpisodeId: effectiveInitialEpisodeId,
    activeRevocation: revocation.activeRevocation,
    detailStaleTime: revocation.detailStaleTime,
    copy,
    scope,
  });

  const commands = useIdentificationWorkspaceCommands({
    scopeNonce,
    client,
    accessToken: session.accessToken,
    queryClient,
    copy,
    scope,
    queries,
    revocation,
  });

  function handleSelectRequest(requestId: string) {
    if (sameId(requestId, scope.selectedRequestId)) return;
    const request = queries.queueItems.find((item) => sameId(item.id, requestId));
    if (request && !sameId(request.episodeId, initialEpisodeId)) clearOriginContext();
    scope.setSelectedRequestId(requestId);
    scope.setHistoryOffset(0);
    commands.clearDetailFeedback();
    revocation.clearRecentlyReloadedKey();
  }

  return (
    <section
      className="min-w-0 space-y-5 max-sm:[&_.grid:not(.grid-cols-2)]:grid-cols-1 [&_.grid>*]:min-w-0 [&_select]:max-w-full [&_select]:min-w-0"
      aria-labelledby={`${baseId}-workspace-heading`}
    >
      <SafetyIdentificationToolbar
        baseId={baseId}
        scopeNonce={scopeNonce}
        siteEpoch={scope.siteEpoch}
        selectedSiteId={scope.selectedSiteId}
        authorizedSites={authorizedSites}
        siteLabelsById={queries.siteLabelsById}
        isOfficer={scope.isOfficer}
        isManager={scope.isManager}
        statusFilter={scope.statusFilter}
        queueFetching={queries.queueFetching}
        queueAvailable={queries.queueAvailable}
        siteQueueDenied={queries.siteQueueDenied}
        initialEpisodeId={effectiveInitialEpisodeId}
        isCreateOpen={scope.isCreateOpen}
        createEpisodeId={scope.createEpisodeId}
        shouldLoadEpisodes={queries.shouldLoadEpisodes}
        episodesPending={queries.episodesPending}
        episodeOptions={queries.episodeOptions}
        eligibleAssignee={queries.eligibleAssignee}
        assigneeLoading={queries.assigneeLoading}
        assigneeError={queries.assigneeError}
        assigneeHasError={queries.assigneeHasError}
        createPending={commands.createPending}
        createConflictLocked={commands.createConflictLocked}
        createError={commands.createError}
        copy={copy}
        formCopy={formCopy}
        onRefreshQueue={() => void queries.refetchQueue()}
        onToggleCreate={() => {
          scope.setIsCreateOpen((open) => !open);
          commands.clearCreateFeedback();
          if (!scope.isCreateOpen && !scope.createEpisodeId && effectiveInitialEpisodeId?.trim()) {
            scope.setCreateEpisodeId(effectiveInitialEpisodeId.trim());
          }
        }}
        onSiteSwitch={(siteId) => {
          const siteChanged = !sameId(siteId, scope.selectedSiteId);
          scope.handleSiteSwitch(siteId);
          if (siteChanged) {
            setClearedOriginKey(originIdentityKey);
            if (onActiveSiteChange) {
              onActiveSiteChange(siteId);
            } else {
              onClearOrigin?.();
            }
          }
        }}
        onStatusFilterChange={scope.handleStatusFilterChange}
        onCreateEpisodeChange={(nextEpisodeId) => {
          if (initialEpisodeId && !sameId(nextEpisodeId, initialEpisodeId)) {
            clearOriginContext();
          }
          scope.setCreateEpisodeId(nextEpisodeId);
          commands.clearCreateFeedback();
        }}
        onRefreshCreateAfterConflict={() => void commands.handleRefreshCreateAfterConflict()}
        onCancelCreate={() => {
          scope.setIsCreateOpen(false);
          commands.clearCreateFeedback();
        }}
        onSubmitCreate={(reason, approval) => void commands.handleCreateSubmit(reason, approval)}
        renderEvidence={
          scope.createEpisodeId && queries.queueAvailable && !queries.siteQueueDenied
            ? (onApprove) => (
                <IdentificationEvidenceApproval
                  client={client}
                  token={session.accessToken}
                  siteId={scope.selectedSiteId}
                  episodeId={scope.createEpisodeId}
                  vietnamese={language?.startsWith('vi') ?? false}
                  onApprove={onApprove}
                  disabled={commands.createPending || commands.createConflictLocked}
                />
              )
            : undefined
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 items-start [&>*]:min-w-0">
        <SafetyIdentificationQueueCard
          queueItems={queries.queueItems}
          queueTotal={queries.queueTotal}
          queueOffset={scope.queueOffset}
          queueLoading={queries.queueLoading}
          queueFetching={queries.queueFetching}
          queueError={queries.queueError}
          queueHasError={queries.queueHasError}
          selectedRequestId={scope.selectedRequestId}
          isOfficer={scope.isOfficer}
          copy={copy}
          onRetryQueue={() => void queries.refetchQueue()}
          onSelectRequest={handleSelectRequest}
          onPreviousPage={() =>
            scope.setQueueOffset((current) => Math.max(0, current - QUEUE_PAGE_SIZE))
          }
          onNextPage={() => scope.setQueueOffset((current) => current + QUEUE_PAGE_SIZE)}
        />

        <div className="min-w-0 lg:col-span-7">
          {queries.siteQueueUnavailable ? (
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <EmptyState
                icon={<IconAlertTriangle className="w-5 h-5 text-amber-600" />}
                title={copy.unavailable.detailTitle}
                description={copy.unavailable.detailDescription}
              />
            </div>
          ) : !scope.selectedRequestId || queries.queueHasError ? (
            <div className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="max-w-lg space-y-2 py-1 text-left">
                <div className="flex items-center gap-2 text-slate-950">
                  <IconEye className="w-4 h-4 shrink-0 text-slate-500" />
                  <h3 className="text-base font-semibold">{copy.detail.emptyTitle}</h3>
                </div>
                <p className="text-sm leading-relaxed text-slate-600">
                  {copy.detail.emptyDescription}
                </p>
              </div>
            </div>
          ) : revocation.activeRevocation ? (
            <Card>
              <Alert variant="destructive">
                <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                  <span>{revocation.activeRevocation.message}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    isLoading={revocation.isReloadingSelectedRevoked}
                    disabled={revocation.isReloadingSelectedRevoked}
                    onClick={() =>
                      void revocation.reloadRevokedRequest(
                        scope.selectedRequestId!,
                        queries.siteQueueDenied,
                        commands.clearDetailFeedbackForRequest,
                      )
                    }
                  >
                    {copy.queue.retryLabel}
                  </Button>
                </AlertDescription>
              </Alert>
            </Card>
          ) : queries.detailHasError ? (
            <Card>
              <Alert variant="destructive">
                <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                  <span>{formatIdentificationError(queries.detailError, copy)}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void queries.refetchDetail()}
                  >
                    {copy.queue.retryLabel}
                  </Button>
                </AlertDescription>
              </Alert>
            </Card>
          ) : !queries.activeRequest && queries.detailPending ? (
            <Card>
              <p role="status" className="py-8 text-center text-sm font-medium text-slate-600">
                {copy.detail.loading}
              </p>
            </Card>
          ) : queries.activeRequest ? (
            <SafetyIdentificationDetailPanel
              key={`${scopeNonce}:${scope.siteEpoch}:${scope.selectedSiteId}:${queries.activeRequest.id}`}
              request={queries.activeRequest}
              approvedEvidence={
                !queries.detailFetching &&
                queries.activeRequest.evidenceAvailability.status === 'AVAILABLE' &&
                (scope.isOfficer ||
                  (scope.isManager && sameId(queries.activeRequest.assignedTo, session.user.id)))
                  ? queries.activeRequest.evidenceRefs.map((evidenceId, index) => (
                      <SafetyIdentificationEvidenceImage
                        key={`${queries.activeRequest!.version}:${evidenceId}`}
                        vietnamese={language?.startsWith('vi') ?? false}
                        number={index + 1}
                        load={(signal) =>
                          client.readSafetyIdentificationEvidence(
                            session.accessToken,
                            scope.selectedSiteId,
                            queries.activeRequest!.id,
                            evidenceId,
                            { signal },
                          )
                        }
                      />
                    ))
                  : undefined
              }
              originRecipientId={
                isOriginActive &&
                scope.isOfficer &&
                sameId(queries.activeRequest.siteId, initialSiteId) &&
                sameId(queries.activeRequest.episodeId, initialEpisodeId)
                  ? sanitizeSafetyUuid(originRecipientId)
                  : undefined
              }
              originFrameKey={
                isOriginActive &&
                scope.isOfficer &&
                sameId(queries.activeRequest.siteId, initialSiteId) &&
                sameId(queries.activeRequest.episodeId, initialEpisodeId)
                  ? sanitizeSafetyFrameKey(originFrameKey)
                  : undefined
              }
              originCameraId={
                isOriginActive &&
                scope.isOfficer &&
                sameId(queries.activeRequest.siteId, initialSiteId) &&
                sameId(queries.activeRequest.episodeId, initialEpisodeId)
                  ? sanitizeSafetyQueryId(originCameraId)?.toLowerCase()
                  : undefined
              }
              detailLoading={queries.detailFetching}
              detailError={null}
              onRefreshDetail={() => {
                revocation.clearRecentlyReloadedKey();
                void queries.refetchDetail();
                if (scope.isOfficer) {
                  void queries.refetchHistory();
                }
              }}
              currentUserId={session.user.id}
              isOfficer={scope.isOfficer}
              isManager={scope.isManager}
              formKeyPrefix={`${scopeNonce}:${scope.siteEpoch}:${scope.selectedSiteId}`}
              formCopy={formCopy}
              copy={copy}
              allWorkers={queries.workerCandidates}
              contractors={queries.contractorCandidates}
              candidatesLoading={queries.candidatesLoading}
              candidatesError={queries.candidatesError}
              eligibleAssignee={queries.eligibleAssignee}
              assigneeLoading={queries.assigneeLoading}
              pendingAction={commands.pendingAction}
              actionError={commands.activeScopedError}
              conflictLocked={commands.activeConflictLocked}
              onRefreshAfterConflict={() => void commands.handleRefreshAfterConflict()}
              onRespond={commands.handleManagerRespond}
              onReview={commands.handleOfficerReview}
              onReassign={commands.handleOfficerReassign}
              onCancelRequest={commands.handleOfficerCancel}
              onCreateFollowUp={
                scope.isOfficer
                  ? (episodeId) => {
                      if (initialEpisodeId && !sameId(episodeId, initialEpisodeId)) {
                        clearOriginContext();
                      }
                      scope.setCreateEpisodeId(episodeId);
                      scope.setIsCreateOpen(true);
                      commands.clearCreateFeedback();
                    }
                  : undefined
              }
              historyPage={queries.historyPage}
              historyLoading={queries.historyFetching}
              historyError={queries.historyError}
              historyOffset={scope.historyOffset}
              historyPageSize={HISTORY_PAGE_SIZE}
              onHistoryOffsetChange={scope.setHistoryOffset}
              onRetryHistory={() => void queries.refetchHistory()}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}
