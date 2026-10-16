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
