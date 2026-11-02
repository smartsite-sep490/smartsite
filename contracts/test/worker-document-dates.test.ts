import assert from 'node:assert/strict';
import { test } from 'node:test';
import { healthCertificateExpiry, isWorkerDocumentDate } from '../src/worker-document-dates.js';

test('declared dates require real ISO calendar dates', () => {
  for (const value of ['2024-02-29', '2030-10-27']) assert.equal(isWorkerDocumentDate(value), true);
  for (const value of [null, undefined, '', '0000-01-01', '2026-02-29', '2026-04-31', '27/10/2030'])
    assert.equal(isWorkerDocumentDate(value), false);
});
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
