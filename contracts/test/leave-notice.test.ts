import assert from 'node:assert/strict';
import test from 'node:test';
import { leaveNotice, timeRequestTimingIssue } from '../src/leave-notice.js';
import { scheduledShiftWindow } from '../src/scheduled-shift.js';

test('leave notice uses the actual assigned shift start, with an inclusive 24-hour boundary', () => {
  const shift = scheduledShiftWindow(
    {
      startsAt: new Date('2026-01-01T15:00:00Z'),
      endsAt: new Date('2026-01-02T01:00:00Z'),
      timezone: 'Asia/Ho_Chi_Minh',
    },
    '2026-11-20',
  );
  assert.equal(shift.startsAt.toISOString(), '2026-11-20T15:00:00.000Z');
  assert.equal(shift.endsAt.toISOString(), '2026-11-21T01:00:00.000Z');
  assert.equal(
    leaveNotice(shift.startsAt, 'PLANNED', new Date(+shift.startsAt - 86400000)).shortNotice,
    false,
  );
  assert.equal(
    leaveNotice(shift.startsAt, 'PLANNED', new Date(+shift.startsAt - 86400000 + 1)).shortNotice,
    true,
  );
  // Metadata can still classify historical records; new submissions have separate timing rules.
  assert.deepEqual(leaveNotice(shift.startsAt, 'EMERGENCY', new Date(+shift.endsAt + 86400000)), {
    noticeType: 'EMERGENCY',
    shortNotice: true,
  });
});

const daytime = {
  startsAt: new Date('2026-11-21T01:00:00Z'),
  endsAt: new Date('2026-11-21T10:00:00Z'),
  timezone: 'Asia/Ho_Chi_Minh',
};
test('planned submission accepts exactly 24 hours and rejects even one millisecond later', () => {
  assert.equal(
    timeRequestTimingIssue(daytime, 'LEAVE', 'PLANNED', new Date('2026-11-20T01:00:00Z')),
    null,
  );
  assert.equal(
    timeRequestTimingIssue(daytime, 'LEAVE', 'PLANNED', new Date('2026-11-20T01:00:00.001Z')),
    'PLANNED_NOTICE_REQUIRED',
  );
});
test('emergency leave includes future and ongoing shifts today, and excludes tomorrow', () => {
  assert.equal(
    timeRequestTimingIssue(daytime, 'LEAVE', 'EMERGENCY', new Date('2026-11-21T00:00:00Z')),
    null,
  );
  assert.equal(
    timeRequestTimingIssue(daytime, 'LEAVE', 'EMERGENCY', new Date('2026-11-21T04:00:00Z')),
    null,
  );
  assert.equal(
    timeRequestTimingIssue(daytime, 'LEAVE', 'EMERGENCY', new Date('2026-11-20T16:59:00Z')),
    'EMERGENCY_TODAY_ONLY',
  );
  assert.equal(
    timeRequestTimingIssue(daytime, 'LEAVE', 'EMERGENCY', new Date('2026-11-20T17:00:00Z')),
    null,
  );
});
test('all new requests reject a shift at its exact end, including overtime later that day', () => {
  for (const kind of ['LEAVE', 'OVERTIME'] as const)
    for (const notice of ['PLANNED', 'EMERGENCY'] as const)
      assert.equal(timeRequestTimingIssue(daytime, kind, notice, daytime.endsAt), 'SHIFT_ENDED');
  assert.equal(
    timeRequestTimingIssue(daytime, 'OVERTIME', 'PLANNED', new Date(+daytime.endsAt - 1)),
    null,
  );
});
test('an overnight emergency remains available after midnight until its actual end', () => {
  const night = {
    ...daytime,
    startsAt: new Date('2026-11-20T15:00:00Z'),
    endsAt: new Date('2026-11-21T01:00:00Z'),
  };
  assert.equal(
    timeRequestTimingIssue(night, 'LEAVE', 'EMERGENCY', new Date('2026-11-20T18:00:00Z')),
    null,
  );
  assert.equal(timeRequestTimingIssue(night, 'LEAVE', 'EMERGENCY', night.endsAt), 'SHIFT_ENDED');
  assert.equal(
    timeRequestTimingIssue({ ...daytime, endsAt: new Date('invalid') }, 'LEAVE'),
    'SHIFT_TIME_UNAVAILABLE',
  );
});
