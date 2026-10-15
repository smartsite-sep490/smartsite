export interface AttendanceSessionResponse {
  id: string;
  workerId: string;
  workerName: string;
  effectiveInAt: string | null;
  effectiveOutAt: string | null;
  status: string;
  version: number;
  workedMinutes: number | null;
  dayId?: string | null;
  rawInAt?: string | null;
  rawOutAt?: string | null;
  canIgnoreDuplicate?: boolean;
  ignoredBy?: string | null;
  ignoredAt?: string | null;
  ignoreReason?: string | null;
}
export interface IgnoreDuplicateAttendanceCommand {
  expectedSessionVersion: number;
  reason: string;
}
export type AttendanceDayStatus = 'IN_PROGRESS' | 'NEEDS_REVIEW' | 'CONFIRMED' | 'ABSENT';
export type AttendanceNotificationEvent =
  | 'EARLY_EXIT'
  | 'MISSING_CHECKOUT'
  | 'ABSENT'
  | 'UNSCHEDULED_ENTRY'
  | 'ENTRY_DENIED_NO_SCHEDULE'
  | 'TIME_REQUESTED'
  | 'TIME_APPROVED'
  | 'TIME_REJECTED';
export interface AttendanceDayResponse {
  id: string;
  workerId: string;
  workerName: string;
  workDate: string;
  timezone: string;
  scheduleId: string | null;
  shiftName: string | null;
  startsAt: string | null;
  endsAt: string | null;
  breakStartsAt?: string | null;
  breakEndsAt?: string | null;
  status: AttendanceDayStatus;
  regularMinutes: number;
  overtimeMinutes: number;
  provisionalMinutes: number;
  confirmedMinutes: number | null;
  presence: 'INSIDE' | 'OUTSIDE';
  anomalies: string[];
  version: number;
  canRequest: boolean;
}
export interface AttendanceTimeRequestCommand {
  requestId: string;
  workerScheduleId: string;
  kind: 'OVERTIME' | 'LEAVE';
  startsAt: string;
  endsAt: string;
  reason: string;
}
export interface AttendanceTimeRequestResponse {
  id: string;
  kind: 'OVERTIME' | 'LEAVE';
  workerId: string;
  workerName: string;
  scheduleId: string;
  startsAt: string;
  endsAt: string;
  reason: string;
  status: string;
  reviewNote: string | null;
}
export interface AttendanceTimeRequestsQuery {
  kind: 'OVERTIME' | 'LEAVE';
  workerId?: string;
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';
  offset?: number;
  limit?: number;
}
export interface AttendanceTimeRequestsResponse {
  items: AttendanceTimeRequestResponse[];
  total: number;
}
export interface AttendanceDaysResponse {
  items: AttendanceDayResponse[];
  total: number;
  requests: AttendanceTimeRequestResponse[];
  canReview: boolean;
  canRequest: boolean;
}
export interface AttendanceDayDetailResponse {
  day: AttendanceDayResponse;
  sessions: AttendanceSessionResponse[];
  currentSchedule?: {
    id: string;
    workDate: string;
    isActive: boolean;
    shiftName: string;
    timezone: string;
    startsAt: string | null;
    endsAt: string | null;
  } | null;
}
export interface AttendanceTimesheetResponse {
  items: Array<{
    workerId: string;
    workerName: string;
    confirmedDays: number;
    regularMinutes: number;
    overtimeMinutes: number;
    totalMinutes: number;
  }>;
}
export interface AttendanceDaysQuery {
  fromDate?: string;
  toDate?: string;
  workerId?: string;
  status?: AttendanceDayStatus;
  offset?: number;
  limit?: number;
}
export interface ReviewAttendanceDayCommand {
  expectedVersion: number;
  reviewNote: string;
}
export interface AttendanceOverviewResponse {
  /** True even when the pending request belongs to a day outside the current filter. */
  hasPendingCorrection?: boolean;
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
export interface AttendanceOverviewQuery {
  dayId?: string;
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
  /** Required for rejection; optional for approval. */
  reviewNote?: string;
}
/** Approval needs no note; rejection requires a nonempty reviewNote at the API boundary. */
export interface ReviewAttendanceTimeCommand {
  approve: boolean;
  reviewNote?: string;
}
