import type { Page } from './management-api.js';
import type { SafetyEpisodeInboxSummary } from './safety-episode-api.js';

export const SAFETY_IDENTIFICATION_OUTCOMES = [
  'IDENTIFIED',
  'PARTIAL',
  'UNRESOLVED',
  'DISPUTED',
] as const;

export type SafetyIdentificationOutcome = (typeof SAFETY_IDENTIFICATION_OUTCOMES)[number];
export const SAFETY_IDENTIFICATION_STATUSES = ['OPEN', 'RESPONDED', 'CLOSED', 'CANCELLED'] as const;
export type SafetyIdentificationStatus = (typeof SAFETY_IDENTIFICATION_STATUSES)[number];

export interface SafetyIdentificationEvidencePreview {
  episodeId: string;
  alertId: string;
  eventId: string;
  personObservationIndex: number;
  evidenceIndex: number;
  masks: { left: number; top: number; right: number; bottom: number }[];
}

export interface CreateSafetyIdentificationRequest {
  commandId: string;
  episodeId: string;
  assignedTo: string;
  reason: string;
  dueAt?: string | null;
  evidenceApproval?: {
    preview: SafetyIdentificationEvidencePreview;
    frameSha256: string;
    sha256: string;
  };
  evidenceRefs: string[];
}

export interface SafetyIdentificationVersionCommand {
  commandId: string;
  expectedVersion: number;
  reason: string;
}

export interface RespondSafetyIdentificationRequest extends SafetyIdentificationVersionCommand {
  outcome: SafetyIdentificationOutcome;
  workerId: string | null;
  contractorId: string | null;
  evidenceRefs: string[];
}

export interface ReviewSafetyIdentificationRequest extends SafetyIdentificationVersionCommand {
  decision: 'ACCEPT' | 'RETURN';
}

export interface ReassignSafetyIdentificationRequest extends SafetyIdentificationVersionCommand {
  assignedTo: string;
}

export interface SafetyIdentificationResult {
  outcome: SafetyIdentificationOutcome;
  workerId: string | null;
  contractorId: string | null;
  reason: string;
  evidenceRefs: string[];
  respondedBy: string;
  respondedAt: string;
}

export interface SafetyIdentificationRequest {
  id: string;
  siteId: string;
  episodeId: string;
  subject: SafetyEpisodeInboxSummary['subject'];
  assignedTo: string;
  requestedBy: string;
  reason: string;
  status: SafetyIdentificationStatus;
  version: number;
  dueAt: string | null;
  evidenceRefs: string[];
  evidenceAvailability:
    | { status: 'UNAVAILABLE'; reason: 'SUBJECT_DERIVATIVE_UNAVAILABLE' }
    | { status: 'AVAILABLE'; reason: null };
  result: SafetyIdentificationResult | null;
  createdAt: string;
  updatedAt: string;
}

export type SafetyIdentificationRequestPage = Page<SafetyIdentificationRequest>;
export interface SafetyIdentificationMutation {
  request: SafetyIdentificationRequest;
  replayed: boolean;
}

export interface SafetyIdentificationHistoryEntry {
  version: number;
  kind: 'CREATE' | 'RESPOND' | 'ACCEPT' | 'RETURN' | 'REASSIGN' | 'CANCEL';
  actorId: string;
  reason: string;
  assignedTo: string;
  proposal: SafetyIdentificationResult | null;
  recordedAt: string;
}

export type SafetyIdentificationHistoryPage = Page<SafetyIdentificationHistoryEntry>;

export interface SafetyIdentificationAssignee {
  id: string;
  displayName: string;
}
