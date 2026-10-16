import './support/config.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  workedMilliseconds,
  workDateAt,
  scheduledShiftWindow,
  intervalNetMilliseconds,
  calculateShiftAttendanceSubtraction,
} from '../src/modules/workforce/attendance/attendance-calculation.js';
const minute = 60000;
const interval = (start: number, end: number) => ({ start: start * minute, end: end * minute });
test('MF03 deducts only lunch overlapping actual presence and never deducts leave twice', () => {
  const shift = [interval(480, 1020)],
    lunch = interval(720, 780);
  for (const [presence, expected] of [
    [[interval(480, 1020)], 480],
    [[interval(480, 660), interval(690, 840), interval(840, 1020)], 450],
    [[interval(480, 720), interval(780, 1020)], 480],
    [[interval(480, 750), interval(780, 1020)], 480],
    [[interval(480, 660)], 180],
    [[interval(735, 765)], 0],
    [[interval(480, 1020), interval(690, 840)], 480],
  ] as const)
    assert.equal(workedMilliseconds([...presence], shift, [lunch]) / minute, expected);
  assert.equal(
    workedMilliseconds([interval(480, 1020)], shift, [lunch, interval(750, 810)]) / minute,
    450,
  );
});
test('MF03 maps overnight breaks to the assigned work date', () => {
  const window = scheduledShiftWindow(
    {
      startsAt: new Date('2026-10-01T22:00:00+07:00'),
      endsAt: new Date('2026-10-02T06:00:00+07:00'),
      breakStartsAt: new Date('2026-10-02T00:30:00+07:00'),
      breakEndsAt: new Date('2026-10-02T01:00:00+07:00'),
      timezone: 'Asia/Ho_Chi_Minh',
    },
    '2026-10-08',
  );
  assert.equal(window.breakStartsAt?.toISOString(), '2026-10-08T17:30:00.000Z');
  assert.equal(window.breakEndsAt?.toISOString(), '2026-10-08T18:00:00.000Z');
});
test('MF03 adds actual presence, excludes temporary exits and clips to shift', () => {
  assert.equal(
    workedMilliseconds(
      [interval(8 * 60, 11 * 60), interval(13 * 60, 17 * 60)],
      [interval(8 * 60, 17 * 60)],
    ) / minute,
    420,
  );
  assert.equal(
    workedMilliseconds([interval(7 * 60 + 45, 17 * 60 + 20)], [interval(8 * 60, 17 * 60)]) / minute,
    540,
  );
});
test('MF03 excludes approved leave and unions duplicate/overlapping intervals', () => {
  assert.equal(
    workedMilliseconds(
      [interval(480, 1020), interval(500, 900)],
      [interval(480, 1020)],
      [interval(720, 780), interval(750, 810)],
    ) / minute,
    450,
  );
});
test('MF03 counts approved overtime separately and rounds only the final total', () => {
  assert.equal(workedMilliseconds([interval(480, 1080)], [interval(1020, 1080)]) / minute, 60);
  assert.equal(
    Math.floor(
      workedMilliseconds(
        [
          { start: 0, end: 40000 },
          { start: 50000, end: 90000 },
        ],
        [{ start: 0, end: 100000 }],
      ) / minute,
    ),
    1,
  );
});
test('MF03 work date uses shift timezone instead of UTC date', () => {
  assert.equal(workDateAt(new Date('2026-10-07T18:00:00Z'), 'Asia/Ho_Chi_Minh'), '2026-10-08');
});
test('MF03 applies reusable shift clock times to the assigned day and preserves overnight end date', () => {
  const day = scheduledShiftWindow(
    {
      startsAt: new Date('2026-10-01T01:00:00Z'),
      endsAt: new Date('2026-10-01T10:00:00Z'),
      timezone: 'Asia/Ho_Chi_Minh',
    },
    '2026-10-08',
  );
  assert.equal(day.startsAt.toISOString(), '2026-10-08T01:00:00.000Z');
  assert.equal(day.endsAt.toISOString(), '2026-10-08T10:00:00.000Z');
  const night = scheduledShiftWindow(
    {
      startsAt: new Date('2026-10-01T15:00:00Z'),
      endsAt: new Date('2026-10-01T23:00:00Z'),
      timezone: 'Asia/Ho_Chi_Minh',
    },
    '2026-10-08',
  );
  assert.equal(night.endsAt.toISOString(), '2026-10-08T23:00:00.000Z');
  assert.equal(workDateAt(night.endsAt, 'Asia/Ho_Chi_Minh'), '2026-10-09');
});
test('MF03 timezone conversion honors DST offsets and rejects nonexistent local times', () => {
  const shift = {
    startsAt: new Date('2026-01-01T13:00:00Z'),
    endsAt: new Date('2026-01-01T22:00:00Z'),
    timezone: 'America/New_York',
  };
  assert.equal(
    scheduledShiftWindow(shift, '2026-07-01').startsAt.toISOString(),
    '2026-07-01T12:00:00.000Z',
  );
  assert.throws(
    () =>
      scheduledShiftWindow({ ...shift, startsAt: new Date('2026-01-01T07:30:00Z') }, '2026-03-08'),
    /does not exist/,
  );
});

