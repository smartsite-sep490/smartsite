import { useId, type JSX } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';
import type {
  SafetyIdentificationHistoryPage,
  SafetyIdentificationStatus,
} from '@smartsite/contracts/safety-identification';
import { IconArrowRight, IconCheck, IconChevronLeft, IconChevronRight } from '../icons';
import { Alert, AlertDescription, AlertTitle, Badge, Button, Card } from '../ui';
import {
  outcomeBadgeVariant,
  type IdentificationWorkspaceCopy,
} from './IdentificationWorkspaceCopy';
import { formatIdentificationDateTime } from './safetyIdentificationDetailShared';
import {
  sanitizeSafetyFrameKey,
  sanitizeSafetyQueryId,
  sanitizeSafetyUuid,
} from '../safety-episodes/safetyUrlParams';

export interface SafetyIdentificationHistorySectionProps {
  isOfficer: boolean;
  status: SafetyIdentificationStatus;
  siteId: string;
  episodeId: string;
  originRecipientId?: string;
  originFrameKey?: string;
  originCameraId?: string;
  copy: IdentificationWorkspaceCopy;
  onCreateFollowUp?: (episodeId: string) => void;
  historyPage: SafetyIdentificationHistoryPage | undefined;
  historyLoading: boolean;
  historyError: string | null;
  historyOffset: number;
  historyPageSize: number;
  onHistoryOffsetChange: (nextOffset: number) => void;
  onRetryHistory: () => void;
  resolveWorkerLabel: (workerId: string | null) => string;
  resolveContractorLabel: (contractorId: string | null) => string;
}

