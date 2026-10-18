import assert from 'node:assert/strict';
import { test } from 'node:test';
import { healthCertificateExpiry } from '../src/worker-document-dates.js';
test('health expiry is one calendar year and clamps leap-day anniversaries', () => {
  assert.equal(healthCertificateExpiry('2026-10-18'), '2027-10-18');
  assert.equal(healthCertificateExpiry('2024-02-29'), '2025-02-28');
  assert.equal(healthCertificateExpiry('2023-03-01'), '2024-03-01');
  assert.equal(healthCertificateExpiry('2025-12-31'), '2026-12-31');
});
test('missing or invalid issue dates never invent health validity', () => {
  for (const value of [
    null,
    undefined,
    '',
    '2026-02-30',
    '2023-02-29',
    '18/10/2026',
    '0000-01-01',
    '9999-01-01',
  ])
    assert.equal(healthCertificateExpiry(value), null);
});
