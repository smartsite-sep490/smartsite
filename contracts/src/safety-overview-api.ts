import type { Page } from './management-api.js';
export interface SafetyOverviewQuery {
  date: string;
  timezone: string;
  contractorId?: string;
  teamId?: string;
  unassignedOffset?: number;
  unassignedLimit?: number;
  offset?: number;
  limit?: number;
}
export interface SafetyOverviewWorker {
  id: string;
  displayName: string;
  externalId: string;
  contractorId: string | null;
  teamId: string | null;
  startsAt: string | null;
  endsAt: string | null;
  shiftName: string | null;
  isActive: boolean;
}
export interface SafetyChecklistSummary {
  pastStartWithoutReport?: number;
  lateFirstReports?: number;
  reviewPendingPastStart?: number;
  findingsWithoutIncident?: number;
  openIncidentFindings?: number;
  closedIncidentFindings?: number;
  total: number;
  noChecklistAssigned: boolean;
  notSubmitted: number;
  needsUpdate: number;
  awaitingReview: number;
  recordedWithFindings: number;
  recordedWithoutFailures: number;
  pastPlannedStart: number;
}
export interface SafetyWorkWindow {
  startsAt: string;
  endsAt: string;
  shiftName: string;
}
export interface SafetyOverviewTeam {
  workWindows?: SafetyWorkWindow[];
  attentionAlertCount?: number;
  checklistSummary?: SafetyChecklistSummary;
  id: string;
  name: string;
  description: string;
  contractorId: string;
  contractorName: string;
  isActive: boolean;
  workerCount: number;
  scheduledWorkerCount: number;
}
export interface SafetyOverviewZone {
  attentionAlertCount?: number;
  id: string;
  name: string;
  code: string;
  validFrom: string;
  validUntil: string;
}
export interface SafetyCameraEvidenceReference {
  alertId: string;
  eventId: string;
  capturedAt: string;
  evidenceIndex: number | null;
}
export interface SafetyOverviewCamera {
  latestEvidence?: SafetyCameraEvidenceReference | null;
  attentionAlertCount?: number;
  id: string;
  name: string;
  code: string;
  externalId: string;
  zoneId: string;
  status: 'ACTIVE' | 'INACTIVE';
}
export interface SafetyOverviewResponse {
  updatedAt?: string;
  site: { id: string; code: string; name: string };
  date: string;
  timezone: string;
  teams: Page<SafetyOverviewTeam>;
  unassignedWorkers: Page<SafetyOverviewWorker>;
}
export interface SafetyTeamDetailResponse extends SafetyOverviewTeam {
  date: string;
  timezone: string;
  workers: Page<SafetyOverviewWorker>;
  zones: SafetyOverviewZone[];
  cameras: SafetyOverviewCamera[];
}
export interface SafetyAlertWorkContextResponse {
  capturedAt: string;
  identity: 'VERIFIED' | 'UNKNOWN';
  workers: {
    id: string;
    displayName: string;
    contractorId: string | null;
    contractorName: string | null;
    teamId: string | null;
    teamName: string | null;
  }[];
  zoneName: string | null;
  cameraName: string | null;
  relatedTeams: SafetyOverviewTeam[];
  warning: string;
}

export interface SafetyWeekTeam extends Pick<
  SafetyOverviewTeam,
  'id' | 'name' | 'description' | 'contractorId' | 'contractorName' | 'isActive'
> {
  days: { date: string; scheduledWorkerCount: number; workWindows: SafetyWorkWindow[] }[];
}
export interface SafetyWeekResponse {
  site: SafetyOverviewResponse['site'];
  weekStart: string;
  weekEnd: string;
  timezone: string;
  updatedAt: string;
  teams: Page<SafetyWeekTeam>;
}

export type SafetyTeamOption = Pick<
  SafetyOverviewTeam,
  'id' | 'name' | 'description' | 'contractorId' | 'contractorName' | 'isActive'
>;
