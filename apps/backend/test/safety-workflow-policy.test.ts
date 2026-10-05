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
