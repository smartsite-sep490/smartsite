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
  | 'ZONE_REVIEW_REQUIRED'
  | 'ABSENCE_REVIEW_REQUIRED'
  | 'EARLY_EXIT'
  | 'MISSING_CHECKOUT'
  | 'ABSENT'
  | 'UNSCHEDULED_ENTRY'
  | 'ENTRY_DENIED_NO_SCHEDULE'
  | 'TIME_REQUESTED'
  | 'TIME_APPROVED'
  | 'TIME_REJECTED'
  | 'EXIT_DURATION_EXCEEDED'
  | 'MAX_EXITS_EXCEEDED';
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
  allowedExitMinutes?: number;
  maxExitCount?: number;
  exitCount?: number;
  deductedMinutes?: number;
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
  /** Leave only; omitted by older clients means planned leave. */
  noticeType?: 'PLANNED' | 'EMERGENCY';
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
  noticeType?: 'PLANNED' | 'EMERGENCY' | null;
  shortNotice?: boolean | null;
  createdAt?: string;
  requestedByUserId?: string;
  submittedOnBehalf?: boolean;
}
export interface AttendanceTimeRequestsQuery {
  requestId?: string;
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

export type WorkerRequestKind = 'LEAVE' | 'OVERTIME' | 'CHANGE' | 'SWAP' | 'CORRECTION';
export interface WorkerRequestsQuery {
  kind?: WorkerRequestKind;
  status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'CONFLICTED';
  requestId?: string;
  offset?: number;
  limit?: number;
}
export interface WorkerRequestResponse {
  id: string;
  kind: WorkerRequestKind;
  status: string;
  reason: string;
  createdAt: string;
  reviewNote: string | null;
  workDate: string | null;
  startsAt: string | null;
  endsAt: string | null;
  dayId: string | null;
}
export interface WorkerRequestsResponse {
  items: WorkerRequestResponse[];
  total: number;
  serverTime: string;
  /** Unfiltered, based on the latest successful self-submitted leave of any status. */
  leaveAvailableAt: string | null;
}
export interface AttendanceDaysResponse {
  items: AttendanceDayResponse[];
  total: number;
  requests: AttendanceTimeRequestResponse[];
  canReview: boolean;
  canRequest: boolean;
}
export interface AttendanceDayDetailResponse {
  zoneAttendanceReview?: {
    canConfirm: boolean;
    status: 'PENDING' | 'CONFIRMED' | 'CONFLICTED';
    evidenceHash: string;
    gateInCount: number;
    gateOutCount: number;
    sessionCount: number;
    regularMinutes: number;
    overtimeMinutes: number;
    teamAttendanceStatus: 'NOT_YET' | 'PRESENT' | 'ABSENT';
    decision?: { reviewedBy: string; reviewedByName?: string; reviewedAt: string; reason: string };
  };
  gateAbsenceReview?: {
    canConfirm: boolean;
    gateEventCount: number;
    attendanceEventCount: number;
    sessionCount: number;
    status: 'PENDING' | 'CONFIRMED_ABSENT' | 'CONFLICTED';
    teamAttendance?: { version: number; status: string; recordedBy: string; recordedAt: string };
    decision?: { reviewedBy: string; reviewedAt: string; reason: string };
  };
  /** Server-authorized acknowledgement of an otherwise resolved early checkout. */
  canAcknowledgeEarlyCheckout?: boolean;
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
/** Resolves a PRESENT roll call with no Gate or attendance evidence; never grants work hours. */
export interface ConfirmAttendanceAbsenceCommand {
  requestId: string;
  expectedVersion: number;
  expectedTeamAttendanceVersion: number;
  reason: string;
}
/** Approves calculated Gate-backed hours while preserving the missing leader roll call. */
export interface ConfirmAttendanceZoneHoursCommand {
  requestId: string;
  expectedVersion: number;
  evidenceHash: string;
  reason: string;
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
    /** Pending and reviewable by this caller, excluding their own request. */
    canReview?: boolean;
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
