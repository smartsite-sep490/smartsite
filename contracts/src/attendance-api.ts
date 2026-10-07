export interface AttendanceSessionResponse {
  id: string;
  workerId: string;
  workerName: string;
  effectiveInAt: string | null;
  effectiveOutAt: string | null;
  status: string;
  version: number;
  workedMinutes: number | null;
}
export interface AttendanceOverviewResponse {
  canRequestCorrection: boolean;
  canReviewCorrection: boolean;
  sessions: AttendanceSessionResponse[];
  corrections: Array<{
    id: string;
    attendanceSessionId: string;
    workerName: string;
    proposedInAt: string;
    proposedOutAt: string;
    reason: string;
    status: string;
    reviewNote: string | null;
  }>;
}
export interface RecordAttendanceCommand {
  requestId: string;
  kind: 'CHECK_IN' | 'CHECK_OUT';
}
export interface RequestAttendanceCorrectionCommand {
  requestId: string;
  expectedSessionVersion: number;
  proposedInAt: string;
  proposedOutAt: string;
  reason: string;
}
export interface ReviewAttendanceCorrectionCommand {
  approve: boolean;
  reviewNote: string;
}
