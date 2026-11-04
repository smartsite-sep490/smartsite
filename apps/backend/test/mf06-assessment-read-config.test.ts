import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateEnvironment, EnvironmentValidationError } from '../src/config/environment.js';

test('assessment history reads are OFF by default and do not enable enqueue', () => {
  const disabled = validateEnvironment({ NODE_ENV: 'test' });
  assert.equal(disabled.MF06_ASSESSMENT_READ_ENABLED, false);
  assert.equal(disabled.MF06_ENQUEUE_ENABLED, false);
  const enabled = validateEnvironment({ NODE_ENV: 'test', MF06_ASSESSMENT_READ_ENABLED: 'true' });
  assert.equal(enabled.MF06_ASSESSMENT_READ_ENABLED, true);
  assert.equal(enabled.MF06_ENQUEUE_ENABLED, false);
  assert.equal(enabled.MF06_ENQUEUE_MAX_OUTSTANDING, undefined);
});

test('assessment history read flag rejects ambiguous configuration', () => {
  assert.equal(
    validateEnvironment({ NODE_ENV: 'test', MF06_ASSESSMENT_READ_ENABLED: 'false' })
      .MF06_ASSESSMENT_READ_ENABLED,
    false,
  );
  for (const value of ['TRUE', '1', 'yes', '', ' true ']) {
    assert.throws(
      () => validateEnvironment({ NODE_ENV: 'test', MF06_ASSESSMENT_READ_ENABLED: value }),
      EnvironmentValidationError,
    );
  }
});
