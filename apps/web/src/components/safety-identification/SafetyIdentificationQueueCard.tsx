import React from 'react';
import type { SafetyIdentificationRequest } from '@smartsite/contracts/safety-identification';
import {
  IconAlertTriangle,
  IconChevronLeft,
  IconChevronRight,
  IconClock,
  IconShield,
} from '../icons';
import { Alert, AlertDescription, Badge, Button, EmptyState } from '../ui';
import {
  formatIdentificationError,
  outcomeBadgeVariant,
  statusBadgeVariant,
  type IdentificationWorkspaceCopy,
} from './IdentificationWorkspaceCopy';
import { formatHumanSubjectSummary } from './safetyIdentificationDetailShared';
import {
  formatShortTimestamp,
  isIdentificationAccessDenied,
  isIdentificationFeatureUnavailable,
  isIdentificationUnauthorized,
  QUEUE_PAGE_SIZE,
  sameId,
} from './IdentificationWorkspaceScope';

export interface SafetyIdentificationQueueCardProps {
  queueItems: readonly SafetyIdentificationRequest[];
  queueTotal: number;
  queueOffset: number;
  queueLoading: boolean;
  queueFetching: boolean;
  queueError: unknown;
  queueHasError: boolean;
  selectedRequestId: string | null;
  isOfficer: boolean;
  copy: IdentificationWorkspaceCopy;
  onRetryQueue: () => void;
  onSelectRequest: (requestId: string) => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
}

