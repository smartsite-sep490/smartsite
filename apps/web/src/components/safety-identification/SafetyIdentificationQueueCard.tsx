import React from 'react';
import type { SafetyIdentificationRequest } from '@smartsite/contracts/safety-identification';
import {
  IconAlertTriangle,
  IconChevronLeft,
  IconChevronRight,
  IconClock,
  IconShield,
} from '../icons';
import { Alert, AlertDescription, Badge, Button, Card, EmptyState } from '../ui';
import {
  formatIdentificationError,
  outcomeBadgeVariant,
  statusBadgeVariant,
  type IdentificationWorkspaceCopy,
} from './IdentificationWorkspaceCopy';
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
    <Card className="lg:col-span-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
        <h3 className="text-sm font-bold text-[#071A2B]">{copy.queue.title}</h3>
        {featureUnavailable ? (
          <Badge variant="warning" dot>
            {copy.unavailable.badgeLabel}
          </Badge>
        ) : (
          <span className="text-xs font-semibold text-slate-500">
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
        <p role="status" className="py-6 text-center text-xs font-medium text-slate-600">
          {copy.queue.loading}
        </p>
      )}

      {featureUnavailable && (
        <div
          role="status"
          data-testid="identification-unavailable-state"
          className="space-y-3 rounded-xl border border-amber-300 bg-amber-50/90 p-4 text-xs text-amber-950"
        >
          <div className="flex items-start gap-2.5">
            <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            <div className="space-y-1">
              <p className="font-bold text-amber-950">{copy.unavailable.queueTitle}</p>
              <p className="leading-relaxed text-amber-900">{copy.unavailable.queueDescription}</p>
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="button" variant="outline" size="sm" onClick={onRetryQueue}>
              {copy.queue.retryLabel}
            </Button>
          </div>
        </div>
      )}

      {Boolean(queueError) && !featureUnavailable && (
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
      )}

      {!queueLoading && !queueError && queueItems.length === 0 && (
        <EmptyState
          icon={<IconShield className="w-5 h-5" />}
          title={copy.queue.emptyTitle}
          description={
            isOfficer ? copy.queue.emptyOfficerDescription : copy.queue.emptyManagerDescription
          }
        />
      )}

      {queueItems.length > 0 && (
        <ul aria-label={copy.queue.listAriaLabel} className="space-y-2.5">
          {queueItems.map((item) => {
            const selected = sameId(item.id, selectedRequestId);
            const waiting = copy.waitingByStatus[item.status];
            return (
              <li key={item.id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSelectRequest(item.id)}
                  className={`w-full rounded-xl border p-3.5 text-left transition-all cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[#071A2B]/30 ${
                    selected
                      ? 'border-[#F66B17] bg-orange-50/50 ring-1 ring-[#F66B17]/25 shadow-xs'
                      : 'border-slate-200/90 bg-white hover:border-slate-300 hover:bg-slate-50/60'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={statusBadgeVariant(item.status)} dot>
                        {copy.filters.statuses[item.status]}
                      </Badge>
                      {item.result && (
                        <Badge variant={outcomeBadgeVariant(item.result.outcome)}>
                          {copy.outcomes[item.result.outcome]}
                        </Badge>
                      )}
                    </div>
                    <span className="text-[11px] text-slate-500">
                      {formatShortTimestamp(item.createdAt)}
                    </span>
                  </div>

                  <p className="mt-2 text-xs font-bold text-[#071A2B] line-clamp-2 break-words">
                    {item.reason}
                  </p>

                  <div className="mt-2 rounded-lg bg-slate-100/80 px-2.5 py-1.5 text-[11px] text-slate-700 flex items-center gap-1.5">
                    <IconClock className="w-3 h-3 shrink-0 text-[#F66B17]" />
                    <span className="font-semibold">{waiting.waitingLabel}:</span>
                    <span className="truncate">{waiting.waitingActor}</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {(hasPreviousQueuePage || hasNextQueuePage) && (
        <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
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
    </Card>
  );
}
