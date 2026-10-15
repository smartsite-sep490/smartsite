import type { SafetyAuditResponse, VersionCommand } from './safety-workflow-api.js';
export type ChecklistStatus = 'ASSIGNED' | 'IN_PROGRESS' | 'SUBMITTED' | 'ACCEPTED' | 'CANCELLED';
export type ChecklistAnswer = 'PASS' | 'FAIL' | 'NOT_APPLICABLE';
export type ChecklistSubmissionStatus = 'PENDING' | 'ACCEPTED' | 'RETURNED';
export type ChecklistNotificationEvent =
  'CHECKLIST_ASSIGNED' | 'CHECKLIST_SUBMITTED' | 'CHECKLIST_RETURNED' | 'CHECKLIST_RECORDED';
export interface ChecklistItemInput {
  text: string;
  evidenceRequired: boolean;
}
export interface CreateChecklistCommand {
  commandId: string;
  teamId: string;
  zoneId: string;
  assignedTo: string;
  description: string;
  startsAt: string;
  endsAt: string;
  items: ChecklistItemInput[];
}
export interface ChecklistResultInput {
  itemId: string;
  answer: ChecklistAnswer;
  note: string;
  fileIndexes: number[];
}
export interface SubmitChecklistCommand extends VersionCommand {
  results: ChecklistResultInput[];
}
export interface ReviewChecklistCommand extends VersionCommand {
  submissionId: string;
  decision: 'ACCEPTED' | 'RETURNED';
  reason: string;
}
export interface ChecklistEvidenceResponse {
  id: string;
  mediaType: 'image/jpeg' | 'image/png' | 'application/pdf';
  size: number;
}
export interface ChecklistItemResponse extends ChecklistItemInput {
  id: string;
  position: number;
}
export interface ChecklistResultResponse {
  linkedIncident?: {
    id: string;
    title: string;
    status: import('./safety-workflow-api.js').IncidentStatus;
  } | null;
  id: string;
  itemId: string;
  answer: ChecklistAnswer;
  note: string;
  evidence: ChecklistEvidenceResponse[];
  incidentId: string | null;
}
export interface ChecklistSubmissionResponse {
  id: string;
  submittedBy: string;
  submittedByName: string | null;
  submittedAt: string;
  status: ChecklistSubmissionStatus;
  reviewedBy: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  results: ChecklistResultResponse[];
}
export interface ChecklistResponse {
  firstSubmittedAt?: string | null;
  id: string;
  siteId: string;
  contractorId: string;
  contractorName: string | null;
  teamId: string;
  teamName: string | null;
  zoneId: string;
  zoneName: string | null;
  description: string;
  startsAt: string;
  endsAt: string;
  assignedTo: string;
  assignedToName: string | null;
  assignedBy: string;
  assignedByName: string | null;
  status: ChecklistStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface ChecklistDetailResponse extends ChecklistResponse {
  items: ChecklistItemResponse[];
  submissions: ChecklistSubmissionResponse[];
  audit: SafetyAuditResponse[];
}

export interface ChecklistListQuery {
  offset?: number;
  limit?: number;
  status?: string;
  assignedTo?: string;
  teamId?: string;
  fromDate?: string;
  toDate?: string;
  timezone?: string;
}
