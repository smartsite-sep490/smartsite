import type { JSX } from 'react';
import type { SafetyIdentificationRequest } from '@smartsite/contracts/safety-identification';
import {
  IconAlertTriangle,
  IconCheck,
  IconClock,
  IconRefresh,
  IconShield,
  IconUser,
} from '../icons';
import { Alert, AlertDescription, AlertTitle, Badge, Button } from '../ui';
import {
  outcomeBadgeVariant,
  statusBadgeVariant,
  type IdentificationWorkspaceCopy,
} from './IdentificationWorkspaceCopy';
import {
  formatHumanSubjectSummary,
  formatIdentificationDateTime,
} from './safetyIdentificationDetailShared';

export interface SafetyIdentificationDetailOverviewProps {
  request: SafetyIdentificationRequest;
  detailLoading: boolean;
  detailError: string | null;
  onRefreshDetail: () => void;
  conflictLocked: boolean;
  isAnyPending: boolean;
  onRefreshAfterConflict: () => void;
  copy: IdentificationWorkspaceCopy;
  resolveUserText: (userId: string) => string;
  resolveWorkerLabel: (workerId: string | null) => string;
  resolveContractorLabel: (contractorId: string | null) => string;
}

function waitingCalloutAccentClass(status: SafetyIdentificationRequest['status']): string {
  switch (status) {
    case 'OPEN':
      return 'border-l-amber-500 bg-amber-50/40';
    case 'RESPONDED':
      return 'border-l-teal-700 bg-teal-50/35';
    case 'CLOSED':
      return 'border-l-emerald-600 bg-emerald-50/35';
    case 'CANCELLED':
      return 'border-l-slate-400 bg-slate-50/75';
  }
}

