import { useId, useState, type FormEvent, type JSX } from 'react';
import { Alert, AlertDescription, Badge, Button, Card } from '../ui';
import { IDENTIFICATION_MAX_REASON_LENGTH } from './IdentificationCopy';
import {
  IDENTIFICATION_FIELD_CLASS,
  IDENTIFICATION_FIELD_ERROR_CLASS,
  type IdentificationCreateFormProps,
  type EvidenceApproval,
} from './safetyIdentificationFormTypes';

export function IdentificationCreateForm({
  assignee,
  pending = false,
  error = null,
  onSubmit,
  renderEvidence,
  copy,
  assigneeLoading = false,
  disabled = false,
  initialReason = '',
  onRefresh,
  onCancel,
}: IdentificationCreateFormProps): JSX.Element {
  const baseId = useId();
  const headingId = `${baseId}-create-heading`;
  const reasonId = `${baseId}-create-reason`;
  const reasonHintId = `${baseId}-create-reason-hint`;
  const reasonErrorId = `${baseId}-create-reason-error`;

  const [approval, setApproval] = useState<EvidenceApproval>();
  const [reason, setReason] = useState<string>(initialReason);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [assigneeError, setAssigneeError] = useState<string | null>(null);

  const isLocked = pending || disabled;
  const visibleAssigneeError = !assignee && !assigneeLoading ? assigneeError : null;
  const trimmedError = typeof error === 'string' && error.trim().length > 0 ? error.trim() : null;

  function handleReasonChange(nextValue: string) {
    setReason(nextValue);
    if (reasonError) {
      const trimmed = nextValue.trim();
      if (trimmed.length > 0 && trimmed.length <= IDENTIFICATION_MAX_REASON_LENGTH) {
        setReasonError(null);
      }
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isLocked || assigneeLoading) return;

    const trimmed = reason.trim();
    const nextReasonError = !trimmed
      ? copy.errors.reasonRequired
      : trimmed.length > IDENTIFICATION_MAX_REASON_LENGTH
        ? copy.errors.reasonTooLong
        : null;
    const nextAssigneeError = !assignee ? copy.errors.assigneeRequired : null;

    setReasonError(nextReasonError);
    setAssigneeError(nextAssigneeError);

    if (nextReasonError || nextAssigneeError || !assignee) {
      return;
    }

    if (approval) onSubmit(trimmed, approval);
    else onSubmit(trimmed);
  }

  const reasonDescribedBy = [reasonHintId, reasonError ? reasonErrorId : null]
    .filter(Boolean)
    .join(' ');

  return (
    <Card aria-labelledby={headingId} className="space-y-4">
      <header className="space-y-0.5 border-b border-slate-100 pb-3">
        <h3 id={headingId} className="text-sm font-bold text-[#071A2B]">
          {copy.create.title}
        </h3>
        <p className="text-xs text-slate-600">{copy.create.subtitle}</p>
      </header>

      {trimmedError && (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{trimmedError}</span>
            {onRefresh && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={onRefresh}
              >
                {copy.create.refreshLabel}
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      <form noValidate onSubmit={handleSubmit} className="space-y-4">
        {renderEvidence?.(setApproval)}
        <div className="rounded-xl border border-slate-200/90 bg-slate-50/70 px-3.5 py-3 space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-700">
              {copy.create.assigneeLabel}
            </span>
            {assigneeLoading ? (
              <span role="status" className="text-xs text-slate-600">
                {copy.create.assigneeLoading}
              </span>
            ) : assignee ? (
              <Badge variant="info" dot className="normal-case text-xs font-semibold">
                {assignee.displayName}
              </Badge>
            ) : (
              <Badge variant="warning" dot className="normal-case text-xs font-semibold">
                {copy.create.assigneeUnavailable}
              </Badge>
            )}
          </div>
          <p
            data-testid="c02-create-evidence-delivery-status"
            className={`text-xs ${
              approval ? 'font-medium text-emerald-800' : 'text-slate-500'
            }`}
          >
            {approval
              ? copy.create.evidenceApprovedNotice
              : renderEvidence
                ? copy.create.evidenceOptionalNotice
                : copy.create.evidenceNotice}
          </p>
          {visibleAssigneeError && (
            <p role="alert" className="text-xs font-medium text-rose-600">
              {visibleAssigneeError}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor={reasonId} className="block text-xs font-semibold text-slate-800">
              {copy.create.reasonLabel}
            </label>
            <span className="font-mono text-[11px] text-slate-400" aria-hidden="true">
              {reason.length}/{IDENTIFICATION_MAX_REASON_LENGTH}
            </span>
          </div>
          <textarea
            id={reasonId}
            rows={3}
            value={reason}
            disabled={isLocked}
            placeholder={copy.create.reasonPlaceholder}
            aria-invalid={Boolean(reasonError)}
            aria-describedby={reasonDescribedBy}
            onChange={(event) => handleReasonChange(event.target.value)}
            className={`${IDENTIFICATION_FIELD_CLASS} resize-y ${
              reasonError ? IDENTIFICATION_FIELD_ERROR_CLASS : ''
            }`}
          />
          <span id={reasonHintId} className="sr-only">
            {copy.create.reasonHint}
          </span>
          {reasonError && (
            <p id={reasonErrorId} role="alert" className="text-xs font-medium text-rose-600">
              {reasonError}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          {onCancel && (
            <Button type="button" variant="ghost" size="md" disabled={pending} onClick={onCancel}>
              {copy.create.cancelLabel}
            </Button>
          )}
          <Button
            type="submit"
            variant="primary"
            size="md"
            isLoading={pending}
            disabled={isLocked || assigneeLoading || !assignee}
          >
            {pending ? copy.create.submittingLabel : copy.create.submitLabel}
          </Button>
        </div>
      </form>
    </Card>
  );
}
