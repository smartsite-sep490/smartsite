import assert from 'node:assert/strict';
import test from 'node:test';
import {
  groupTeamCalendar,
  type TeamCalendarMembership,
  type TeamCalendarSchedule,
} from '../src/modules/workforce/scheduling/team-calendar.js';

const shift = {
  id: 'shift',
  startsAt: new Date('2026-01-01T01:00:00Z'),
  endsAt: new Date('2026-01-01T10:00:00Z'),
  timezone: 'Asia/Ho_Chi_Minh',
};
const schedule = (overrides: Partial<TeamCalendarSchedule> = {}): TeamCalendarSchedule => ({
  scheduleId: 'schedule-1',
  workerId: 'worker-1',
  workDate: '2026-11-20',
  shiftId: 'shift',
  scheduleVersionId: 'version',
  recordedTeamId: null,
  recordedTeamName: null,
  ...overrides,
});
const member = (overrides: Partial<TeamCalendarMembership> = {}): TeamCalendarMembership => ({
  workerId: 'worker-1',
  teamId: 'team-a',
  teamName: 'Team A',
  joinedAt: new Date('2026-11-19T00:00:00Z'),
  leftAt: null,
  ...overrides,
});

test('legacy worker schedules without a team batch appear grouped under their assigned team', () => {
  const result = groupTeamCalendar(
    [schedule(), schedule({ scheduleId: 'schedule-2', workerId: 'worker-2' })],
    [member(), member({ workerId: 'worker-2' })],
    [shift],
  );
  assert.deepEqual(result, {
    items: [
      {
        teamId: 'team-a',
        teamName: 'Team A',
        workDate: '2026-11-20',
        shiftId: 'shift',
        scheduleVersionId: 'version',
        workerCount: 2,
      },
    ],
    unassignedScheduleCount: 0,
  });
});

test('historical memberships preserve the old team and the new team starts at the transfer boundary', () => {
  const rows = [
    schedule({ workDate: '2026-11-19' }),
    schedule({ scheduleId: 'next-day', workDate: '2026-11-20' }),
  ];
  const boundary = new Date('2026-11-20T01:00:00Z');
  const result = groupTeamCalendar(
    rows,
    [
      member({ joinedAt: new Date('2020-01-01'), leftAt: boundary }),
      member({ teamId: 'team-b', teamName: 'Team B', joinedAt: boundary }),
    ],
    [shift],
  );
  assert.deepEqual(
    result.items.map((item) => [item.workDate, item.teamId]),
    [
      ['2026-11-19', 'team-a'],
      ['2026-11-20', 'team-b'],
    ],
  );
});

test('recorded team batches override inferred membership and duplicate references count a worker once', () => {
  const recorded = schedule({ recordedTeamId: 'original-team', recordedTeamName: 'Original Team' });
  const result = groupTeamCalendar([recorded, recorded], [member()], [shift]);
  assert.equal(result.items[0]?.teamId, 'original-team');
  assert.equal(result.items[0]?.workerCount, 1);
});

test('a worker with no team for that shift is reported without inventing a group', () => {
  assert.deepEqual(
    groupTeamCalendar([schedule()], [member({ joinedAt: new Date('2026-11-21') })], [shift]),
    { items: [], unassignedScheduleCount: 1 },
  );
  assert.deepEqual(groupTeamCalendar([schedule()], [], [shift]), {
    items: [],
    unassignedScheduleCount: 1,
  });
});

test('ambiguous history and missing shift data do not select an arbitrary team', () => {
  assert.equal(
    groupTeamCalendar([schedule()], [member(), member({ teamId: 'another-team' })], [shift])
      .unassignedScheduleCount,
    1,
  );
  assert.equal(groupTeamCalendar([schedule()], [member()], []).unassignedScheduleCount, 1);
});

test('overnight shifts use the work date start, and group filters do not turn other groups into unassigned shifts', () => {
  const night = {
    ...shift,
    startsAt: new Date('2026-01-01T15:00:00Z'),
    endsAt: new Date('2026-01-02T01:00:00Z'),
  };
  const result = groupTeamCalendar(
    [schedule()],
    [member({ leftAt: new Date('2026-11-20T18:00:00Z') })],
    [night],
  );
  assert.equal(result.items[0]?.teamId, 'team-a');
  assert.deepEqual(groupTeamCalendar([schedule()], [member()], [shift], 'team-b'), {
    items: [],
    unassignedScheduleCount: 0,
  });
});
