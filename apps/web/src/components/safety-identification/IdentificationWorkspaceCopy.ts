import type {
  SafetyIdentificationOutcome,
  SafetyIdentificationStatus,
} from '@smartsite/contracts/safety-identification';
import { ApiError } from '@smartsite/api-client';
import { userErrorMessage } from '../../i18n/messages';
import { IDENTIFICATION_WORKSPACE_COPY_EN } from './IdentificationWorkspaceCopyEn';
import type {
  HistoryKind,
  IdentificationWorkspaceCopy,
  StatusFilterValue,
  WaitingGuidanceCopy,
} from './IdentificationWorkspaceCopyTypes';
import { IDENTIFICATION_WORKSPACE_COPY_VI } from './IdentificationWorkspaceCopyVi';

export type { HistoryKind, IdentificationWorkspaceCopy, StatusFilterValue, WaitingGuidanceCopy };

export const IDENTIFICATION_WORKSPACE_COPY: Record<'vi' | 'en', IdentificationWorkspaceCopy> = {
  vi: IDENTIFICATION_WORKSPACE_COPY_VI,
  en: IDENTIFICATION_WORKSPACE_COPY_EN,
};

export function getIdentificationWorkspaceCopy(
  language?: string | null,
): IdentificationWorkspaceCopy {
  const normalized = typeof language === 'string' ? language.trim().toLowerCase() : '';
  return normalized.startsWith('vi')
    ? IDENTIFICATION_WORKSPACE_COPY.vi
    : IDENTIFICATION_WORKSPACE_COPY.en;
}

export function statusBadgeVariant(
  status: SafetyIdentificationStatus,
): 'info' | 'warning' | 'success' | 'neutral' {
  switch (status) {
    case 'OPEN':
      return 'warning';
    case 'RESPONDED':
      return 'info';
    case 'CLOSED':
      return 'success';
    case 'CANCELLED':
      return 'neutral';
  }
}

export function outcomeBadgeVariant(
  outcome: SafetyIdentificationOutcome,
): 'success' | 'info' | 'warning' | 'danger' {
  switch (outcome) {
    case 'IDENTIFIED':
      return 'success';
    case 'PARTIAL':
      return 'info';
    case 'UNRESOLVED':
      return 'warning';
    case 'DISPUTED':
      return 'danger';
  }
}

export function formatIdentificationError(
  error: unknown,
  copy: IdentificationWorkspaceCopy,
): string {
  if (error instanceof ApiError) {
    const mapped = copy.knownErrors[error.message];
    if (mapped) {
      return mapped;
    }
  }
  return userErrorMessage(error);
}