test('subtraction model: net interval excludes overlapping breaks cleanly', () => {
  const window = { start: 8 * 60 * minute, end: 17 * 60 * minute };
  const lunch = [{ start: 12 * 60 * minute, end: 13 * 60 * minute }];
  assert.equal(intervalNetMilliseconds(window, lunch) / minute, 480);
});

test('subtraction model: exit under 15 minutes is not deducted and counts as working', () => {
  const shiftWindow = {
    startsAt: new Date('2026-10-15T08:00:00Z'),
    endsAt: new Date('2026-10-15T17:00:00Z'),
    breakStartsAt: new Date('2026-10-15T12:00:00Z'),
    breakEndsAt: new Date('2026-10-15T13:00:00Z'),
  };
  const result = calculateShiftAttendanceSubtraction({
    shiftWindow,
    policy: { allowedExitMinutes: 15, maxExitCount: 2 },
    sessions: [
      {
        effectiveInAt: new Date('2026-10-15T08:00:00Z'),
        effectiveOutAt: new Date('2026-10-15T10:00:00Z'),
      },
      {
        effectiveInAt: new Date('2026-10-15T10:10:00Z'), // 10 min exit
        effectiveOutAt: new Date('2026-10-15T17:00:00Z'),
      },
    ],
    now: new Date('2026-10-15T18:00:00Z'),
  });
  assert.equal(result.scheduledMinutes, 480);
  assert.equal(result.regularMinutes, 480);
  assert.equal(result.deductedMinutes, 0);
  assert.equal(result.exitCount, 1);
  assert.deepEqual(result.violations, []);
});

test('subtraction model: exit exceeding 15 minutes deducts the excess duration and triggers violation', () => {
  const shiftWindow = {
    startsAt: new Date('2026-10-15T08:00:00Z'),
    endsAt: new Date('2026-10-15T17:00:00Z'),
    breakStartsAt: new Date('2026-10-15T12:00:00Z'),
    breakEndsAt: new Date('2026-10-15T13:00:00Z'),
  };
  const result = calculateShiftAttendanceSubtraction({
    shiftWindow,
    policy: { allowedExitMinutes: 15, maxExitCount: 2 },
    sessions: [
      {
        effectiveInAt: new Date('2026-10-15T08:00:00Z'),
        effectiveOutAt: new Date('2026-10-15T10:00:00Z'),
      },
      {
        effectiveInAt: new Date('2026-10-15T10:25:00Z'), // 25 min exit -> deducts 25 - 15 = 10 mins
        effectiveOutAt: new Date('2026-10-15T17:00:00Z'),
      },
    ],
    now: new Date('2026-10-15T18:00:00Z'),
  });
  assert.equal(result.scheduledMinutes, 480);
  assert.equal(result.regularMinutes, 470);
  assert.equal(result.deductedMinutes, 10);
  assert.equal(result.exitCount, 1);
  assert.deepEqual(result.violations, ['EXIT_DURATION_EXCEEDED']);
});

test('subtraction model: exceeding max exit count deducts entire duration of 3rd exit and triggers violation', () => {
  const shiftWindow = {
    startsAt: new Date('2026-10-15T08:00:00Z'),
    endsAt: new Date('2026-10-15T17:00:00Z'),
    breakStartsAt: new Date('2026-10-15T12:00:00Z'),
    breakEndsAt: new Date('2026-10-15T13:00:00Z'),
  };
  const result = calculateShiftAttendanceSubtraction({
    shiftWindow,
    policy: { allowedExitMinutes: 15, maxExitCount: 2 },
    sessions: [
      {
        effectiveInAt: new Date('2026-10-15T08:00:00Z'),
        effectiveOutAt: new Date('2026-10-15T09:00:00Z'),
      },
      {
        effectiveInAt: new Date('2026-10-15T09:10:00Z'), // exit 1 (10m) -> 0 deducted
        effectiveOutAt: new Date('2026-10-15T11:00:00Z'),
      },
      {
        effectiveInAt: new Date('2026-10-15T11:10:00Z'), // exit 2 (10m) -> 0 deducted
        effectiveOutAt: new Date('2026-10-15T14:00:00Z'),
      },
      {
        effectiveInAt: new Date('2026-10-15T14:10:00Z'), // exit 3 (10m) -> exceeds max 2, full 10m deducted!
        effectiveOutAt: new Date('2026-10-15T17:00:00Z'),
      },
    ],
    now: new Date('2026-10-15T18:00:00Z'),
  });
  assert.equal(result.scheduledMinutes, 480);
  assert.equal(result.regularMinutes, 470);
  assert.equal(result.deductedMinutes, 10);
  assert.equal(result.exitCount, 3);
  assert.deepEqual(result.violations, ['MAX_EXITS_EXCEEDED']);
});

