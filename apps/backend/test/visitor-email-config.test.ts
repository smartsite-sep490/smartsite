import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateEnvironment } from '../src/config/environment.js';
test('visitor email requires both Resend settings and rejects invalid sender configuration', () => {
  assert.equal(validateEnvironment({ NODE_ENV: 'test' }).RESEND_API_KEY, undefined);
  for (const settings of [
    { RESEND_API_KEY: 're_synthetic' },
    { RESEND_FROM_EMAIL: 'qr@example.test' },
    { RESEND_API_KEY: 'wrong', RESEND_FROM_EMAIL: 'qr@example.test' },
    { RESEND_API_KEY: 're_synthetic', RESEND_FROM_EMAIL: 'not-an-address' },
  ])
    assert.throws(() => validateEnvironment({ NODE_ENV: 'test', ...settings }));
  assert.equal(
    validateEnvironment({
      NODE_ENV: 'test',
      RESEND_API_KEY: 're_synthetic',
      RESEND_FROM_EMAIL: 'qr@example.test',
    }).RESEND_FROM_EMAIL,
    'qr@example.test',
  );
});
