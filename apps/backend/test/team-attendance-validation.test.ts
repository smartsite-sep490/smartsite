import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { command } from '../src/common/configuration/commands.js';
import {
  SetTeamLeaderDto,
  SubmitTeamAttendanceDto,
} from '../src/modules/workforce/teams/dto/team-attendance.dto.js';

test('roll call only accepts explicit present/absent choices with bounded, unique, versioned members', () => {
  const entry = {
    scheduleId: randomUUID(),
    expectedMembershipId: randomUUID(),
    expectedVersion: 0,
    status: 'PRESENT',
  };
  const input = {
    requestId: randomUUID(),
    teamId: randomUUID(),
    zoneId: randomUUID(),
    entries: [entry],
  };
  assert.equal(command(SubmitTeamAttendanceDto, input).entries[0]?.status, 'PRESENT');
  for (const invalid of [
    { ...input, entries: [] },
    { ...input, entries: [entry, entry] },
    ...['NOT_YET', 'present', true, null].map((status) => ({
      ...input,
      entries: [{ ...entry, status }],
    })),
    { ...input, entries: [{ ...entry, expectedVersion: -1 }] },
    { ...input, entries: [{ ...entry, expectedVersion: '0' }] },
    { ...input, entries: [{ ...entry, expectedMembershipId: null }] },
    { ...input, entries: [{ ...entry, workerId: randomUUID() }] },
    { ...input, reason: 'x'.repeat(1001) },
    { ...input, actorId: randomUUID() },
    { ...input, zoneId: null },
  ])
    assert.throws(() => command(SubmitTeamAttendanceDto, invalid));
  assert.equal(command(SetTeamLeaderDto, { workerId: null, expectedVersion: 1 }).workerId, null);
  assert.throws(() => command(SetTeamLeaderDto, { expectedVersion: 1 }));
});
