import './support/config.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  workedMilliseconds,
  workDateAt,
  scheduledShiftWindow,
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
