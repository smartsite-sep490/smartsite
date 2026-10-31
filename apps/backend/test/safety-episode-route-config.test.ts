import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateEnvironment, EnvironmentValidationError } from '../src/config/environment.js';

test('episode projection is off by default and enabled projection requires an explicit UUID epoch', () => {
  const defaults = validateEnvironment({ NODE_ENV: 'test' }) as unknown as Record<string, unknown>;
  assert.equal(defaults.SAFETY_EPISODE_PROJECTION_ENABLED, false);
  assert.equal(defaults.SAFETY_EPISODE_ROUTE_EPOCH, undefined);
  for (const values of [
    { SAFETY_EPISODE_PROJECTION_ENABLED: 'true' },
    { SAFETY_EPISODE_PROJECTION_ENABLED: 'true', SAFETY_EPISODE_ROUTE_EPOCH: 'not-an-epoch' },
    { SAFETY_EPISODE_PROJECTION_ENABLED: 'yes' },
  ])
    assert.throws(
      () => validateEnvironment({ NODE_ENV: 'test', ...values }),
      EnvironmentValidationError,
    );
  const epoch = '90a50f41-a175-40f9-bd53-d17627f77d1c';
  const enabled = validateEnvironment({
    NODE_ENV: 'test',
    SAFETY_EPISODE_PROJECTION_ENABLED: 'true',
    SAFETY_EPISODE_ROUTE_EPOCH: epoch,
  }) as unknown as Record<string, unknown>;
  assert.equal(enabled.SAFETY_EPISODE_PROJECTION_ENABLED, true);
  assert.equal(enabled.SAFETY_EPISODE_ROUTE_EPOCH, epoch);
});