test('subtraction model: checking out late (5:30 PM instead of 5:00 PM) never adds extra regular hours', () => {
  const shiftWindow = {
    startsAt: new Date('2026-10-15T08:00:00Z'),
    endsAt: new Date('2026-10-15T17:00:00Z'),
    breakStartsAt: new Date('2026-10-15T12:00:00Z'),
    breakEndsAt: new Date('2026-10-15T13:00:00Z'),
  };
  const result = calculateShiftAttendanceSubtraction({
    shiftWindow,
    policy: { allowedExitMinutes: 15, maxExitCount: 2 },
    sessions: [
      {
        effectiveInAt: new Date('2026-10-15T08:00:00Z'),
        effectiveOutAt: new Date('2026-10-15T17:30:00Z'), // 30 mins late checkout
      },
    ],
    now: new Date('2026-10-15T18:00:00Z'),
  });
  assert.equal(result.scheduledMinutes, 480);
  assert.equal(result.regularMinutes, 480); // stays strictly 480 mins (8h)
  assert.equal(result.overtimeMinutes, 0); // no approved OT -> 0 overtime
  assert.equal(result.deductedMinutes, 0);
});

test('subtraction model: late check-in deducts late arrival minutes', () => {
  const shiftWindow = {
    startsAt: new Date('2026-10-15T08:00:00Z'),
    endsAt: new Date('2026-10-15T17:00:00Z'),
    breakStartsAt: new Date('2026-10-15T12:00:00Z'),
    breakEndsAt: new Date('2026-10-15T13:00:00Z'),
  };
  const result = calculateShiftAttendanceSubtraction({
    shiftWindow,
    policy: { allowedExitMinutes: 15, maxExitCount: 2 },
    sessions: [
      {
        effectiveInAt: new Date('2026-10-15T08:20:00Z'), // 20 mins late
        effectiveOutAt: new Date('2026-10-15T17:00:00Z'),
      },
    ],
    now: new Date('2026-10-15T18:00:00Z'),
  });
  assert.equal(result.scheduledMinutes, 480);
  assert.equal(result.regularMinutes, 460); // 480 - 20 = 460
  assert.equal(result.deductedMinutes, 20);
});

test('subtraction model: exit during scheduled lunch break is not counted as mid-shift exit', () => {
  const shiftWindow = {
    startsAt: new Date('2026-10-15T08:00:00Z'),
    endsAt: new Date('2026-10-15T17:00:00Z'),
    breakStartsAt: new Date('2026-10-15T12:00:00Z'),
    breakEndsAt: new Date('2026-10-15T13:00:00Z'),
  };
  const result = calculateShiftAttendanceSubtraction({
    shiftWindow,
    policy: { allowedExitMinutes: 15, maxExitCount: 2 },
    sessions: [
      {
        effectiveInAt: new Date('2026-10-15T08:00:00Z'),
        effectiveOutAt: new Date('2026-10-15T12:00:00Z'),
      },
      {
        effectiveInAt: new Date('2026-10-15T13:00:00Z'), // lunch exit
        effectiveOutAt: new Date('2026-10-15T17:00:00Z'),
      },
    ],
    now: new Date('2026-10-15T18:00:00Z'),
  });
  assert.equal(result.scheduledMinutes, 480);
  assert.equal(result.regularMinutes, 480);
  assert.equal(result.deductedMinutes, 0);
  assert.equal(result.exitCount, 0);
});

const at = (time: string) => new Date(`2026-10-15T${time}Z`);
const subtractionShift = {
  startsAt: at('08:00:00'),
  endsAt: at('17:00:00'),
  breakStartsAt: at('12:00:00'),
  breakEndsAt: at('13:00:00'),
};
const session = (start: string, end: string | null) => ({
  effectiveInAt: at(start),
  effectiveOutAt: end ? at(end) : null,
});

test('subtraction: ongoing work is capped at now and future sessions cannot earn hours', () => {
  const result = calculateShiftAttendanceSubtraction({
    shiftWindow: subtractionShift,
    sessions: [session('08:00:00', null), session('15:00:00', '17:00:00')],
    now: at('09:00:00'),
  });
  assert.equal(result.regularMinutes, 60);
  assert.equal(result.provisionalMinutes, 60);
  assert.equal(result.deductedMinutes, 0);
});

