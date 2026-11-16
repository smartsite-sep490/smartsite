import { useId, useMemo, useState, type FormEvent, type JSX } from 'react';
import type { SafetyIdentificationOutcome } from '@smartsite/contracts/safety-identification';
import { Alert, AlertDescription, Button, Card } from '../ui';
import { IDENTIFICATION_MAX_REASON_LENGTH } from './IdentificationCopy';
import { IdentificationResponseCandidateSection } from './IdentificationResponseCandidateSection';
import {
  deduplicateCandidates,
  IDENTIFICATION_FIELD_CLASS,
  IDENTIFICATION_FIELD_ERROR_CLASS,
  resolveInitialOutcome,
  type IdentificationResponseFormProps,
} from './safetyIdentificationFormTypes';

export function IdentificationResponseForm({
  pending = false,
  error = null,
  workers,
  contractors,
  onSubmit,
  copy,
  candidatesLoading = false,
  candidatesError = null,
  onContractorChange,
  initialValue,
  disabled = false,
  onRefresh,
}: IdentificationResponseFormProps): JSX.Element {
  const baseId = useId();
  const headingId = `${baseId}-response-heading`;
  const outcomeGroupName = `${baseId}-response-outcome`;
  const contractorIdInput = `${baseId}-response-contractor`;
  const contractorErrorId = `${baseId}-response-contractor-error`;
  const workerIdInput = `${baseId}-response-worker`;
  const workerErrorId = `${baseId}-response-worker-error`;
  const reasonId = `${baseId}-response-reason`;
  const reasonHintId = `${baseId}-response-reason-hint`;
  const reasonErrorId = `${baseId}-response-reason-error`;

  const [outcome, setOutcome] = useState<SafetyIdentificationOutcome>(() =>
    resolveInitialOutcome(initialValue?.outcome),
  );
  const [contractorId, setContractorId] = useState<string>(() => initialValue?.contractorId ?? '');
  const [workerId, setWorkerId] = useState<string>(() => initialValue?.workerId ?? '');
  const [reason, setReason] = useState<string>(() => initialValue?.reason ?? '');
  const [fieldErrors, setFieldErrors] = useState<{
    contractor?: string;
    worker?: string;
    reason?: string;
  }>({});

  const uniqueContractors = useMemo(() => deduplicateCandidates(contractors), [contractors]);
  const uniqueWorkers = useMemo(() => deduplicateCandidates(workers), [workers]);

  const trimmedError = typeof error === 'string' && error.trim().length > 0 ? error.trim() : null;
  const trimmedCandidatesError =
    typeof candidatesError === 'string' && candidatesError.trim().length > 0
      ? candidatesError.trim()
      : null;

  const isLocked = pending || disabled;
  const candidatesUnavailable = Boolean(candidatesLoading || trimmedCandidatesError);
  const allowsContractor = outcome === 'IDENTIFIED' || outcome === 'PARTIAL';
  const requiresWorker = outcome === 'IDENTIFIED';
  const candidateOutcomeBlocked = candidatesUnavailable && allowsContractor;

  const hasSelectedContractor =
    contractorId !== '' && uniqueContractors.some((item) => item.id === contractorId);
  const hasSelectedWorker = workerId !== '' && uniqueWorkers.some((item) => item.id === workerId);

  function handleOutcomeChange(nextOutcome: SafetyIdentificationOutcome) {
    const nextRequiresCandidates = nextOutcome === 'IDENTIFIED' || nextOutcome === 'PARTIAL';
    if (isLocked || (candidatesUnavailable && nextRequiresCandidates)) return;
    setOutcome(nextOutcome);
    setFieldErrors((prev) => ({
      ...prev,
      contractor: nextRequiresCandidates ? prev.contractor : undefined,
      worker: nextOutcome === 'IDENTIFIED' ? prev.worker : undefined,
    }));
    onContractorChange?.(nextRequiresCandidates ? contractorId || null : null);
  }

  function handleContractorSelect(nextValue: string) {
    if (isLocked || candidatesUnavailable) return;
    setContractorId(nextValue);
    setFieldErrors((prev) => ({ ...prev, contractor: undefined }));
    onContractorChange?.(nextValue ? nextValue : null);
  }

  function handleWorkerSelect(nextValue: string) {
    if (isLocked || candidatesUnavailable) return;
    setWorkerId(nextValue);
    if (nextValue) {
      setFieldErrors((prev) => ({ ...prev, worker: undefined }));
    }
  }

  function handleReasonChange(nextValue: string) {
    setReason(nextValue);
    if (fieldErrors.reason) {
      const trimmed = nextValue.trim();
      if (trimmed.length > 0 && trimmed.length <= IDENTIFICATION_MAX_REASON_LENGTH) {
        setFieldErrors((prev) => ({ ...prev, reason: undefined }));
      }
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isLocked || candidateOutcomeBlocked) return;

    const nextErrors: { contractor?: string; worker?: string; reason?: string } = {};
    const trimmedReason = reason.trim();

    if (!trimmedReason) {
      nextErrors.reason = copy.errors.reasonRequired;
    } else if (trimmedReason.length > IDENTIFICATION_MAX_REASON_LENGTH) {
      nextErrors.reason = copy.errors.reasonTooLong;
    }

    if (allowsContractor && contractorId !== '' && !hasSelectedContractor) {
      nextErrors.contractor = copy.errors.contractorInvalid;
    }

    if (requiresWorker && (!workerId || !hasSelectedWorker)) {
      nextErrors.worker = copy.errors.workerRequired;
    }

    setFieldErrors(nextErrors);
    if (nextErrors.contractor || nextErrors.worker || nextErrors.reason) {
      return;
    }

    onSubmit({
      outcome,
      workerId: requiresWorker ? workerId : null,
      contractorId: allowsContractor && contractorId !== '' ? contractorId : null,
      reason: trimmedReason,
    });
  }

  const reasonDescribedBy = [reasonHintId, fieldErrors.reason ? reasonErrorId : null]
    .filter(Boolean)
    .join(' ');

  return (
    <Card aria-labelledby={headingId} className="space-y-4">
      <header className="space-y-0.5 border-b border-slate-100 pb-3">
        <h3 id={headingId} className="text-sm font-bold text-[#071A2B]">
          {copy.response.title}
        </h3>
        <p className="text-xs text-slate-600">{copy.response.subtitle}</p>
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
                {copy.response.refreshLabel}
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {trimmedCandidatesError && (
        <Alert variant="warning">
          <AlertDescription>{trimmedCandidatesError}</AlertDescription>
        </Alert>
      )}

      {candidatesLoading && (
        <p role="status" className="text-xs text-slate-600">
          {copy.response.candidatesLoading}
        </p>
      )}

      <form noValidate onSubmit={handleSubmit} className="space-y-4">
        <IdentificationResponseCandidateSection
          outcomeGroupName={outcomeGroupName}
          contractorIdInput={contractorIdInput}
          contractorErrorId={contractorErrorId}
          workerIdInput={workerIdInput}
          workerErrorId={workerErrorId}
          outcome={outcome}
          contractorId={contractorId}
          workerId={workerId}
          uniqueContractors={uniqueContractors}
          uniqueWorkers={uniqueWorkers}
          hasSelectedContractor={hasSelectedContractor}
          hasSelectedWorker={hasSelectedWorker}
          allowsContractor={allowsContractor}
          requiresWorker={requiresWorker}
          isLocked={isLocked}
          candidatesUnavailable={candidatesUnavailable}
          contractorError={fieldErrors.contractor}
          workerError={fieldErrors.worker}
          copy={copy}
          onOutcomeChange={handleOutcomeChange}
          onContractorSelect={handleContractorSelect}
          onWorkerSelect={handleWorkerSelect}
        />

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor={reasonId} className="block text-xs font-semibold text-slate-800">
              {copy.response.reasonLabel}
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
            placeholder={copy.response.reasonPlaceholder}
            aria-invalid={Boolean(fieldErrors.reason)}
            aria-describedby={reasonDescribedBy}
            onChange={(event) => handleReasonChange(event.target.value)}
            className={`${IDENTIFICATION_FIELD_CLASS} resize-y ${
              fieldErrors.reason ? IDENTIFICATION_FIELD_ERROR_CLASS : ''
            }`}
          />
          <span id={reasonHintId} className="sr-only">
            {copy.response.reasonHint}
          </span>
          {fieldErrors.reason && (
            <p id={reasonErrorId} role="alert" className="text-xs font-medium text-rose-600">
              {fieldErrors.reason}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="submit"
            variant="primary"
            size="md"
            isLoading={pending}
            disabled={isLocked || candidateOutcomeBlocked}
          >
            {pending ? copy.response.submittingLabel : copy.response.submitLabel}
          </Button>
        </div>
      </form>
    </Card>
  );
}
