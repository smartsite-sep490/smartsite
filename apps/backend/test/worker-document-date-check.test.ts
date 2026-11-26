import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareDocumentDates } from '../src/modules/workforce/documents/worker-document-date-check.js';

const dates = {
  issuedOn: '2026-10-27',
  expiresOn: '2030-10-27',
};
test('Safety and Insurance compare declared expiry against AI-extracted expiry', () => {
  for (const kind of ['SAFETY_CARD', 'PERSONAL_INSURANCE'] as const) {
    assert.deepEqual(compareDocumentDates(kind, { submittedExpiresOn: '2030-10-27' }, dates), {
      status: 'MATCH',
      field: 'EXPIRES_ON',
      submittedDate: '2030-10-27',
      detectedDate: '2030-10-27',
    });
    assert.equal(
      compareDocumentDates(kind, { submittedExpiresOn: '2031-10-27' }, dates).status,
      'MISMATCH',
    );
  }
});
test('Health compares examination date regardless of printed expiry', () => {
  const result = compareDocumentDates(
    'HEALTH_CERTIFICATE',
    { submittedIssuedOn: '2026-10-27', submittedExpiresOn: '2027-10-27' },
    dates,
  );
  assert.equal(result.status, 'MATCH');
  assert.equal(result.field, 'ISSUED_ON');
  assert.equal(result.detectedDate, '2026-10-27');
});
test('missing, unreadable, unavailable or invalid AI dates never produce a match', () => {
  for (const evidence of [
    null,
    { ...dates, expiresOn: null },
    { ...dates, expiresOn: '2030-02-30' },
  ]) {
    const result = compareDocumentDates(
      'SAFETY_CARD',
      { submittedExpiresOn: '2030-10-27' },
      evidence,
    );
    assert.equal(result.status, 'UNAVAILABLE');
    assert.equal(result.detectedDate, null);
  }
  assert.equal(compareDocumentDates('SAFETY_CARD', {}, dates).status, 'NO_REFERENCE');
  assert.equal(
    compareDocumentDates('SAFETY_CARD', { submittedExpiresOn: '2030-02-30' }, dates).status,
    'NO_REFERENCE',
  );
});
