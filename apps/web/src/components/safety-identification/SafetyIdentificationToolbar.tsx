import type { IdentificationCreateFormProps } from './safetyIdentificationFormTypes';
import React from 'react';
import {
  SAFETY_IDENTIFICATION_STATUSES,
  type SafetyIdentificationStatus,
} from '@smartsite/contracts/safety-identification';
import type { SafetyEpisodeSummary } from '@smartsite/contracts';
import { IconBuilding, IconFilter, IconPlus, IconRefresh, IconX } from '../icons';
import { Badge, Button, Card } from '../ui';
import type { IdentificationCopy } from './IdentificationCopy';
import { IdentificationCreateForm, type NamedCandidate } from './SafetyIdentificationForms';
import {
  formatIdentificationError,
  type IdentificationWorkspaceCopy,
  type StatusFilterValue,
} from './IdentificationWorkspaceCopy';
import {
  formatEpisodeOptionLabel,
  sameId,
  WORKSPACE_SELECT_CLASS,
  type AuthorizedSiteRole,
} from './IdentificationWorkspaceScope';

export interface SafetyIdentificationToolbarProps {
  baseId: string;
  scopeNonce: string;
  siteEpoch: number;
  selectedSiteId: string;
  authorizedSites: readonly AuthorizedSiteRole[];
  siteLabelsById: ReadonlyMap<string, string>;
  isOfficer: boolean;
  isManager: boolean;
  statusFilter: StatusFilterValue;
  queueFetching: boolean;
  queueAvailable: boolean;
  siteQueueDenied: boolean;
  initialEpisodeId?: string;
  isCreateOpen: boolean;
  createEpisodeId: string;
  shouldLoadEpisodes: boolean;
  episodesPending: boolean;
  episodeOptions: readonly SafetyEpisodeSummary[];
  eligibleAssignee: NamedCandidate | null;
  assigneeLoading: boolean;
  assigneeError: unknown;
  assigneeHasError: boolean;
  createPending: boolean;
  createConflictLocked: boolean;
  createError: string | null;
  copy: IdentificationWorkspaceCopy;
  formCopy: IdentificationCopy;
  onRefreshQueue: () => void;
  onToggleCreate: () => void;
  onSiteSwitch: (nextSiteId: string) => void;
  onStatusFilterChange: (nextFilter: StatusFilterValue) => void;
  onCreateEpisodeChange: (nextEpisodeId: string) => void;
  onRefreshCreateAfterConflict: () => void;
  onCancelCreate: () => void;
  onSubmitCreate: IdentificationCreateFormProps['onSubmit'];
  renderEvidence?: IdentificationCreateFormProps['renderEvidence'];
}