test('subtraction: nested, overlapping and ignored sessions do not invent absences', () => {
  const result = calculateShiftAttendanceSubtraction({
    shiftWindow: subtractionShift,
    sessions: [
      session('08:00:00', '17:00:00'),
      session('09:00:00', '10:00:00'),
      session('16:00:00', '17:30:00'),
      { ...session('18:00:00', null), status: 'IGNORED' },
    ],
    now: at('18:00:00'),
  });
  assert.equal(result.regularMinutes, 480);
  assert.equal(result.exitCount, 0);
  assert.equal(result.deductedMinutes, 0);
});

test('subtraction: an ongoing third exit deducts its full elapsed duration and reports the violation', () => {
  const result = calculateShiftAttendanceSubtraction({
    shiftWindow: subtractionShift,
    sessions: [
      session('08:00:00', '09:00:00'),
      session('09:10:00', '11:00:00'),
      session('11:10:00', '14:00:00'),
    ],
    now: at('14:30:00'),
  });
  assert.equal(result.exitCount, 3);
  assert.equal(result.deductedMinutes, 30);
  assert.equal(result.regularMinutes, 300);
  assert.equal(result.provisionalMinutes, 300);
  assert.deepEqual(result.violations, ['MAX_EXITS_EXCEEDED']);
  assert.deepEqual(result.violationDetails, [
    {
      event: 'MAX_EXITS_EXCEEDED',
      exitedAt: +at('14:00:00'),
      exitIndex: 3,
      absentMinutes: 30,
      deductedMinutes: 30,
    },
  ]);
});

test('subtraction: exactly 15 minutes is exempt; an ongoing 25-minute exit deducts only 10', () => {
  for (const [now, deducted, violations] of [
    ['10:15:00', 0, []],
    ['10:25:00', 10, ['EXIT_DURATION_EXCEEDED']],
  ] as const) {
    const result = calculateShiftAttendanceSubtraction({
      shiftWindow: subtractionShift,
      sessions: [session('08:00:00', '10:00:00')],
      now: at(now),
    });
    assert.equal(result.exitCount, 1);
    assert.equal(result.deductedMinutes, deducted);
    assert.deepEqual(result.violations, [...violations]);
  }
});

test('subtraction: final early departure loses all remaining time; leave and lunch are excluded once', () => {
  const result = calculateShiftAttendanceSubtraction({
    shiftWindow: subtractionShift,
    sessions: [session('08:20:00', '11:50:00'), session('13:10:00', '16:50:00')],
    leaveWindows: [{ start: +at('11:45:00'), end: +at('13:15:00') }],
    now: at('18:00:00'),
  });
  assert.equal(result.scheduledMinutes, 450);
  assert.equal(result.deductedMinutes, 30);
  assert.equal(result.regularMinutes, 420);
  assert.deepEqual(result.violations, []);
});

test('subtraction: no presence and full approved leave never create work or penalties', () => {
  const result = calculateShiftAttendanceSubtraction({
    shiftWindow: subtractionShift,
    sessions: [],
    leaveWindows: [{ start: +subtractionShift.startsAt, end: +subtractionShift.endsAt }],
    now: at('18:00:00'),
  });
  assert.equal(result.regularMinutes, 0);
  assert.equal(result.deductedMinutes, 0);
  assert.deepEqual(result.violations, []);
});

test('subtraction: approved overtime requires presence and preserves rounding across regular/OT boundary', () => {
  const result = calculateShiftAttendanceSubtraction({
    shiftWindow: subtractionShift,
    sessions: [session('08:00:30', '17:00:40')],
    overtimeWindows: [{ start: +at('17:00:00'), end: +at('18:00:00') }],
    now: at('18:00:00'),
  });
  assert.equal(result.regularMinutes, 479);
  assert.equal(result.overtimeMinutes, 1);
  assert.equal(result.provisionalMinutes, 480);
});

test('subtraction: zero grace/count and a break-spanning exit respect work-only duration', () => {
  const result = calculateShiftAttendanceSubtraction({
    shiftWindow: subtractionShift,
    policy: { allowedExitMinutes: 0, maxExitCount: 0 },
    sessions: [session('08:00:00', '11:55:00'), session('13:05:00', '17:00:00')],
    now: at('18:00:00'),
  });
  assert.equal(result.exitCount, 1);
  assert.equal(result.deductedMinutes, 10);
  assert.equal(result.regularMinutes, 470);
  assert.deepEqual(result.violations, ['MAX_EXITS_EXCEEDED']);
});
