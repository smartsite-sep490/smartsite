import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateEnvironment, EnvironmentValidationError } from '../src/config/environment.js';

test('MF06 enqueue stays disabled with no inherited capacity or worker activation', () => {
  const config = validateEnvironment({ NODE_ENV: 'test' });
  assert.equal(config['MF06_ENQUEUE_ENABLED' as keyof typeof config], false);
  assert.equal(config['MF06_ENQUEUE_MAX_OUTSTANDING' as keyof typeof config], undefined);
});

test('MF06 enqueue requires an explicit finite capacity when enabled', () => {
  for (const input of [
    { MF06_ENQUEUE_ENABLED: 'true' },
    { MF06_ENQUEUE_ENABLED: 'true', MF06_ENQUEUE_MAX_OUTSTANDING: '0' },
    { MF06_ENQUEUE_ENABLED: 'true', MF06_ENQUEUE_MAX_OUTSTANDING: '10001' },
    { MF06_ENQUEUE_ENABLED: 'true', MF06_ENQUEUE_MAX_OUTSTANDING: '1.5' },
    { MF06_ENQUEUE_ENABLED: 'true', MF06_ENQUEUE_MAX_OUTSTANDING: 'Infinity' },
    { MF06_ENQUEUE_ENABLED: 'yes', MF06_ENQUEUE_MAX_OUTSTANDING: '10' },
  ]) {
    assert.throws(
      () => validateEnvironment({ NODE_ENV: 'test', ...input }),
      EnvironmentValidationError,
    );
  }
});

test('MF06 enqueue accepts only explicit true/false and bounded whole capacities', () => {
  for (const enabled of ['true', 'false']) {
    for (const capacity of ['1', '10000']) {
      const config = validateEnvironment({
        NODE_ENV: 'test',
        MF06_ENQUEUE_ENABLED: enabled,
        MF06_ENQUEUE_MAX_OUTSTANDING: capacity,
      });
      assert.equal(config['MF06_ENQUEUE_ENABLED' as keyof typeof config], enabled === 'true');
      assert.equal(config['MF06_ENQUEUE_MAX_OUTSTANDING' as keyof typeof config], Number(capacity));
    }
  }
});