export function SafetyIdentificationToolbar({
  baseId,
  scopeNonce,
  siteEpoch,
  selectedSiteId,
  authorizedSites,
  siteLabelsById,
  isOfficer,
  isManager,
  statusFilter,
  queueFetching,
  queueAvailable,
  siteQueueDenied,
  initialEpisodeId,
  isCreateOpen,
  createEpisodeId,
  shouldLoadEpisodes,
  episodesPending,
  episodeOptions,
  eligibleAssignee,
  assigneeLoading,
  assigneeError,
  assigneeHasError,
  createPending,
  createConflictLocked,
  createError,
  copy,
  formCopy,
  onRefreshQueue,
  onToggleCreate,
  onSiteSwitch,
  onStatusFilterChange,
  onCreateEpisodeChange,
  onRefreshCreateAfterConflict,
  onCancelCreate,
  onSubmitCreate,
  renderEvidence,
}: SafetyIdentificationToolbarProps): React.JSX.Element {
  const prefilledEpisodeLocked = Boolean(
    initialEpisodeId?.trim() && sameId(createEpisodeId, initialEpisodeId.trim()),
  );

  return (
    <>
      <Card className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4 min-w-0">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-[#F66B17]">
                {copy.header.eyebrow}
              </span>
              {isOfficer && (
                <Badge variant="default" dot>
                  {copy.header.officerBadge}
                </Badge>
              )}
              {isManager && (
                <Badge variant="info" dot>
                  {copy.header.managerBadge}
                </Badge>
              )}
            </div>
            <h2
              id={`${baseId}-workspace-heading`}
              className="text-lg font-extrabold text-[#071A2B] tracking-tight"
            >
              {copy.header.title}
            </h2>
            <p className="text-xs text-slate-600 max-w-3xl leading-relaxed">
              {isOfficer ? copy.header.officerSubtitle : copy.header.managerSubtitle}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 min-w-0 max-w-full">
            <Button
              type="button"
              variant="outline"
              size="md"
              isLoading={queueFetching}
              leftIcon={<IconRefresh className="w-3.5 h-3.5" />}
              onClick={onRefreshQueue}
            >
              {copy.header.refreshQueue}
            </Button>
            {isOfficer && !siteQueueDenied && (
              <Button
                type="button"
                variant={isCreateOpen ? 'outline' : 'primary'}
                size="md"
                leftIcon={
                  isCreateOpen ? (
                    <IconX className="w-3.5 h-3.5" />
                  ) : (
                    <IconPlus className="w-3.5 h-3.5" />
                  )
                }
                onClick={onToggleCreate}
              >
                {isCreateOpen ? copy.header.closeCreate : copy.header.newFromEpisode}
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3.5 min-w-0">
          <div className="min-w-0 w-full sm:w-auto sm:max-w-md space-y-1">
            <label
              htmlFor={`${baseId}-site-select`}
              className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-600"
            >
              <IconBuilding className="w-3.5 h-3.5 shrink-0 text-slate-500" />
              <span>{copy.filters.siteLabel}</span>
            </label>
            <select
              id={`${baseId}-site-select`}
              value={selectedSiteId}
              onChange={(event) => onSiteSwitch(event.target.value)}
              className={`${WORKSPACE_SELECT_CLASS} w-full max-w-full min-w-0 truncate`}
            >
              {authorizedSites.map((entry) => {
                const resolvedName = siteLabelsById.get(entry.siteId.toLowerCase());
                return (
                  <option key={entry.siteId} value={entry.siteId}>
                    {resolvedName ?? `${copy.filters.siteFallbackPrefix} · ${entry.siteId}`}
                  </option>
                );
              })}
            </select>
          </div>

          <div className="min-w-0 w-full sm:w-auto sm:max-w-xs space-y-1">
            <label
              htmlFor={`${baseId}-status-select`}
              className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-600"
            >
              <IconFilter className="w-3.5 h-3.5 shrink-0 text-slate-500" />
              <span>{copy.filters.statusLabel}</span>
            </label>
            <select
              id={`${baseId}-status-select`}
              value={statusFilter}
              onChange={(event) => onStatusFilterChange(event.target.value as StatusFilterValue)}
              className={`${WORKSPACE_SELECT_CLASS} w-full max-w-full min-w-0 truncate`}
            >
              <option value="ALL">{copy.filters.allStatuses}</option>
              {SAFETY_IDENTIFICATION_STATUSES.map((status: SafetyIdentificationStatus) => (
                <option key={status} value={status}>
                  {copy.filters.statuses[status]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Card>

      {isOfficer && isCreateOpen && !siteQueueDenied && (
        <div className="min-w-0 space-y-3">
          {!prefilledEpisodeLocked && shouldLoadEpisodes ? (
            <Card className="min-w-0 space-y-2 bg-slate-50/70">
              <label
                htmlFor={`${baseId}-create-episode-select`}
                className="block text-xs font-bold text-[#071A2B]"
              >
                {copy.createPanel.episodeSelectLabel}
              </label>
              {episodesPending ? (
                <p role="status" className="text-xs text-slate-600">
                  {copy.createPanel.episodeLoading}
                </p>
              ) : (
                <select
                  id={`${baseId}-create-episode-select`}
                  value={createEpisodeId}
                  disabled={createPending}
                  onChange={(event) => onCreateEpisodeChange(event.target.value)}
                  className={`${WORKSPACE_SELECT_CLASS} w-full max-w-full min-w-0 truncate`}
                >
                  <option value="">
                    {episodeOptions.length === 0
                      ? copy.createPanel.episodeEmpty
                      : copy.createPanel.episodeSelectPlaceholder}
                  </option>
                  {episodeOptions.map((episode) => (
                    <option key={episode.id} value={episode.id}>
                      {formatEpisodeOptionLabel(episode)}
                    </option>
                  ))}
                </select>
              )}
            </Card>
          ) : createEpisodeId ? (
            <details className="rounded-xl border border-slate-200/80 bg-slate-50/70 px-3.5 py-2.5 text-xs text-slate-600">
              <summary className="cursor-pointer font-semibold text-[#071A2B] select-none">
                {copy.createPanel.prefilledEpisodeLabel}
              </summary>
              <p className="mt-1.5 font-mono break-all text-slate-700">{createEpisodeId}</p>
            </details>
          ) : null}

          <IdentificationCreateForm
            key={`${scopeNonce}:${siteEpoch}:${selectedSiteId}:${createEpisodeId || 'none'}`}
            assignee={eligibleAssignee}
            assigneeLoading={assigneeLoading || !queueAvailable}
            pending={createPending}
            disabled={!createEpisodeId.trim() || createConflictLocked}
            error={
              createError ?? (assigneeError ? formatIdentificationError(assigneeError, copy) : null)
            }
            onRefresh={
              createConflictLocked || assigneeHasError ? onRefreshCreateAfterConflict : undefined
            }
            onCancel={onCancelCreate}
            onSubmit={onSubmitCreate}
            renderEvidence={renderEvidence}
            copy={formCopy}
          />
        </div>
      )}
    </>
  );
}
