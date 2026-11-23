import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  workerAttendanceReport,
  type WorkerReportInput,
} from '../src/modules/workforce/attendance/attendance-report-calculation.js';
import type {
  AttendanceDayEntity,
  AttendanceSessionEntity,
  WorkerScheduleEntity,
  ShiftEntity,
  AbsenceRequestEntity,
} from '../src/database/entities/index.js';

const dates = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'];
const shift = {
  id: 'shift',
  name: 'Morning',
  startsAt: new Date('2026-09-01T01:00:00Z'),
  endsAt: new Date('2026-09-01T10:00:00Z'),
  timezone: 'Asia/Ho_Chi_Minh',
} as ShiftEntity;
function input(): WorkerReportInput {
  return {
    worker: {
      id: 'worker',
      externalId: 'W000001',
      displayName: 'Synthetic Worker',
      contractorId: 'contractor',
    },
    schedules: dates.map(
      (date) =>
        ({ id: date, workDate: date, shiftId: 'shift', isActive: true }) as WorkerScheduleEntity,
    ),
    shifts: [shift],
    days: [],
    sessions: [],
    leaves: [],
    dates: [...dates],
    today: '2026-10-09',
    now: new Date('2026-10-09T18:00:00+07:00'),
    includeDaily: true,
  };
}
function day(
  date: string,
  status: AttendanceDayEntity['status'],
  minutes = 480,
): AttendanceDayEntity {
  return {
    id: date,
    siteId: 'site',
    workerId: 'worker',
    timezone: 'Asia/Ho_Chi_Minh',
    shiftName: 'Morning',
    startsAt: new Date(`${date}T08:00:00+07:00`),
    endsAt: new Date(`${date}T17:00:00+07:00`),
    breakStartsAt: null,
    breakEndsAt: null,
    reviewedBy: null,
    reviewedAt: null,
    reviewNote: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    version: 1,
    workDate: date,
    scheduleId: date,
    allowedExitMinutes: 15,
    maxExitCount: 2,
    exitCount: 0,
    deductedMinutes: 0,
    status,
    regularMinutes: minutes,
    overtimeMinutes: 0,
    confirmedMinutes: status === 'CONFIRMED' ? minutes : null,
    provisionalMinutes: minutes,
    anomalies: [],
  };
}
function session(date: string): AttendanceSessionEntity {
  return {
    dayId: date,
    shiftAssignmentId: date,
    checkInEventId: 'raw-in',
    effectiveInAt: new Date(`${date}T08:15:00+07:00`),
    effectiveOutAt: new Date(`${date}T16:45:00+07:00`),
    status: 'MATCHED',
  } as AttendanceSessionEntity;
}

test('rate counts completed required workdays once, excludes full approved leave and cancelled/off days, and counts late/early attendance', () => {
  const data = input();
  data.days = dates.map((date, i) =>
    day(date, i === 4 ? 'ABSENT' : 'CONFIRMED', i === 2 || i === 4 ? 0 : 480),
  );
  data.sessions = [session(dates[0]!), session(dates[1]!), session(dates[3]!)];
  data.leaves = [
    {
      workerScheduleId: dates[2],
      shiftId: 'shift',
      status: 'APPROVED',
      startsAt: null,
      endsAt: null,
    } as AbsenceRequestEntity,
  ];
  data.dates.push('2026-10-10', '2026-10-11');
  data.schedules.push({
    id: 'cancelled',
    workDate: '2026-10-10',
    shiftId: 'shift',
    isActive: false,
  } as WorkerScheduleEntity);
  const report = workerAttendanceReport(data);
  assert.equal(report.requiredDays, 4);
  assert.equal(report.presentDays, 3);
  assert.equal(report.attendanceRate, 75);
  assert.equal(report.absentDays, 1);
  assert.equal(report.totalMinutes, 1440);
  assert.equal(report.todayStatus, 'ABSENT');
  assert.equal(report.daily?.find((d) => d.workDate === '2026-10-07')?.status, 'APPROVED_LEAVE');
  assert.equal(report.daily?.find((d) => d.workDate === '2026-10-10')?.status, 'OFF');
});

