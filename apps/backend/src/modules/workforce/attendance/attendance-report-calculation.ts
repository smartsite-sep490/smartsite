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
}
export function workerAttendanceReport(input: WorkerReportInput): AttendanceWorkerReport {
  const { worker, schedules, shifts, days, sessions, leaves, dates, today, now } = input;
  const metrics = emptyReportMetrics();
  const calculateDay = (
    workDate: string,
  ): { report: AttendanceReportDay; required: boolean; present: boolean; review: boolean } => {
    const assigned = schedules.filter((s) => s.isActive && s.workDate === workDate);
    const windows = assigned.map((s) => {
      const shift = shifts.find((v) => v.id === s.shiftId);
      try {
        if (!shift) return { schedule: s, shift, window: null, leave: false };
        const window = scheduledShiftWindow(shift, workDate);
        const approved = unionIntervals(
          leaves
            .filter((l) => l.workerScheduleId === s.id && l.status === 'APPROVED')
            .map((l) => ({
              start: +(l.startsAt ?? window.startsAt),
              end: +(l.endsAt ?? window.endsAt),
            })),
        );
        const leave = approved.some((l) => l.start <= +window.startsAt && l.end >= +window.endsAt);
        return { schedule: s, shift, window, leave };
      } catch {
        return { schedule: s, shift, window: null, leave: false };
      }
    });
    const day = days.find((d) => d.workDate === workDate);
    const activeSessions = sessions.filter((s) => s.dayId === day?.id && s.status !== 'IGNORED');
    // A reviewed correction may legitimately restore a missing raw IN.
    const checkIns = activeSessions.filter(
      (s) => s.effectiveInAt && (s.checkInEventId || s.status === 'CORRECTED'),
    );
    const hasCheckIn = checkIns.length > 0;
    const obligations = windows.filter((w) => !w.leave);
    const invalid = windows.some((w) => !w.window);
    const required =
      !invalid && obligations.length > 0 && obligations.every((w) => +w.window!.endsAt <= +now);
    const present =
      required &&
      obligations.some((w) =>
        checkIns.some(
          (s) =>
            s.shiftAssignmentId === w.schedule.id ||
            (s.dayId === day?.id && day?.scheduleId === w.schedule.id),
        ),
      );
    const first = checkIns.map((s) => +s.effectiveInAt!).sort((a, b) => a - b)[0];
    const outs = activeSessions
      .filter((s) => s.effectiveOutAt && s.effectiveInAt)
      .map((s) => +s.effectiveOutAt!)
      .sort((a, b) => b - a);
    const status = invalid
      ? 'UNAVAILABLE'
      : day?.status === 'NEEDS_REVIEW'
        ? 'NEEDS_REVIEW'
        : hasCheckIn
          ? 'PRESENT'
          : !assigned.length
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
        anomalies: day?.anomalies ?? [],
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
    todayFirstCheckInAt: todayReport.firstCheckInAt,
    todayLastCheckOutAt: todayReport.lastCheckOutAt,
    ...(input.includeDaily ? { daily } : {}),
  };
}
