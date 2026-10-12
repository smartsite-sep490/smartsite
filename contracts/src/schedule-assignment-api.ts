export interface ScheduleAssignmentInput {
  contractorId: string;
  scheduleVersionId: string;
  shiftId: string;
  target: 'TEAM' | 'WORKER';
  teamId?: string;
  workerId?: string;
  /** Optional subset of the current team, for individual exceptions/new members. */
  selectedWorkerIds?: string[];
  mode: 'DAY' | 'WEEK' | 'REPEAT';
  fromDate: string;
  toDate: string;
  /** ISO weekday: Monday=1, Sunday=7. */
  weekdays: number[];
}
export interface ScheduleAssignmentPreview {
  fingerprint: string;
  targetName: string;
  members: Array<{ workerId: string; workerName: string; membershipId: string | null }>;
  dates: string[];
  assignmentCount: number;
  conflicts: Array<{
    workerId: string;
    workerName: string;
    workDate: string;
    scheduleId: string;
    shiftName: string;
  }>;
}
export interface CreateScheduleAssignmentCommand extends ScheduleAssignmentInput {
  requestId: string;
  expectedFingerprint: string;
}
export interface ScheduleAssignmentBatchResponse {
  id: string;
  version: number;
  teamId: string | null;
  targetName: string;
  input: ScheduleAssignmentInput;
  members: ScheduleAssignmentPreview['members'];
  dates: string[];
  createdAt: string;
}
export interface ChangeScheduleAssignmentCommand {
  requestId: string;
  expectedVersion: number;
  action: 'CANCEL' | 'CHANGE_SHIFT';
  scope: 'DAY' | 'FROM_DATE' | 'UNSTARTED';
  /** Ignored for UNSTARTED: Backend selects all unstarted schedules in the batch. */
  workDate: string;
  workerId?: string;
  shiftId?: string;
  reason: string;
}
export interface ScheduleAssignmentChangeResponse {
  id: string;
  version: number;
  /** Optional for compatibility with older Backend responses. */
  changedCount?: number;
  skippedCount?: number;
}