export function SafetyIdentificationDetailOverview({
  request,
  detailLoading,
  detailError,
  onRefreshDetail,
  conflictLocked,
  isAnyPending,
  onRefreshAfterConflict,
  copy,
  resolveUserText,
  resolveWorkerLabel,
  resolveContractorLabel,
}: SafetyIdentificationDetailOverviewProps): JSX.Element {
  const waitingGuidance = copy.waitingByStatus[request.status];
  const humanSubject = formatHumanSubjectSummary(request.subject, copy);
  const evidenceSummaryText =
    request.evidenceAvailability.status === 'UNAVAILABLE'
      ? copy.detail.evidenceUnavailableBadge
      : request.evidenceRefs.length > 0
        ? copy.detail.evidenceSummaryShared(request.evidenceRefs.length)
        : copy.detail.evidenceSummaryNoneAttached;

  const isClosed = request.status === 'CLOSED';
  const isResponded = request.status === 'RESPONDED';
  const isCancelled = request.status === 'CANCELLED';

  const stage1Status = isCancelled
    ? request.result
      ? copy.detail.lifecycleStage1CancelledWithProposal
      : copy.detail.lifecycleStage1Cancelled
    : request.result
      ? copy.detail.lifecycleStage1Submitted
      : copy.detail.lifecycleStage1Awaiting;

  const stage2Status = isClosed
    ? request.result?.outcome === 'UNRESOLVED'
      ? copy.detail.lifecycleStage2UnknownNote
      : copy.detail.lifecycleStage2Accepted
    : isCancelled
      ? copy.detail.lifecycleStage2Cancelled
      : copy.detail.lifecycleStage2Pending;

  return (
    <>
      <div className="space-y-3.5 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <Badge
              variant={statusBadgeVariant(request.status)}
              dot
              className="text-xs! font-medium! normal-case! tracking-normal!"
            >
              {copy.filters.statuses[request.status]}
            </Badge>
            <h3 className="text-base font-semibold text-slate-950 tracking-tight">
              {copy.detail.title}
            </h3>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-xs font-semibold"
            isLoading={detailLoading}
            leftIcon={<IconRefresh className="w-3.5 h-3.5" />}
            onClick={onRefreshDetail}
          >
            {copy.detail.refreshLabel}
          </Button>
        </div>

        {detailError && (
          <Alert variant="destructive">
            <IconAlertTriangle className="w-4 h-4" />
            <AlertDescription>{detailError}</AlertDescription>
          </Alert>
        )}

        {conflictLocked && (
          <Alert variant="warning">
            <IconAlertTriangle className="w-4 h-4" />
            <div>
              <AlertTitle>{copy.detail.conflictBannerTitle}</AlertTitle>
              <AlertDescription className="mt-1 flex flex-wrap items-center justify-between gap-2">
                <span>{copy.detail.conflictBannerBody}</span>
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  disabled={isAnyPending || detailLoading}
                  leftIcon={<IconRefresh className="w-3.5 h-3.5" />}
                  onClick={onRefreshAfterConflict}
                >
                  {copy.detail.conflictRefreshButton}
                </Button>
              </AlertDescription>
            </div>
          </Alert>
        )}

        <div
          data-testid="c02-subject-status-strip"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200/80 bg-slate-50/75 px-3 py-2 text-xs"
        >
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            <span className="font-medium text-slate-600">{copy.detail.subjectLabel}:</span>
            <span className="font-semibold text-slate-950">{humanSubject}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant={
                request.evidenceAvailability.status === 'UNAVAILABLE'
                  ? 'warning'
                  : request.evidenceRefs.length > 0
                    ? 'success'
                    : 'neutral'
              }
              className="text-xs! font-medium! normal-case! tracking-normal!"
            >
              {evidenceSummaryText}
            </Badge>
            <span className="rounded border border-slate-200 bg-white px-2 py-0.5 font-mono text-xs font-medium text-slate-600 tabular-nums">
              {`v${request.version}`}
            </span>
          </div>
        </div>

        <div
          className={`grid gap-3 sm:grid-cols-2 rounded-lg border border-slate-200/90 border-l-[3px] p-3 ${waitingCalloutAccentClass(request.status)}`}
        >
          <div className="space-y-0.5">
            <span className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
              <IconClock className="w-3.5 h-3.5 text-slate-500" />
              {waitingGuidance.waitingLabel}
            </span>
            <p className="text-sm font-semibold text-slate-950">{waitingGuidance.waitingActor}</p>
          </div>
          <div className="space-y-0.5">
            <span className="text-xs font-medium text-slate-600">
              {waitingGuidance.nextActionLabel}
            </span>
            <p className="text-xs text-slate-800 leading-relaxed">{waitingGuidance.nextAction}</p>
          </div>
        </div>

        <div className="space-y-1 px-0.5">
          <span className="block text-xs font-medium text-slate-600">
            {copy.detail.requestReasonLabel}
          </span>
          <p className="text-sm text-slate-950 whitespace-pre-wrap break-words leading-relaxed">
            {request.reason}
          </p>
        </div>

        {request.evidenceAvailability.status === 'UNAVAILABLE' && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200/80 bg-amber-50/60 px-3 py-2 text-xs font-medium text-amber-950">
            <IconShield className="w-4 h-4 shrink-0 text-amber-600" />
            <span>{copy.detail.evidenceUnavailableBody}</span>
          </div>
        )}

        <div
          data-testid="c02-lifecycle-separation-strip"
          aria-label={copy.detail.lifecycleStripAriaLabel}
          className="grid gap-2 sm:grid-cols-3 rounded-lg border border-slate-200/80 bg-slate-50/65 p-2.5 text-xs"
        >
          <div className="rounded-md border border-slate-200/80 bg-white px-2.5 py-2 space-y-0.5">
            <span className="block font-semibold text-slate-950">
              {copy.detail.lifecycleStage1Title}
            </span>
            <span className="block text-slate-600 leading-snug">{stage1Status}</span>
          </div>
          <div
            className={`rounded-md border px-2.5 py-2 space-y-0.5 ${
              isClosed ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200/80 bg-white'
            }`}
          >
            <span className="flex items-center gap-1 font-semibold text-slate-950">
              {isClosed && <IconCheck className="h-3.5 w-3.5 shrink-0 text-emerald-600" />}
              <span>{copy.detail.lifecycleStage2Title}</span>
            </span>
            <span className="block text-slate-700 leading-snug">{stage2Status}</span>
          </div>
          <div className="rounded-md border border-slate-200/80 bg-white px-2.5 py-2 space-y-0.5">
            <span className="block font-semibold text-slate-950">
              {copy.detail.lifecycleStage3Title}
            </span>
            <span className="block text-slate-600 leading-snug">
              {copy.detail.lifecycleStage3Body}
            </span>
          </div>
        </div>

        <details className="rounded-lg border border-slate-200/80 bg-slate-50/70 p-3 text-xs">
          <summary className="cursor-pointer font-semibold text-slate-700 select-none">
            {copy.detail.technicalDetailsLabel}
          </summary>
          <div className="mt-3 space-y-2.5 border-t border-slate-200/70 pt-3 text-slate-600">
            <dl className="grid gap-2 sm:grid-cols-2">
              <div>
                <dt className="font-semibold text-slate-500">{copy.detail.requestIdLabel}</dt>
                <dd className="font-mono break-all text-slate-800">
                  {request.id} · {copy.queue.versionPrefix(request.version)}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-500">{copy.detail.episodeLabel}</dt>
                <dd className="font-mono break-all text-slate-800">{request.episodeId}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="font-semibold text-slate-500">{copy.detail.subjectLabel}</dt>
                <dd className="font-mono break-all text-slate-800">
                  {request.subject.kind === 'TRACKED'
                    ? `${copy.detail.subjectTracked(request.subject.segmentId)} · ${copy.detail.subjectScopeHash}: ${request.subject.scopeSha256}`
                    : copy.detail.subjectEventLocal(
                        request.subject.eventId,
                        request.subject.personObservationIndex,
                      )}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-500">{copy.detail.requestedByLabel}</dt>
                <dd className="font-mono break-all text-slate-800">{request.requestedBy}</dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-500">{copy.detail.assignedToLabel}</dt>
                <dd className="font-mono break-all text-slate-800">
                  {resolveUserText(request.assignedTo)}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-500">{copy.detail.createdAtLabel}</dt>
                <dd className="text-slate-800 tabular-nums">
                  {formatIdentificationDateTime(request.createdAt)}
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-500">{copy.detail.dueAtLabel}</dt>
                <dd className="text-slate-800 tabular-nums">
                  {request.dueAt
                    ? formatIdentificationDateTime(request.dueAt)
                    : copy.detail.noDueDate}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="font-semibold text-slate-500">
                  {copy.detail.evidenceReasonCodeLabel}
                </dt>
                <dd className="font-mono text-slate-800">
                  {`${request.evidenceAvailability.status} · ${request.evidenceAvailability.reason}`}
                </dd>
              </div>
            </dl>
            <p className="text-xs text-slate-600 leading-relaxed">{copy.detail.separationBody}</p>
          </div>
        </details>
      </div>

      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <IconUser className="w-4 h-4 text-slate-500 shrink-0" />
            <h3 className="text-sm font-semibold text-slate-950">
              {isClosed
                ? copy.detail.proposalAcceptedTitle
                : isCancelled && request.result
                  ? copy.detail.proposalCancelledTitle
                  : copy.detail.proposalTitle}
            </h3>
          </div>
          {request.result && (
            <div className="flex flex-wrap items-center gap-1.5">
              {isResponded && (
                <Badge
                  variant="warning"
                  dot
                  className="text-xs! font-medium! normal-case! tracking-normal!"
                >
                  {copy.detail.proposalPendingBadge}
                </Badge>
              )}
              {isCancelled && (
                <Badge
                  variant="neutral"
                  dot
                  className="text-xs! font-medium! normal-case! tracking-normal!"
                >
                  {copy.detail.proposalCancelledBadge}
                </Badge>
              )}
              {isClosed && (
                <Badge
                  variant="success"
                  dot
                  className="text-xs! font-medium! normal-case! tracking-normal!"
                >
                  {copy.detail.proposalAcceptedBadge}
                </Badge>
              )}
              <Badge
                variant={isClosed ? outcomeBadgeVariant(request.result.outcome) : 'neutral'}
                className="text-xs! font-medium! normal-case! tracking-normal!"
              >
                {copy.outcomes[request.result.outcome]}
              </Badge>
            </div>
          )}
        </div>
        {request.result ? (
          <div className="space-y-3">
            <div className="space-y-1">
              <span className="block text-xs font-medium text-slate-600">
                {copy.detail.proposalReasonLabel}
              </span>
              <p className="text-sm text-slate-950 whitespace-pre-wrap break-words leading-relaxed">
                {request.result.reason}
              </p>
            </div>
            <dl className="grid gap-2.5 sm:grid-cols-3 rounded-lg border border-slate-200/80 bg-slate-50/60 p-3 text-xs">
              <div>
                <dt className="font-medium text-slate-600">{copy.detail.proposalWorkerLabel}</dt>
                <dd className="mt-0.5 font-semibold text-slate-950 break-words">
                  {resolveWorkerLabel(request.result.workerId)}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-slate-600">
                  {copy.detail.proposalContractorLabel}
                </dt>
                <dd className="mt-0.5 font-semibold text-slate-950 break-words">
                  {resolveContractorLabel(request.result.contractorId)}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-slate-600">
                  {copy.detail.proposalRespondedAtLabel}
                </dt>
                <dd className="mt-0.5 text-slate-800 tabular-nums">
                  {formatIdentificationDateTime(request.result.respondedAt)}
                </dd>
              </div>
            </dl>
            <details className="rounded-lg border border-slate-200/70 bg-slate-50/60 p-2.5 text-xs text-slate-600">
              <summary className="cursor-pointer font-medium text-slate-700 select-none">
                {copy.detail.technicalDetailsLabel}
              </summary>
              <div className="mt-2 space-y-1 font-mono break-all">
                <div>{`${copy.detail.proposalOutcomeLabel}: ${request.result.outcome}`}</div>
                {request.result.workerId && (
                  <div>
                    {copy.detail.proposalWorkerLabel}: {request.result.workerId}
                  </div>
                )}
                {request.result.contractorId && (
                  <div>
                    {copy.detail.proposalContractorLabel}: {request.result.contractorId}
                  </div>
                )}
                <div>
                  {copy.detail.proposalRespondedByLabel}: {request.result.respondedBy}
                </div>
              </div>
            </details>
          </div>
        ) : (
          <p className="text-xs text-slate-600">{copy.detail.proposalEmpty}</p>
        )}
      </div>
    </>
  );
}
