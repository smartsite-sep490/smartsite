import type { CreateSafetyIdentificationRequest } from '@smartsite/contracts/safety-identification';
import type { ReactNode } from 'react';
import {
  SAFETY_IDENTIFICATION_OUTCOMES,
  type SafetyIdentificationOutcome,
} from '@smartsite/contracts/safety-identification';
import type { IdentificationCopy } from './IdentificationCopy';

export interface NamedCandidate {
  id: string;
  displayName: string;
}

export interface IdentificationResponseSubmission {
  outcome: SafetyIdentificationOutcome;
  workerId: string | null;
  contractorId: string | null;
  reason: string;
}

export interface IdentificationCreateFormProps {
  /** Current eligible Site Manager from getSafetyIdentificationAssignee, or null when none is eligible. */
  assignee: NamedCandidate | null;
  /** True while parent mutation is in flight. Draft reason is preserved. */
  pending?: boolean;
  /** Parent command/query error message (e.g., 409 conflict or network failure). Draft is preserved. */
  error?: string | null;
  /** Invoked with trimmed non-empty reason (1..2000 chars) only when assignee !== null. */
  onSubmit: (reason: string, approval?: EvidenceApproval) => void;
  renderEvidence?: (onApprove: (approval?: EvidenceApproval) => void) => ReactNode;
  /** Localized VI/EN copy object. */
  copy: IdentificationCopy;
  /** Optional loading state while getSafetyIdentificationAssignee is fetching. */
  assigneeLoading?: boolean;
  /** Optional extra disable guard from parent (e.g., active request already exists). */
  disabled?: boolean;
  /** Optional initial draft reason on mount. */
  initialReason?: string;
  /** Optional refresh callback rendered in the error banner (e.g., after 409) without clearing draft. */
  onRefresh?: () => void;
  /** Optional dismiss/cancel callback for collapsible create panel. */
  onCancel?: () => void;
}

export interface IdentificationResponseFormProps {
  /** True while respond command is in flight. Draft fields are preserved. */
  pending?: boolean;
  /** Parent command/query error message (e.g., 400 Worker/Contractor mismatch or 409 stale version). Draft is preserved. */
  error?: string | null;
  /** Available active Site worker candidates (full Site list or parent-scoped list). */
  workers: readonly NamedCandidate[];
  /** Available participating Site contractor candidates. */
  contractors: readonly NamedCandidate[];
  /** Invoked with canonical outcome, normalized nullable IDs, and trimmed reason (1..2000 chars). */
  onSubmit: (submission: IdentificationResponseSubmission) => void;
  /** Localized VI/EN copy object. */
  copy: IdentificationCopy;
  /** Optional loading state while workers/contractors queries are fetching. */
  candidatesLoading?: boolean;
  /** Optional warning/error when candidate lookups fail; UNRESOLVED and DISPUTED remain submittable. */
  candidatesError?: string | null;
  /** Optional callback fired when contractor selection changes so parent can pass a contractor-scoped `workers` list if desired. */
  onContractorChange?: (contractorId: string | null) => void;
  /** Optional initial values when mounting a fresh key. */
  initialValue?: Partial<IdentificationResponseSubmission>;
  /** Optional extra disable guard from parent (e.g., when request.status !== 'OPEN'). */
  disabled?: boolean;
  /** Optional refresh callback rendered in the error banner (e.g., on 409 stale expectedVersion) while keeping draft intact. */
  onRefresh?: () => void;
}

export const DISPLAY_OUTCOMES: readonly SafetyIdentificationOutcome[] = [
  'UNRESOLVED',
  'PARTIAL',
  'IDENTIFIED',
  'DISPUTED',
];

export const IDENTIFICATION_FIELD_CLASS =
  'w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-sm font-medium text-[#071A2B] placeholder:text-slate-400 outline-none transition-colors hover:border-slate-300 focus:border-[#071A2B] focus:bg-white focus:ring-2 focus:ring-[#071A2B]/10 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500';

export const IDENTIFICATION_FIELD_ERROR_CLASS =
  'border-rose-400 bg-rose-50/30 focus:border-rose-500 focus:ring-rose-500/15';

export function deduplicateCandidates(items: readonly NamedCandidate[]): NamedCandidate[] {
  const map = new Map<string, NamedCandidate>();
  for (const item of items) {
    if (item.id && !map.has(item.id)) {
      map.set(item.id, { id: item.id, displayName: item.displayName });
    }
  }
  return [...map.values()];
}

export function resolveInitialOutcome(
  value: SafetyIdentificationOutcome | undefined,
): SafetyIdentificationOutcome {
  return value && (SAFETY_IDENTIFICATION_OUTCOMES as readonly string[]).includes(value)
    ? value
    : 'UNRESOLVED';
}

export type EvidenceApproval = NonNullable<CreateSafetyIdentificationRequest['evidenceApproval']>;
