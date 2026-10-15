/** Report dates are inclusive local work dates, not UTC timestamp boundaries. */
export interface AttendanceReportQuery {
  fromDate: string;
  toDate: string;
  timezone?: string;
  contractorId?: string;
  workerId?: string;
  shiftId?: string;
  search?: string;
  todayStatus?: AttendanceReportStatus;
}
export type AttendanceReportStatus =
  | 'PRESENT'
  | 'ABSENT'
  | 'NEEDS_REVIEW'
  | 'SCHEDULED'
  | 'NOT_ARRIVED'
  | 'OFF'
  | 'APPROVED_LEAVE'
  | 'UNAVAILABLE';
export interface AttendanceWorkersQuery extends AttendanceReportQuery {
  offset?: number;
  limit?: number;
  includeDaily?: boolean;
}
export interface AttendanceReportMetrics {
  /** Confirmed payroll totals only. Never mix provisional minutes into these. */
  regularMinutes: number;
  overtimeMinutes: number;
  totalMinutes: number;
  /** All estimated minutes on unconfirmed days; separate from confirmed totals. */
  provisionalMinutes: number;
  confirmedDays: number;
  requiredDays: number;
  presentDays: number;
  absentDays: number;
  reviewDays: number;
  /** Percentage 0..100, null if requiredDays is zero. */
  attendanceRate: number | null;
  isProvisional: boolean;
}
export interface AttendanceReportDay {
  workDate: string;
  attendanceDayId: string | null;
  status: AttendanceReportStatus;
  shifts: Array<{
    scheduleId: string;
    shiftId: string;
    name: string;
    timezone: string;
    startsAt: string | null;
    endsAt: string | null;
  }>;
  firstCheckInAt: string | null;
  lastCheckOutAt: string | null;
  regularMinutes: number;
  overtimeMinutes: number;
  totalMinutes: number;
  provisionalMinutes: number;
  hoursStatus: 'CONFIRMED' | 'PROVISIONAL' | 'NONE';
  anomalies: string[];
}
export interface AttendanceWorkerReport extends AttendanceReportMetrics {
  workerId: string;
  workerCode: string;
  workerName: string;
  contractorId: string | null;
  todayStatus: AttendanceReportStatus;
  todayFirstCheckInAt: string | null;
  todayLastCheckOutAt: string | null;
  /** Included only when includeDaily=true. Includes OFF days in the requested range. */
  daily?: AttendanceReportDay[];
}
export interface AttendanceWorkersResponse {
  siteId: string;
  fromDate: string;
  toDate: string;
  timezone: string;
  today: string;
  asOf: string;
  items: AttendanceWorkerReport[];
  total: number;
  offset: number;
  limit: number;
}
export interface AttendanceSummaryResponse extends AttendanceReportMetrics {
  siteId: string;
  fromDate: string;
  toDate: string;
  timezone: string;
  today: string;
  asOf: string;
  totalWorkers: number;
  absentTodayCount: number;
  overtimeWorkerCount: number;
  previousPeriod: { fromDate: string; toDate: string; totalMinutes: number };
  workingMinutesChangePercent: number | null;
}
