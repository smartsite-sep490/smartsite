import type {
  AttendanceReportDay,
  AttendanceReportMetrics,
  AttendanceWorkerReport,
} from '@smartsite/contracts';
import type {
  AttendanceDayEntity,
  AttendanceSessionEntity,
  AbsenceRequestEntity,
  WorkerEntity,
  WorkerScheduleEntity,
  ShiftEntity,
} from '../../../database/entities/index.js';
import { scheduledShiftWindow, unionIntervals } from './attendance-calculation.js';

export function reportDates(fromDate: string, toDate: string): string[] {
  const dates: string[] = [];
  for (
    let at = Date.parse(`${fromDate}T00:00:00Z`);
    at <= Date.parse(`${toDate}T00:00:00Z`);
    at += 86400000
  )
    dates.push(new Date(at).toISOString().slice(0, 10));
  return dates;
}
export function attendancePercentage(presentDays: number, requiredDays: number): number | null {
  return requiredDays ? Math.round((presentDays / requiredDays) * 10000) / 100 : null;
}
export function emptyReportMetrics(): AttendanceReportMetrics {
  return {
    regularMinutes: 0,
    overtimeMinutes: 0,
    totalMinutes: 0,
    provisionalMinutes: 0,
    confirmedDays: 0,
    requiredDays: 0,
    presentDays: 0,
    absentDays: 0,
    reviewDays: 0,
    attendanceRate: null,
    isProvisional: false,
  };
}
export interface WorkerReportInput {
  worker: Pick<WorkerEntity, 'id' | 'externalId' | 'displayName' | 'contractorId'>;
  schedules: WorkerScheduleEntity[];
  shifts: ShiftEntity[];
  days: AttendanceDayEntity[];
  sessions: AttendanceSessionEntity[];
  leaves: AbsenceRequestEntity[];
  dates: string[];
  today: string;
  now: Date;
  includeDaily: boolean;
  /** Authoritative pending overtime/correction reads; undefined cannot clear stale review. */
  pendingOtherRequestDayIds?: string[];
}

function approvedScheduleLeave(
  schedule: WorkerScheduleEntity,
  window: { startsAt: Date; endsAt: Date },
  leaves: AbsenceRequestEntity[],
) {
  return unionIntervals(
    leaves
      .filter(
        (l) =>
          l.workerScheduleId === schedule.id &&
          l.siteId === schedule.siteId &&
          l.workerId === schedule.workerId &&
          l.shiftId === schedule.shiftId &&
          l.expectedScheduleVersionId === schedule.scheduleVersionId &&
          l.status === 'APPROVED',
      )
      .map((l) => ({ start: +(l.startsAt ?? window.startsAt), end: +(l.endsAt ?? window.endsAt) })),
  );
}

export function hasApprovedFullShiftLeave(
  schedule: WorkerScheduleEntity,
  shift: ShiftEntity | undefined,
  leaves: AbsenceRequestEntity[],
) {
  if (!shift) return false;
  try {
    const window = scheduledShiftWindow(shift, schedule.workDate);
    return approvedScheduleLeave(schedule, window, leaves).some(
      (l) => l.start <= +window.startsAt && l.end >= +window.endsAt,
    );
  } catch {
    return false;
  }
}