test('unfinished and overnight shifts are excluded until their actual end; no required days yields null', () => {
  const data = input();
  data.dates = ['2026-10-09'];
  data.schedules = [data.schedules[4]!];
  data.now = new Date('2026-10-09T16:59:00+07:00');
  assert.equal(workerAttendanceReport(data).requiredDays, 0);
  assert.equal(workerAttendanceReport(data).attendanceRate, null);
  data.shifts = [
    {
      ...shift,
      startsAt: new Date('2026-09-01T15:00:00Z'),
      endsAt: new Date('2026-09-01T23:00:00Z'),
    },
  ];
  data.now = new Date('2026-10-10T05:59:00+07:00');
  assert.equal(workerAttendanceReport(data).requiredDays, 0);
  data.now = new Date('2026-10-10T06:00:00+07:00');
  const after = workerAttendanceReport(data);
  assert.equal(after.requiredDays, 1);
  assert.equal(after.todayStatus, 'NEEDS_REVIEW');
  assert.equal(after.isProvisional, true);
});

test('pending review is provisional, ignored IN never counts, and approved corrections can restore a missing IN', () => {
  const data = input();
  data.dates = [dates[4]!];
  data.schedules = [data.schedules[4]!];
  data.days = [day(dates[4]!, 'NEEDS_REVIEW', 600)];
  data.sessions = [{ ...session(dates[4]!), status: 'IGNORED' }];
  let report = workerAttendanceReport(data);
  assert.equal(report.presentDays, 0);
  assert.equal(report.attendanceRate, 0);
  assert.equal(report.isProvisional, true);
  assert.equal(report.totalMinutes, 0);
  assert.equal(report.provisionalMinutes, 600);
  data.sessions = [{ ...session(dates[4]!), checkInEventId: null, status: 'CORRECTED' }];
  report = workerAttendanceReport(data);
  assert.equal(report.presentDays, 1);
  assert.equal(report.attendanceRate, 100);
});

test('multiple shifts count as one workday and missing configuration is unavailable rather than absent', () => {
  const data = input();
  data.dates = [dates[4]!];
  data.schedules = [data.schedules[4]!, { ...data.schedules[4]!, id: 'second' }];
  data.days = [day(dates[4]!, 'NEEDS_REVIEW')];
  data.sessions = [session(dates[4]!)];
  assert.equal(workerAttendanceReport(data).requiredDays, 1);
  assert.equal(workerAttendanceReport(data).presentDays, 1);
  data.shifts = [];
  const unavailable = workerAttendanceReport(data);
  assert.equal(unavailable.requiredDays, 0);
  assert.equal(unavailable.todayStatus, 'UNAVAILABLE');
  assert.equal(unavailable.absentDays, 0);
  assert.equal(unavailable.isProvisional, true);
});

