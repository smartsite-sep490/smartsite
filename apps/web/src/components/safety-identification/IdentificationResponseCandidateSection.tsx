import { SmartNativeSelect } from '../ui/SmartNativeSelect';
import type { JSX } from 'react';
import type { SafetyIdentificationOutcome } from '@smartsite/contracts/safety-identification';
import type { IdentificationCopy } from './IdentificationCopy';
import {
  DISPLAY_OUTCOMES,
  IDENTIFICATION_FIELD_CLASS,
  IDENTIFICATION_FIELD_ERROR_CLASS,
  type NamedCandidate,
} from './safetyIdentificationFormTypes';

export interface IdentificationResponseCandidateSectionProps {
  outcomeGroupName: string;
  contractorIdInput: string;
  contractorErrorId: string;
  workerIdInput: string;
  workerErrorId: string;
  outcome: SafetyIdentificationOutcome;
  contractorId: string;
  workerId: string;
  uniqueContractors: readonly NamedCandidate[];
  uniqueWorkers: readonly NamedCandidate[];
  hasSelectedContractor: boolean;
  hasSelectedWorker: boolean;
  allowsContractor: boolean;
  requiresWorker: boolean;
  isLocked: boolean;
  candidatesUnavailable: boolean;
  contractorError?: string;
  workerError?: string;
  copy: IdentificationCopy;
  onOutcomeChange: (nextOutcome: SafetyIdentificationOutcome) => void;
  onContractorSelect: (nextValue: string) => void;
  onWorkerSelect: (nextValue: string) => void;
}

export function IdentificationResponseCandidateSection({
  outcomeGroupName,
  contractorIdInput,
  contractorErrorId,
  workerIdInput,
  workerErrorId,
  outcome,
  contractorId,
  workerId,
  uniqueContractors,
  uniqueWorkers,
  hasSelectedContractor,
  hasSelectedWorker,
  allowsContractor,
  requiresWorker,
  isLocked,
  candidatesUnavailable,
  contractorError,
  workerError,
  copy,
  onOutcomeChange,
  onContractorSelect,
  onWorkerSelect,
}: IdentificationResponseCandidateSectionProps): JSX.Element {
  return (
    <>
      <fieldset disabled={isLocked} className="space-y-2">
        <legend className="text-xs font-semibold text-slate-800">
          {copy.response.outcomeLabel}
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {DISPLAY_OUTCOMES.map((item) => {
            const itemCopy = copy.response.outcomes[item];
            const active = outcome === item;
            const itemRequiresCandidates = item === 'IDENTIFIED' || item === 'PARTIAL';
            const itemDisabled = isLocked || (candidatesUnavailable && itemRequiresCandidates);
            return (
              <label
                key={item}
                className={`flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  active
                    ? 'border-[#F66B17] bg-orange-50/70 ring-1 ring-[#F66B17]/20'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                } ${itemDisabled ? 'cursor-not-allowed opacity-60' : ''}`}
              >
                <input
                  type="radio"
                  name={outcomeGroupName}
                  value={item}
                  checked={active}
                  disabled={itemDisabled}
                  onChange={() => onOutcomeChange(item)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[#071A2B]"
                />
                <span className="min-w-0">
                  <span className="block text-xs font-bold text-[#071A2B]">{itemCopy.label}</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-slate-600">
                    {itemCopy.description}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {allowsContractor && (
        <div className={requiresWorker ? 'grid gap-3 sm:grid-cols-2' : 'space-y-1.5'}>
          <div className="space-y-1.5">
            <label
              htmlFor={contractorIdInput}
              className="block text-xs font-semibold text-slate-800"
            >
              {copy.response.contractorLabel}
            </label>
            <SmartNativeSelect
              id={contractorIdInput}
              value={contractorId}
              disabled={isLocked || candidatesUnavailable}
              aria-invalid={Boolean(contractorError)}
              aria-describedby={contractorError ? contractorErrorId : undefined}
              onChange={(event) => onContractorSelect(event.target.value)}
              className={`${IDENTIFICATION_FIELD_CLASS} ${
                contractorError ? IDENTIFICATION_FIELD_ERROR_CLASS : ''
              }`}
            >
              <option value="">
                {uniqueContractors.length === 0
                  ? copy.response.contractorEmpty
                  : copy.response.contractorPlaceholder}
              </option>
              {contractorId !== '' && !hasSelectedContractor && (
                <option value={contractorId} disabled>
                  {copy.errors.contractorInvalid}
                </option>
              )}
              {uniqueContractors.map((contractor) => (
                <option key={contractor.id} value={contractor.id}>
                  {contractor.displayName}
                </option>
              ))}
            </SmartNativeSelect>
            {contractorError && (
              <p id={contractorErrorId} role="alert" className="text-xs font-medium text-rose-600">
                {contractorError}
              </p>
            )}
          </div>

          {requiresWorker && (
            <div className="space-y-1.5">
              <label htmlFor={workerIdInput} className="block text-xs font-semibold text-slate-800">
                {copy.response.workerLabel}
              </label>
              <SmartNativeSelect
                id={workerIdInput}
                value={workerId}
                disabled={isLocked || candidatesUnavailable}
                aria-invalid={Boolean(workerError)}
                aria-describedby={workerError ? workerErrorId : undefined}
                onChange={(event) => onWorkerSelect(event.target.value)}
                className={`${IDENTIFICATION_FIELD_CLASS} ${
                  workerError ? IDENTIFICATION_FIELD_ERROR_CLASS : ''
                }`}
              >
                <option value="">
                  {uniqueWorkers.length === 0
                    ? copy.response.workerEmpty
                    : copy.response.workerPlaceholder}
                </option>
                {workerId !== '' && !hasSelectedWorker && (
                  <option value={workerId} disabled>
                    {copy.errors.workerRequired}
                  </option>
                )}
                {uniqueWorkers.map((worker) => (
                  <option key={worker.id} value={worker.id}>
                    {worker.displayName}
                  </option>
                ))}
              </SmartNativeSelect>
              {workerError && (
                <p id={workerErrorId} role="alert" className="text-xs font-medium text-rose-600">
                  {workerError}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