export function SafetyIdentificationQueueCard({
  queueItems,
  queueTotal,
  queueOffset,
  queueLoading,
  queueFetching,
  queueError,
  queueHasError,
  selectedRequestId,
  isOfficer,
  copy,
  onRetryQueue,
  onSelectRequest,
  onPreviousPage,
  onNextPage,
}: SafetyIdentificationQueueCardProps): React.JSX.Element {
  const hasPreviousQueuePage = !queueHasError && queueOffset > 0;
  const hasNextQueuePage = !queueHasError && queueOffset + QUEUE_PAGE_SIZE < queueTotal;
  const featureUnavailable = Boolean(queueError) && isIdentificationFeatureUnavailable(queueError);
  const accessDenied = Boolean(queueError) && isIdentificationAccessDenied(queueError);
  const sessionExpired = Boolean(queueError) && isIdentificationUnauthorized(queueError);

  return (
    <div className="lg:col-span-5 overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/80 bg-slate-50/70 px-4 py-2.5">
        <h3 className="text-sm font-semibold text-slate-950">{copy.queue.title}</h3>
        {featureUnavailable ? (
          <Badge
            variant="warning"
            dot
            className="text-xs! font-medium! normal-case! tracking-normal!"
          >
            {copy.unavailable.badgeLabel}
          </Badge>
        ) : (
          <span className="text-xs font-medium text-slate-600 tabular-nums">
            {queueTotal > 0 && queueItems.length > 0
              ? copy.queue.showingRange(
                  queueOffset + 1,
                  Math.min(queueOffset + queueItems.length, queueTotal),
                  queueTotal,
                )
              : queueHasError
                ? '—'
                : copy.queue.zeroTotal}
          </span>
        )}
      </div>

      {queueLoading && (
        <p role="status" className="px-4 py-6 text-center text-sm font-medium text-slate-600">
          {copy.queue.loading}
        </p>
      )}

      {featureUnavailable && (
        <div className="p-4">
          <div
            role="status"
            data-testid="identification-unavailable-state"
            className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/90 p-3.5 text-xs text-amber-950"
          >
            <div className="flex items-start gap-2.5">
              <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <div className="space-y-1">
                <p className="font-semibold text-amber-950">{copy.unavailable.queueTitle}</p>
                <p className="leading-relaxed text-amber-900">
                  {copy.unavailable.queueDescription}
                </p>
              </div>
            </div>
            <div className="flex justify-end">
              <Button type="button" variant="outline" size="sm" onClick={onRetryQueue}>
                {copy.queue.retryLabel}
              </Button>
            </div>
          </div>
        </div>
      )}

      {Boolean(queueError) && !featureUnavailable && (
        <div className="p-4">
          <Alert
            variant="destructive"
            data-testid={
              sessionExpired
                ? 'identification-queue-expired'
                : accessDenied
                  ? 'identification-queue-denied'
                  : 'identification-queue-error'
            }
          >
            <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
              <span>{formatIdentificationError(queueError, copy)}</span>
              <Button type="button" variant="outline" size="sm" onClick={onRetryQueue}>
                {copy.queue.retryLabel}
              </Button>
            </AlertDescription>
          </Alert>
        </div>
      )}

      {!queueLoading && !queueError && queueItems.length === 0 && (
        <div className="p-4">
          <EmptyState
            icon={<IconShield className="w-5 h-5" />}
            title={copy.queue.emptyTitle}
            description={
              isOfficer ? copy.queue.emptyOfficerDescription : copy.queue.emptyManagerDescription
            }
          />
        </div>
      )}

      {queueItems.length > 0 && (
        <ul aria-label={copy.queue.listAriaLabel} className="divide-y divide-slate-200/80">
          {queueItems.map((item) => {
            const selected = sameId(item.id, selectedRequestId);
            const waiting = copy.waitingByStatus[item.status];
            return (
              <li key={item.id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSelectRequest(item.id)}
                  className={`block w-full border-l-[3px] px-3.5 py-3 text-left transition-colors cursor-pointer outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-teal-800 ${
                    selected
                      ? 'border-l-slate-900 bg-slate-100/75'
                      : item.status === 'RESPONDED' || item.status === 'OPEN'
                        ? 'border-l-teal-700/70 bg-white hover:bg-slate-50/90'
                        : 'border-l-transparent bg-slate-50/25 hover:bg-white'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge
                        variant={statusBadgeVariant(item.status)}
                        dot
                        className="text-xs! font-medium! normal-case! tracking-normal!"
                      >
                        {copy.filters.statuses[item.status]}
                      </Badge>
                      {item.result && (
                        <Badge
                          variant={
                            item.status === 'CLOSED'
                              ? outcomeBadgeVariant(item.result.outcome)
                              : item.status === 'RESPONDED'
                                ? 'warning'
                                : 'neutral'
                          }
                          className="text-xs! font-medium! normal-case! tracking-normal!"
                        >
                          {item.status === 'CLOSED'
                            ? copy.outcomes[item.result.outcome]
                            : item.status === 'RESPONDED'
                              ? `${copy.queue.proposalPrefix}: ${copy.outcomes[item.result.outcome]}`
                              : `${copy.detail.proposalCancelledPrefix}: ${copy.outcomes[item.result.outcome]}`}
                        </Badge>
                      )}
                    </div>
                    <span className="text-xs text-slate-500 tabular-nums">
                      {formatShortTimestamp(item.createdAt)}
                    </span>
                  </div>

                  <p className="mt-1.5 text-xs font-medium text-slate-600">
                    {formatHumanSubjectSummary(item.subject, copy)}
                  </p>

                  <p className="mt-0.5 text-sm font-semibold text-slate-950 line-clamp-2 break-words leading-snug">
                    {item.reason}
                  </p>

                  <div className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-600">
                    <IconClock className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                    <span className="font-medium text-slate-700">{waiting.waitingLabel}:</span>
                    <span className="truncate">{waiting.waitingActor}</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {(hasPreviousQueuePage || hasNextQueuePage) && (
        <div className="flex items-center justify-between gap-2 border-t border-slate-200/80 bg-slate-50/50 px-3.5 py-2.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!hasPreviousQueuePage || queueFetching}
            leftIcon={<IconChevronLeft className="w-3.5 h-3.5" />}
            onClick={onPreviousPage}
          >
            {copy.queue.previousPage}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!hasNextQueuePage || queueFetching}
            rightIcon={<IconChevronRight className="w-3.5 h-3.5" />}
            onClick={onNextPage}
          >
            {copy.queue.nextPage}
          </Button>
        </div>
      )}
    </div>
  );
}