test('multiple shifts sum confirmed and provisional minutes independently without counting a date twice', () => {
  const data = input(),
    date = data.today;
  data.dates = [date];
  data.schedules = [
    data.schedules[4]!,
    { ...data.schedules[4]!, id: 'second', shiftId: 'afternoon' },
  ];
  data.shifts = [
    shift,
    {
      ...shift,
      id: 'afternoon',
      startsAt: new Date('2026-09-01T11:00:00Z'),
      endsAt: new Date('2026-09-01T12:00:00Z'),
    },
  ];
  data.days = [
    day(date, 'CONFIRMED', 60),
    {
      ...day(date, 'NEEDS_REVIEW', 30),
      id: 'second-day',
      scheduleId: 'second',
      anomalies: ['ZONE_ATTENDANCE_PENDING'],
    },
  ];
  data.sessions = [
    session(date),
    { ...session(date), dayId: 'second-day', shiftAssignmentId: 'second' },
  ];
  const result = workerAttendanceReport(data);
  assert.equal(result.totalMinutes, 60);
  assert.equal(result.provisionalMinutes, 30);
  assert.equal(result.requiredDays, 1);
  assert.equal(result.presentDays, 1);
  assert.equal(result.reviewDays, 1);
  assert.equal(result.daily?.[0]?.shiftRecords?.length, 2);
  data.days[1]!.status = 'CONFIRMED';
  data.days[1]!.confirmedMinutes = 30;
  data.days[1]!.anomalies = [];
  const confirmed = workerAttendanceReport(data);
  assert.equal(confirmed.totalMinutes, 90);
  assert.equal(confirmed.provisionalMinutes, 0);
  assert.equal(confirmed.confirmedDays, 1);
});
test('approved full-shift leave remains a leave day after its schedule is deactivated', () => {
  const data = input(),
    date = data.today;
  data.dates = [date];
  data.schedules = [{ ...data.schedules[4]!, isActive: false }];
  data.days = [day(date, 'CONFIRMED', 0)];
  data.leaves = [
    {
      workerScheduleId: date,
      shiftId: 'shift',
      status: 'APPROVED',
      startsAt: null,
      endsAt: null,
    } as AbsenceRequestEntity,
  ];
  const result = workerAttendanceReport(data);
  assert.equal(result.todayStatus, 'APPROVED_LEAVE');
  assert.equal(result.daily?.[0]?.status, 'APPROVED_LEAVE');
  assert.equal(result.totalMinutes, 0);
  assert.equal(result.requiredDays, 0);
  assert.equal(result.absentDays, 0);
  assert.equal(result.reviewDays, 0);
  for (const key of [
    'workerId',
    'siteId',
    'workerScheduleId',
    'shiftId',
    'expectedScheduleVersionId',
  ] as const) {
    const original = data.leaves[0]![key];
    data.leaves[0]![key] = 'different-scope-or-version';
    assert.notEqual(workerAttendanceReport(data).todayStatus, 'APPROVED_LEAVE');
    data.leaves[0]![key] = original;
  }
  data.leaves[0]!.status = 'PENDING_MANAGER' as AbsenceRequestEntity['status'];
  assert.notEqual(workerAttendanceReport(data).todayStatus, 'APPROVED_LEAVE');
  data.leaves[0]!.status = 'APPROVED' as AbsenceRequestEntity['status'];
  data.leaves[0]!.endsAt = new Date(`${date}T10:00:00+07:00`);
  assert.notEqual(workerAttendanceReport(data).todayStatus, 'APPROVED_LEAVE');
});

test('today status and IN/OUT never fall back to a past day when historical hours are selected', () => {
  const data = input();
  data.dates = [dates[0]!];
  data.days = [day(dates[0]!, 'NEEDS_REVIEW', 87)];
  data.sessions = [session(dates[0]!)];
  data.now = new Date(`${data.today}T07:00:00+07:00`);
  const result = workerAttendanceReport(data);
  assert.equal(result.todayStatus, 'SCHEDULED');
  assert.equal(result.todayFirstCheckInAt, null);
  assert.equal(result.todayLastCheckOutAt, null);
  assert.equal(result.provisionalMinutes, 87);
});

test('full approved leave hides only stale leave-only review after checking other pending requests', () => {
  const data = input(),
    date = data.today;
  data.dates = [date];
  data.schedules = [{ ...data.schedules[4]!, isActive: false }];
  data.leaves = [
    {
      workerScheduleId: date,
      shiftId: 'shift',
      status: 'APPROVED',
      startsAt: null,
      endsAt: null,
    } as AbsenceRequestEntity,
  ];
  data.days = [
    { ...day(date, 'NEEDS_REVIEW', 0), anomalies: ['PENDING_LEAVE', 'PENDING_REQUEST'] },
  ];
  assert.equal(workerAttendanceReport(data).todayStatus, 'NEEDS_REVIEW');
  data.pendingOtherRequestDayIds = [];
  assert.equal(workerAttendanceReport(data).todayStatus, 'APPROVED_LEAVE');
  assert.equal(workerAttendanceReport(data).reviewDays, 0);
  assert.deepEqual(workerAttendanceReport(data).daily?.[0]?.anomalies, []);
  data.pendingOtherRequestDayIds = [date];
  assert.equal(workerAttendanceReport(data).todayStatus, 'NEEDS_REVIEW');
  data.pendingOtherRequestDayIds = [];
  data.days[0]!.anomalies.push('MISSING_OUT');
  assert.equal(workerAttendanceReport(data).todayStatus, 'NEEDS_REVIEW');
  data.days[0]!.anomalies = ['PENDING_LEAVE'];
  data.sessions = [session(date)];
  assert.equal(workerAttendanceReport(data).todayStatus, 'NEEDS_REVIEW');
});
