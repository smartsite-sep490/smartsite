import type {
  SafetyIdentificationHistoryPage,
  SafetyIdentificationRequest,
} from '@smartsite/contracts/safety-identification';
import { uiLocale } from '../../i18n';
import {
  sanitizeSafetyFrameKey,
  sanitizeSafetyQueryId,
  sanitizeSafetyUuid,
} from '../safety-episodes/safetyUrlParams';
import { IDENTIFICATION_MAX_REASON_LENGTH, type IdentificationCopy } from './IdentificationCopy';
import type { IdentificationResponseSubmission, NamedCandidate } from './SafetyIdentificationForms';
import type { IdentificationWorkspaceCopy } from './IdentificationWorkspaceCopy';

export interface WorkerCandidateOption extends NamedCandidate {
  contractorId: string | null;
}

export type DetailActionSlot = 'respond' | 'review' | 'reassign' | 'cancel';
export type DetailPendingAction = 'respond' | 'accept' | 'return' | 'reassign' | 'cancel' | null;

export interface SafetyIdentificationDetailPanelProps {
  request: SafetyIdentificationRequest;
  approvedEvidence?: import('react').ReactNode;
  originRecipientId?: string;
  originFrameKey?: string;
  detailLoading: boolean;
  detailError: string | null;
  onRefreshDetail: () => void;
  currentUserId: string;
  isOfficer: boolean;
  isManager: boolean;
  formKeyPrefix: string;
  formCopy: IdentificationCopy;
  copy: IdentificationWorkspaceCopy;
  allWorkers: readonly WorkerCandidateOption[];
  contractors: readonly NamedCandidate[];
  candidatesLoading: boolean;
  candidatesError: string | null;
  eligibleAssignee: NamedCandidate | null;
  assigneeLoading: boolean;
  pendingAction: DetailPendingAction;
  actionError: { slot: DetailActionSlot; message: string } | null;
  conflictLocked: boolean;
  onRefreshAfterConflict: () => void;
  onRespond: (submission: IdentificationResponseSubmission) => void;
  onReview: (decision: 'ACCEPT' | 'RETURN', reason: string) => void;
  onReassign: (assignedTo: string, reason: string) => void;
  onCancelRequest: (reason: string) => void;
  onCreateFollowUp?: (episodeId: string) => void;
  historyPage: SafetyIdentificationHistoryPage | undefined;
  historyLoading: boolean;
  historyError: string | null;
  historyOffset: number;
  historyPageSize: number;
  onHistoryOffsetChange: (nextOffset: number) => void;
  onRetryHistory: () => void;
}

export const DETAIL_FIELD_CLASS =
  'w-full rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-sm font-medium text-[#071A2B] placeholder:text-slate-400 outline-none transition-colors hover:border-slate-300 focus:border-[#071A2B] focus:bg-white focus:ring-2 focus:ring-[#071A2B]/10 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500';

export const DETAIL_FIELD_ERROR_CLASS =
  'border-rose-400 bg-rose-50/30 focus:border-rose-500 focus:ring-rose-500/15';

export function sameId(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) return false;
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

export function formatIdentificationDateTime(
  iso: string | null | undefined,
  fallback = '—',
): string {
  if (!iso) return fallback;
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return iso;
  return new Date(parsed).toLocaleString(uiLocale());
}

export function validateIdentificationDetailReason(
  value: string,
  copy: IdentificationWorkspaceCopy,
): string | null {
  const trimmed = value.trim();
  if (!trimmed) return copy.validation.reasonRequired;
  if (trimmed.length > IDENTIFICATION_MAX_REASON_LENGTH) return copy.validation.reasonTooLong;
  return null;
}

export function formatHumanSubjectSummary(
  subject: SafetyIdentificationRequest['subject'],
  copy: IdentificationWorkspaceCopy,
): string {
  if (subject.kind === 'TRACKED') {
    return copy.detail.subjectSummaryTracked;
  }
  return copy.detail.subjectSummaryEventLocal(subject.personObservationIndex + 1);
}

export interface IdentificationOriginLinks {
  hasValidOrigin: boolean;
  inboxReturnHref: string | null;
  incidentsWorkspaceHref: string;
}

export function buildIdentificationOriginLinks(params: {
  siteId: string;
  originRecipientId?: string;
  originFrameKey?: string;
  originCameraId?: string;
}): IdentificationOriginLinks {
  const safeSiteId = sanitizeSafetyQueryId(params.siteId);
  const validOriginRecipientId = sanitizeSafetyUuid(params.originRecipientId);
  const validOriginFrameKey = sanitizeSafetyFrameKey(params.originFrameKey);
  const validOriginCameraId = sanitizeSafetyUuid(params.originCameraId)?.toLowerCase();

  const incidentsParams = new URLSearchParams();
  if (safeSiteId) {
    incidentsParams.set('siteId', safeSiteId);
  }
  const incidentsWorkspaceHref =
    incidentsParams.size > 0 ? `/incidents?${incidentsParams}` : '/incidents';

  if (!safeSiteId || !validOriginRecipientId) {
    return {
      hasValidOrigin: false,
      inboxReturnHref: null,
      incidentsWorkspaceHref,
    };
  }

  const originParams = new URLSearchParams();
  originParams.set('tab', 'episodes');
  originParams.set('siteId', safeSiteId);
  originParams.set('recipientId', validOriginRecipientId);
  if (validOriginFrameKey) originParams.set('frameKey', validOriginFrameKey);
  if (validOriginCameraId) originParams.set('cameraId', validOriginCameraId);

  return {
    hasValidOrigin: true,
    inboxReturnHref: `/incidents?${originParams}`,
    incidentsWorkspaceHref,
  };
}
