import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QueryFailedError } from 'typeorm';
import { isEventIdConflict } from '../src/integrations/ai/typeorm-error.js';

function queryFailed(code?: string, constraint?: string): QueryFailedError {
  return new QueryFailedError('INSERT ...', [], { code, constraint } as unknown as Error);
}

test('classifies only the observation event primary-key violation as a retry', () => {
  assert.equal(isEventIdConflict(queryFailed('23505', 'pk_ai_observation_event_event_id')), true);
  assert.equal(isEventIdConflict(queryFailed('23505', 'uq_camera_code')), false);
  assert.equal(isEventIdConflict(queryFailed('23503', 'pk_ai_observation_event_event_id')), false);
  assert.equal(
    isEventIdConflict(queryFailed(undefined, 'pk_ai_observation_event_event_id')),
    false,
  );
  assert.equal(isEventIdConflict(new Error('connection lost')), false);
});

test('never trusts top-level SQLSTATE or constraint properties', () => {
  const topLevelOnly = queryFailed() as QueryFailedError & {
    code: string;
    constraint: string;
  };
  topLevelOnly.code = '23505';
  topLevelOnly.constraint = 'pk_ai_observation_event_event_id';
  assert.equal(isEventIdConflict(topLevelOnly), false);

  const error = queryFailed('23505', 'uq_camera_code') as QueryFailedError & {
    code: string;
    constraint: string;
  };
  error.code = '23505';
  error.constraint = 'pk_ai_observation_event_event_id';
  assert.equal(isEventIdConflict(error), false);
});