export function SafetyIdentificationHistorySection({
  isOfficer,
  status,
  siteId,
  episodeId,
  originRecipientId,
  originFrameKey,
  originCameraId,
  copy,
  onCreateFollowUp,
  historyPage,
  historyLoading,
  historyError,
  historyOffset,
  historyPageSize,
  onHistoryOffsetChange,
  onRetryHistory,
  resolveWorkerLabel,
  resolveContractorLabel,
}: SafetyIdentificationHistorySectionProps): JSX.Element | null {
  const baseId = useId();
  const inRouter = useInRouterContext();

  if (!isOfficer) {
    return null;
  }

  const historyItems = historyPage?.items ?? [];
  const historyTotal = historyPage?.total ?? 0;
  const hasPreviousHistory = historyOffset > 0;
  const hasNextHistory = historyOffset + historyPageSize < historyTotal;

  const safeSiteId = sanitizeSafetyQueryId(siteId);
  const validOriginRecipientId = sanitizeSafetyUuid(originRecipientId);
  const validOriginFrameKey = sanitizeSafetyFrameKey(originFrameKey);
  const validOriginCameraId = sanitizeSafetyQueryId(originCameraId)?.toLowerCase();

  const destination = new URLSearchParams();
  if (safeSiteId) {
    if (validOriginRecipientId) {
      destination.set('tab', 'episodes');
      destination.set('siteId', safeSiteId);
      destination.set('recipientId', validOriginRecipientId);
      if (validOriginFrameKey) destination.set('frameKey', validOriginFrameKey);
      if (validOriginCameraId) destination.set('cameraId', validOriginCameraId);
    } else {
      destination.set('siteId', safeSiteId);
    }
  }
  const incidentsHref = destination.size > 0 ? `/incidents?${destination}` : '/incidents';
  const hasValidOrigin = Boolean(safeSiteId && validOriginRecipientId);
  const linkLabel = hasValidOrigin ? copy.detail.returnToInboxLink : copy.detail.openIncidentsLink;

  const renderIncidentsAnchor = (label: string) =>
    inRouter ? (
      <Link
        to={incidentsHref}
        className="inline-flex items-center gap-1.5 text-xs font-bold text-[#071A2B] underline hover:text-[#F66B17]"
      >
        <span>{label}</span>
        <IconArrowRight className="w-3.5 h-3.5" />
      </Link>
    ) : (
      <a
        href={incidentsHref}
        className="inline-flex items-center gap-1.5 text-xs font-bold text-[#071A2B] underline hover:text-[#F66B17]"
      >
        <span>{label}</span>
        <IconArrowRight className="w-3.5 h-3.5" />
      </a>
    );

  return (
    <>
      {status !== 'CLOSED' && hasValidOrigin && (
        <Card className="flex flex-wrap items-center justify-between gap-2 bg-slate-50/80 py-3">
          <p className="text-xs text-slate-700">{copy.detail.originCaseContextNotice}</p>
          {renderIncidentsAnchor(copy.detail.returnToInboxLink)}
        </Card>
      )}

      {status === 'CLOSED' && (
        <Alert variant="success">
          <IconCheck className="w-4 h-4" />
          <div>
            <AlertTitle>{copy.detail.closedFollowUpTitle}</AlertTitle>
            <AlertDescription className="mt-1 space-y-2">
              <p>{copy.detail.closedFollowUpBody}</p>
              {renderIncidentsAnchor(linkLabel)}
            </AlertDescription>
          </div>
        </Alert>
      )}

      {status === 'CANCELLED' && (
        <Card className="space-y-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
            {copy.detail.cancelledFollowUpTitle}
          </h4>
          <p className="text-xs text-slate-600 leading-relaxed">
            {copy.detail.cancelledFollowUpBody}
          </p>
          {onCreateFollowUp && (
            <div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onCreateFollowUp(episodeId)}
              >
                {copy.detail.createFollowUpButton}
              </Button>
            </div>
          )}
        </Card>
      )}

      <Card className="space-y-4" aria-labelledby={`${baseId}-history-heading`}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <h3 id={`${baseId}-history-heading`} className="text-sm font-bold text-[#071A2B]">
              {copy.detail.historyTitle}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">{copy.detail.historySubtitle}</p>
          </div>
          {historyTotal > 0 && (
            <span className="text-xs font-semibold text-slate-500">
              {copy.queue.showingRange(
                historyOffset + 1,
                Math.min(historyOffset + historyItems.length, historyTotal),
                historyTotal,
              )}
            </span>
          )}
        </div>

        {historyLoading && !historyPage && (
          <p role="status" className="text-xs text-slate-600">
            {copy.detail.historyLoading}
          </p>
        )}

        {historyError && (
          <Alert variant="destructive">
            <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
              <span>{historyError}</span>
              <Button type="button" variant="outline" size="sm" onClick={onRetryHistory}>
                {copy.queue.retryLabel}
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {!historyLoading && !historyError && historyItems.length === 0 && (
          <p className="text-xs text-slate-500">{copy.detail.historyEmpty}</p>
        )}

        {historyItems.length > 0 && (
          <ol className="space-y-3">
            {historyItems.map((entry) => (
              <li
                key={`${entry.version}-${entry.kind}-${entry.recordedAt}`}
                className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-3.5 space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge
                    variant={
                      entry.kind === 'ACCEPT'
                        ? 'success'
                        : entry.kind === 'CANCEL'
                          ? 'danger'
                          : entry.kind === 'RESPOND'
                            ? 'info'
                            : 'warning'
                    }
                  >
                    {copy.detail.historyKinds[entry.kind]}
                  </Badge>
                  <span className="text-[11px] text-slate-500">
                    {formatIdentificationDateTime(entry.recordedAt)}
                  </span>
                </div>

                <p className="text-xs text-[#071A2B] whitespace-pre-wrap break-words leading-relaxed">
                  {entry.reason}
                </p>

                {entry.proposal && (
                  <div className="rounded-lg border border-slate-200 bg-white p-2.5 text-xs space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-slate-700">
                        {copy.detail.historyProposalLabel}:
                      </span>
                      <Badge variant={outcomeBadgeVariant(entry.proposal.outcome)}>
                        {copy.outcomes[entry.proposal.outcome]}
                      </Badge>
                    </div>
                    {(entry.proposal.workerId || entry.proposal.contractorId) && (
                      <p className="text-[11px] text-slate-600 break-words">
                        {entry.proposal.workerId
                          ? `${copy.detail.proposalWorkerLabel}: ${resolveWorkerLabel(entry.proposal.workerId)}`
                          : ''}
                        {entry.proposal.workerId && entry.proposal.contractorId ? ' · ' : ''}
                        {entry.proposal.contractorId
                          ? `${copy.detail.proposalContractorLabel}: ${resolveContractorLabel(entry.proposal.contractorId)}`
                          : ''}
                      </p>
                    )}
                  </div>
                )}

                <details className="text-[11px] text-slate-500">
                  <summary className="cursor-pointer font-semibold text-slate-600 select-none">
                    {copy.detail.technicalDetailsLabel}
                  </summary>
                  <div className="mt-1.5 space-y-1 font-mono break-all text-slate-600">
                    <div>{copy.queue.versionPrefix(entry.version)}</div>
                    <div>
                      {copy.detail.historyActorLabel}: {entry.actorId}
                    </div>
                    <div>
                      {copy.detail.historyAssignedToLabel}: {entry.assignedTo}
                    </div>
                    {entry.proposal?.workerId && (
                      <div>
                        {copy.detail.proposalWorkerLabel}: {entry.proposal.workerId}
                      </div>
                    )}
                    {entry.proposal?.contractorId && (
                      <div>
                        {copy.detail.proposalContractorLabel}: {entry.proposal.contractorId}
                      </div>
                    )}
                  </div>
                </details>
              </li>
            ))}
          </ol>
        )}

        {(hasPreviousHistory || hasNextHistory) && (
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!hasPreviousHistory || historyLoading}
              leftIcon={<IconChevronLeft className="w-3.5 h-3.5" />}
              onClick={() => onHistoryOffsetChange(Math.max(0, historyOffset - historyPageSize))}
            >
              {copy.queue.previousPage}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!hasNextHistory || historyLoading}
              rightIcon={<IconChevronRight className="w-3.5 h-3.5" />}
              onClick={() => onHistoryOffsetChange(historyOffset + historyPageSize)}
            >
              {copy.queue.nextPage}
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}
