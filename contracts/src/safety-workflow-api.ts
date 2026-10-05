/** MF08 business commands. IDs/actors are scoped and validated by the Backend. */
export type IncidentStatus =
  'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'VERIFIED' | 'CLOSED' | 'REOPENED';
export type IncidentSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type CorrectiveActionStatus =
  'ASSIGNED' | 'IN_PROGRESS' | 'SUBMITTED' | 'VERIFIED' | 'CLOSED';
export type SubmissionStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type SafetyTaskStatus = 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'VERIFIED' | 'CANCELLED';
export type SafetyTaskKind =
  'ZONE_INSPECTION' | 'ALERT_VERIFICATION' | 'SAFETY_FOLLOW_UP' | 'SAFETY_PATROL';
export interface VersionCommand {
  commandId: string;
  expectedVersion: number;
}
export interface ActionInput {
  assignedTo: string;
  description: string;
  dueAt?: string | null;
}
export interface CreateIncidentCommand {
  commandId: string;
  title: string;
  description: string;
  severity: IncidentSeverity;
  occurredAt: string;
  zoneId?: string | null;
  alertIds: string[];
}
export interface LinkIncidentAlertsCommand extends VersionCommand {
  alertIds: string[];
}
export interface AssignCorrectiveActionCommand extends VersionCommand, ActionInput {}
export interface SubmitSafetyResultCommand extends VersionCommand {
  resultDescription: string;
}
export interface ReviewSubmissionCommand extends VersionCommand {
  submissionId: string;
  decision: 'APPROVED' | 'REJECTED';
  reason: string;
}
export interface ReasonCommand extends VersionCommand {
  reason: string;
}
export interface ReopenIncidentCommand extends ReasonCommand, ActionInput {}
export interface CreateSafetyTaskCommand extends ActionInput {
  commandId: string;
  kind: SafetyTaskKind;
  zoneId?: string | null;
  sourceAlertId?: string | null;
  sourceIncidentId?: string | null;
}
export interface SafetyAssigneeResponse {
  id: string;
  displayName: string;
}
export interface SafetyAuditResponse {
  id: string;
  actorId: string;
  action: string;
  resourceType: 'INCIDENT' | 'SAFETY_TASK';
  resourceId: string;
  reason: string | null;
  changes: Record<string, unknown>;
  occurredAt: string;
}
export interface SafetyEvidenceResponse {
  id: string;
  mediaType: 'image/jpeg';
  size: number;
}
export interface CorrectiveActionSubmissionResponse {
  id: string;
  correctiveActionId: string;
  submittedBy: string;
  resultDescription: string;
  submittedAt: string;
  status: SubmissionStatus;
  evidence: SafetyEvidenceResponse | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
}
export interface CorrectiveActionResponse {
  id: string;
  incidentId: string;
  assignedTo: string;
  assignedBy: string;
  description: string;
  dueAt: string | null;
  status: CorrectiveActionStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  submissions: CorrectiveActionSubmissionResponse[];
}
export interface IncidentResponse {
  id: string;
  siteId: string;
  zoneId: string | null;
  title: string;
  description: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  occurredAt: string;
  reportedBy: string;
  closedBy: string | null;
  closedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface IncidentDetailResponse extends IncidentResponse {
  alerts: import('./management-api.js').SafetyAlertResponse[];
  actions: CorrectiveActionResponse[];
  audit: SafetyAuditResponse[];
}
export interface SafetyTaskResponse {
  id: string;
  siteId: string;
  zoneId: string | null;
  kind: SafetyTaskKind;
  sourceAlertId: string | null;
  sourceIncidentId: string | null;
  assignedTo: string;
  assignedBy: string;
  description: string;
  dueAt: string | null;
  status: SafetyTaskStatus;
  resultSummary: string | null;
  resultEvidence: SafetyEvidenceResponse | null;
  completedAt: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export interface SafetyTaskDetailResponse extends SafetyTaskResponse {
  audit: SafetyAuditResponse[];
}
export interface WorkflowMutationResponse<T> {
  resource: T;
  replayed: boolean;
}