export function workerAttendanceReport(input: WorkerReportInput): AttendanceWorkerReport {
  const { worker, schedules, shifts, days, sessions, leaves, dates, today, now } = input;
  const metrics = emptyReportMetrics();
  const calculateShiftDay = (
    workDate: string,
    scheduleId?: string | null,
  ): { report: AttendanceReportDay; required: boolean; present: boolean; review: boolean } => {
    const windows = schedules
      .filter((s) => s.workDate === workDate && (scheduleId === undefined || s.id === scheduleId))
      .map((s) => {
        const shift = shifts.find((v) => v.id === s.shiftId);
        try {
          if (!shift) return { schedule: s, shift, window: null, leave: false };
          const window = scheduledShiftWindow(shift, workDate);
          const approved = approvedScheduleLeave(s, window, leaves);
          const leave = approved.some(
            (l) => l.start <= +window.startsAt && l.end >= +window.endsAt,
          );
          return { schedule: s, shift, window, leave };
        } catch {
          return { schedule: s, shift, window: null, leave: false };
        }
      })
      .filter((w) => w.schedule.isActive || w.leave);
    const day = days.find(
      (d) => d.workDate === workDate && (scheduleId === undefined || d.scheduleId === scheduleId),
    );
    const activeSessions = sessions.filter((s) => s.dayId === day?.id && s.status !== 'IGNORED');
    // A reviewed correction may legitimately restore a missing raw IN.
    const checkIns = activeSessions.filter(
      (s) => s.effectiveInAt && (s.checkInEventId || s.status === 'CORRECTED'),
    );
    const obligations = windows.filter((w) => !w.leave);
    // Keep raw Gate times visible, but count attendance only inside an assigned shift.
    const attended = (w: (typeof obligations)[number]) =>
      !!w.window &&
      +now >= +w.window.startsAt &&
      checkIns.some(
        (s) =>
          (s.shiftAssignmentId === w.schedule.id || day?.scheduleId === w.schedule.id) &&
          +s.effectiveInAt! <= +now &&
          +s.effectiveInAt! < +w.window!.endsAt &&
          (s.effectiveOutAt === null ||
            s.effectiveOutAt === undefined ||
            +s.effectiveOutAt > +w.window!.startsAt),
      );
    const hasShiftPresence = obligations.some(attended);
    const coveredLeaveReview =
      !!day &&
      day.status === 'NEEDS_REVIEW' &&
      windows.length > 0 &&
      obligations.length === 0 &&
      activeSessions.length === 0 &&
      day.provisionalMinutes === 0 &&
      day.regularMinutes === 0 &&
      day.overtimeMinutes === 0 &&
      day.anomalies.length > 0 &&
      day.anomalies.every((a) => a === 'PENDING_LEAVE' || a === 'PENDING_REQUEST') &&
      input.pendingOtherRequestDayIds !== undefined &&
      !input.pendingOtherRequestDayIds.includes(day.id);
    const invalid = windows.some((w) => !w.window);
    const required =
      !invalid && obligations.length > 0 && obligations.every((w) => +w.window!.endsAt <= +now);
    const present = required && hasShiftPresence;
    const first = checkIns.map((s) => +s.effectiveInAt!).sort((a, b) => a - b)[0];
    const outs = activeSessions
      .filter((s) => s.effectiveOutAt && s.effectiveInAt)
      .map((s) => +s.effectiveOutAt!)
      .sort((a, b) => b - a);
    const status = invalid
      ? 'UNAVAILABLE'
      : day?.status === 'NEEDS_REVIEW' && !coveredLeaveReview
        ? 'NEEDS_REVIEW'
        : hasShiftPresence
          ? 'PRESENT'
          : !windows.length
            ? day
              ? 'NEEDS_REVIEW'
              : 'OFF'
            : !obligations.length
              ? 'APPROVED_LEAVE'
              : required
                ? day?.status === 'ABSENT'
                  ? 'ABSENT'
                  : 'NEEDS_REVIEW'
                : obligations.every((w) => +w.window!.startsAt > +now)
                  ? 'SCHEDULED'
                  : 'NOT_ARRIVED';
    const confirmed = day?.status === 'CONFIRMED' && day.confirmedMinutes !== null;
    return {
      required,
      present,
      review:
        status === 'NEEDS_REVIEW' ||
        status === 'UNAVAILABLE' ||
        (required && day?.status === 'IN_PROGRESS'),
      report: {
        workDate,
        attendanceDayId: day?.id ?? null,
        status,
        shifts: windows.map((w) => ({
          scheduleId: w.schedule.id,
          shiftId: w.schedule.shiftId,
          name: w.shift?.name ?? '',
          timezone: w.shift?.timezone ?? '',
          startsAt: w.window?.startsAt.toISOString() ?? null,
          endsAt: w.window?.endsAt.toISOString() ?? null,
        })),
        firstCheckInAt: first === undefined ? null : new Date(first).toISOString(),
        lastCheckOutAt: outs[0] === undefined ? null : new Date(outs[0]).toISOString(),
        regularMinutes: confirmed ? day.regularMinutes : 0,
        overtimeMinutes: confirmed ? day.overtimeMinutes : 0,
        totalMinutes: confirmed ? day.confirmedMinutes! : 0,
        provisionalMinutes: day && !confirmed ? day.provisionalMinutes : 0,
        hoursStatus: confirmed
          ? 'CONFIRMED'
          : day && day.status !== 'ABSENT'
            ? 'PROVISIONAL'
            : 'NONE',
        anomalies: coveredLeaveReview ? [] : (day?.anomalies ?? []),
      },
    };
  };
  const calculateDay = (workDate: string) => {
    const scheduleIds = [
      ...new Set([
        ...schedules
          .filter(
            (s) =>
              s.workDate === workDate &&
              (s.isActive ||
                hasApprovedFullShiftLeave(
                  s,
                  shifts.find((v) => v.id === s.shiftId),
                  leaves,
                )),
          )
          .map((s) => s.id),
        ...days.filter((d) => d.workDate === workDate).map((d) => d.scheduleId),
      ]),
    ];
    if (scheduleIds.length <= 1) return calculateShiftDay(workDate);
    const results = scheduleIds.map((id) => calculateShiftDay(workDate, id));
    const records = results.map((r) => r.report);
    const sum = (
      key: 'regularMinutes' | 'overtimeMinutes' | 'totalMinutes' | 'provisionalMinutes',
    ) => records.reduce((n, r) => n + r[key], 0);
    const ordered = [...records].sort((a, b) =>
      (a.shifts[0]?.startsAt ?? '').localeCompare(b.shifts[0]?.startsAt ?? ''),
    );
    const review = results.some((r) => r.review);
    const preferred =
      records.find((r) => r.status === 'UNAVAILABLE') ??
      records.find((r) => r.status === 'NEEDS_REVIEW') ??
      records.find((r) => r.status === 'PRESENT') ??
      records.find((r) => r.status === 'NOT_ARRIVED') ??
      records.find((r) => r.status === 'SCHEDULED') ??
      records[0]!;
    const checksIn = records.flatMap((r) => (r.firstCheckInAt ? [r.firstCheckInAt] : [])).sort();
    const checksOut = records.flatMap((r) => (r.lastCheckOutAt ? [r.lastCheckOutAt] : [])).sort();
    return {
      required: results.some((r) => r.required),
      present: results.some((r) => r.present),
      review,
      report: {
        ...preferred,
        shiftRecords: ordered,
        shifts: ordered.flatMap((r) => r.shifts),
        firstCheckInAt: checksIn[0] ?? null,
        lastCheckOutAt: checksOut.at(-1) ?? null,
        regularMinutes: sum('regularMinutes'),
        overtimeMinutes: sum('overtimeMinutes'),
        totalMinutes: sum('totalMinutes'),
        provisionalMinutes: sum('provisionalMinutes'),
        hoursStatus: records.some((r) => r.hoursStatus === 'PROVISIONAL')
          ? ('PROVISIONAL' as const)
          : records.some((r) => r.hoursStatus === 'CONFIRMED')
            ? ('CONFIRMED' as const)
            : ('NONE' as const),
        anomalies: [...new Set(records.flatMap((r) => r.anomalies))],
      },
    };
  };
  const daily = dates.map((date) => {
    const { report, required, present, review } = calculateDay(date);
    metrics.regularMinutes += report.regularMinutes;
    metrics.overtimeMinutes += report.overtimeMinutes;
    metrics.totalMinutes += report.totalMinutes;
    metrics.provisionalMinutes += report.provisionalMinutes;
    metrics.confirmedDays += Number(report.hoursStatus === 'CONFIRMED');
    metrics.requiredDays += Number(required);
    metrics.presentDays += Number(present);
    metrics.absentDays += Number(report.status === 'ABSENT');
    metrics.reviewDays += Number(review);
    return report;
  });
  metrics.attendanceRate = attendancePercentage(metrics.presentDays, metrics.requiredDays);
  metrics.isProvisional = metrics.reviewDays > 0;
  const todayReport = calculateDay(today).report;
  return {
    ...metrics,
    workerId: worker.id,
    workerCode: worker.externalId,
    workerName: worker.displayName,
    contractorId: worker.contractorId,
    todayStatus: todayReport.status,
    todayAnomalies: todayReport.anomalies,
    todayFirstCheckInAt: todayReport.firstCheckInAt,
    todayLastCheckOutAt: todayReport.lastCheckOutAt,
    ...(input.includeDaily ? { daily } : {}),
  };
}
