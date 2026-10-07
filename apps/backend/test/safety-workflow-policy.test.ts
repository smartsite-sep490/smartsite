import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { incidentStatus, canCloseIncident } from '../src/modules/safety/workflow-policy.js';

test('incident follows outstanding actions and retains reopened until work begins', () => {
  assert.equal(incidentStatus('OPEN', []), 'OPEN');
  assert.equal(incidentStatus('OPEN', ['ASSIGNED']), 'ASSIGNED');
  assert.equal(incidentStatus('ASSIGNED', ['SUBMITTED', 'ASSIGNED']), 'IN_PROGRESS');
  assert.equal(incidentStatus('REOPENED', ['CLOSED', 'ASSIGNED']), 'REOPENED');
  assert.equal(incidentStatus('REOPENED', ['CLOSED', 'IN_PROGRESS']), 'IN_PROGRESS');
  assert.equal(incidentStatus('IN_PROGRESS', ['CLOSED', 'VERIFIED']), 'VERIFIED');
});

test('closure requires work, verification, and no pending submission', () => {
  assert.equal(canCloseIncident([], false), false);
  assert.equal(canCloseIncident(['ASSIGNED'], false), false);
  assert.equal(canCloseIncident(['VERIFIED'], true), false);
  assert.equal(canCloseIncident(['CLOSED', 'VERIFIED'], false), true);
});

test('Worker subjects reject UUID duplicates regardless of letter case in create and confirm', async () => {
  const { command } = await import('../src/common/configuration/commands.js');
  const { CreateIncidentDto, ConfirmResponsibilityDto } =
    await import('../src/modules/safety/safety-workflow.commands.js');
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const common = {
    commandId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    contractorId: id,
    workerIds: [id, id.toUpperCase()],
  };
  assert.throws(() =>
    command(CreateIncidentDto, {
      ...common,
      title: 'Synthetic',
      description: 'Synthetic',
      severity: 'HIGH',
      occurredAt: '2026-10-05T00:00:00Z',
      responsibilityReason: 'Confirmed',
      alertIds: [],
    }),
  );
  assert.throws(() =>
    command(ConfirmResponsibilityDto, { ...common, expectedVersion: 1, reason: 'Confirmed' }),
  );
});
