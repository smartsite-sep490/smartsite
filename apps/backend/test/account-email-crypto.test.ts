import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decryptAccountEmail,
  encryptAccountEmail,
  emailCodeHash,
  equalEmailHash,
} from '../src/modules/auth/account-email-crypto.js';
const secret = 'test-only-account-email-encryption-secret';
test('encrypts queued credentials and rejects tampered or wrong-key email envelopes', () => {
  const payload = {
    text: 'Synthetic initial password + verification code',
    passwordVersion: 'synthetic-hash',
  };
  const first = encryptAccountEmail(payload, secret),
    second = encryptAccountEmail(payload, secret);
  assert.notEqual(first, second);
  assert.ok(!first.includes(payload.text));
  assert.deepEqual(decryptAccountEmail(first, secret), payload);
  assert.throws(() => decryptAccountEmail(first, 'different-test-key'));
  const parts = first.split('.');
  parts[2] = Buffer.alloc(16).toString('base64url');
  assert.throws(() => decryptAccountEmail(parts.join('.'), secret));
});
test('binds one-time-code hashes to their user and purpose without retaining plaintext codes', () => {
  const hash = emailCodeHash(secret, 'worker', 'VERIFY', '654321');
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(equalEmailHash(hash, emailCodeHash(secret, 'worker', 'VERIFY', '654321')), true);
  assert.equal(equalEmailHash(hash, emailCodeHash(secret, 'other', 'VERIFY', '654321')), false);
  assert.equal(equalEmailHash(hash, emailCodeHash(secret, 'worker', 'RESET', '654321')), false);
  assert.equal(equalEmailHash(hash, 'invalid'), false);
});
