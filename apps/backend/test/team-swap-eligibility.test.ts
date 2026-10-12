import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { oppositeShiftWindows } from '../src/modules/workforce/team-swap-eligibility.js';
import { command } from '../src/common/configuration/commands.js';
import {
  AssignContractorTeamDto,
  ContractorTeamWorkersQueryDto,
} from '../src/modules/workforce/dto/contractor-team.dto.js';
test('opposite shifts are non-overlapping real intervals, including adjacent and overnight shifts', () => {
  const window = (start: string, end: string) => ({
    startsAt: new Date(start),
    endsAt: new Date(end),
  });
  const a = window('2030-01-01T08:00Z', '2030-01-01T12:00Z');
  assert.equal(oppositeShiftWindows(a, window('2030-01-01T12:00Z', '2030-01-01T16:00Z')), true);
  assert.equal(oppositeShiftWindows(a, window('2030-01-01T10:00Z', '2030-01-01T14:00Z')), false);
  assert.equal(oppositeShiftWindows(a, a), false);
  assert.equal(
    oppositeShiftWindows(
      window('2030-01-01T22:00Z', '2030-01-02T06:00Z'),
      window('2030-01-02T05:00Z', '2030-01-02T09:00Z'),
    ),
    false,
  );
  assert.equal(oppositeShiftWindows(a, window('invalid', '2030-01-01T16:00Z')), false);
});
test('membership commands require explicit expected membership and nullable destination, not missing IDs', () => {
  const requestId = '11111111-1111-4111-8111-111111111111';
  assert.equal(
    command(AssignContractorTeamDto, {
      requestId,
      expectedMembershipId: null,
      teamId: null,
      reason: 'Remove from current team',
    }).teamId,
    null,
  );
  for (const input of [
    { requestId, teamId: null, reason: 'Valid reason' },
    { requestId, expectedMembershipId: null, reason: 'Valid reason' },
    { requestId, expectedMembershipId: null, teamId: null, reason: 'short', extra: true },
  ])
    assert.throws(() => command(AssignContractorTeamDto, input));
  assert.throws(() => command(ContractorTeamWorkersQueryDto, { unassigned: 'no' }));
  assert.equal(command(ContractorTeamWorkersQueryDto, { unassigned: 'true' }).unassigned, true);
});
