import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { command } from '../src/common/configuration/commands.js';
import { ScheduleAssignmentDto } from '../src/modules/workforce/scheduling/dto/schedule-assignment.dto.js';
import { assignmentDates } from '../src/modules/workforce/scheduling/schedule-assignment-dates.js';

const base = {
  contractorId: randomUUID(),
  scheduleVersionId: randomUUID(),
  shiftId: randomUUID(),
  target: 'TEAM' as const,
  teamId: randomUUID(),
  mode: 'REPEAT' as const,
  fromDate: '2030-10-07',
  toDate: '2030-11-01',
  weekdays: [1, 2, 3, 4, 5],
};
test('weekly repetition produces twenty work dates over four weeks and no weekends', () => {
  const dates = assignmentDates(command(ScheduleAssignmentDto, base));
  assert.equal(dates.length, 20);
  assert.equal(dates[0], '2030-10-07');
  assert.equal(dates.at(-1), '2030-11-01');
  assert.equal(
    assignmentDates({ ...base, mode: 'DAY', fromDate: '2030-10-13', toDate: '2030-10-13' }).length,
    1,
  );
  assert.equal(assignmentDates({ ...base, mode: 'WEEK', toDate: '2030-10-13' }).length, 5);
});
test('assignment dates reject malformed authorities, unbounded ranges, empty days and mixed targets', () => {
  for (const input of [
    { ...base, weekdays: [] },
    { ...base, weekdays: [0, 8] },
    { ...base, selectedWorkerIds: [] },
    { ...base, toDate: 'invalid' },
    { ...base, unexpected: 'field' },
  ])
    assert.throws(() => command(ScheduleAssignmentDto, input));
  for (const input of [
    { ...base, toDate: '2032-01-01' },
    { ...base, mode: 'DAY' as const },
    { ...base, mode: 'WEEK' as const },
    { ...base, workerId: randomUUID() },
    { ...base, teamId: undefined },
    { ...base, toDate: '2030-10-06' },
  ])
    assert.throws(() => assignmentDates(input));
});
