/** Zone roll call is evidence supplied by a team leader, separate from gate attendance. */
export type TeamAttendanceStatus = 'NOT_YET' | 'PRESENT' | 'ABSENT';
export type TeamAttendanceGateCheck = 'MATCHED' | 'NO_GATE_ENTRY' | 'GATE_ONLY' | 'NOT_YET';
export interface ContractorTeamAttendanceQuery {
  workDate: string;
  shiftId: string;
  scheduleVersionId: string;
  offset?: number;
  limit?: number;
}
export interface ContractorTeamAttendanceResponse {
  teamId: string;
  teamName: string;
  workDate: string;
  total: number;
  present: number;
  absent: number;
  pending: number;
  matched: number;
  items: Array<{
    scheduleId: string;
    workerId: string;
    displayName: string;
    status: TeamAttendanceStatus;
    gateCheck: TeamAttendanceGateCheck;
    zoneName: string | null;
    updatedAt: string | null;
    dayId: string | null;
  }>;
}
export interface TeamAttendanceMemberResponse {
  scheduleId: string;
  membershipId: string | null;
  workerId: string;
  displayName: string;
  status: TeamAttendanceStatus;
  version: number;
  updatedAt: string | null;
  gateCheck: TeamAttendanceGateCheck;
  locked: boolean;
}
export interface ScheduleTeamAttendanceResponse {
  own: TeamAttendanceMemberResponse;
  teamId: string | null;
  teamName: string | null;
  zoneId: string | null;
  zoneName: string | null;
  canManage: boolean;
  canSubmit: boolean;
  members: TeamAttendanceMemberResponse[];
}
export interface SubmitTeamAttendanceCommand {
  requestId: string;
  teamId: string;
  zoneId: string;
  entries: {
    scheduleId: string;
    expectedMembershipId: string;
    expectedVersion: number;
    status: 'PRESENT' | 'ABSENT';
  }[];
  /** Required when correcting an existing submitted record. */
  reason?: string;
}
export interface SetTeamLeaderCommand {
  expectedVersion: number;
  workerId: string | null;
}
