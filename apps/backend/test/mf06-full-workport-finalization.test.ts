import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Mf06ZoneEntryAssessmentWorkPort } from '../src/modules/safety/assessments/mf06-zone-entry-assessment-work.port.js';

test('full identity/policy composition requests the pre-snapshot writable authority fence', () => {
  // Constructor only: these dependencies must not be read until explicitly invoked.
  const port = new Mf06ZoneEntryAssessmentWorkPort(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  assert.equal((port as { finalizationScope?: string }).finalizationScope, 'AUTHORITY_SNAPSHOT');
});
