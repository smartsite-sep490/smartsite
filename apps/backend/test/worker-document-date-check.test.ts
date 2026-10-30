import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DocumentOcrResult } from '@smartsite/contracts';
import { compareDocumentDates } from '../src/modules/workforce/documents/worker-document-date-check.js';

const ocr: DocumentOcrResult = {
  status: 'READ',
  issuedOn: '2026-10-27',
  expiresOn: '2030-10-27',
  warnings: [],
};
test('Safety and Insurance compare declared expiry against OCR expiry', () => {
  for (const kind of ['SAFETY_CARD', 'PERSONAL_INSURANCE'] as const) {
    assert.deepEqual(compareDocumentDates(kind, { submittedExpiresOn: '2030-10-27' }, ocr), {
      status: 'MATCH',
      field: 'EXPIRES_ON',
      submittedDate: '2030-10-27',
      detectedDate: '2030-10-27',
    });
    assert.equal(
      compareDocumentDates(kind, { submittedExpiresOn: '2031-10-27' }, ocr).status,
      'MISMATCH',
    );
  }
});
test('Health compares examination date regardless of printed expiry', () => {
  const result = compareDocumentDates(
    'HEALTH_CERTIFICATE',
    { submittedIssuedOn: '2026-10-27', submittedExpiresOn: '2027-10-27' },
    ocr,
  );
  assert.equal(result.status, 'MATCH');
  assert.equal(result.field, 'ISSUED_ON');
  assert.equal(result.detectedDate, '2026-10-27');
});
test('missing, unreadable, unavailable or invalid OCR dates never produce a match', () => {
  for (const evidence of [
    null,
    { ...ocr, status: 'UNAVAILABLE' as const },
    { ...ocr, status: 'UNREADABLE' as const },
    { ...ocr, expiresOn: null },
    { ...ocr, expiresOn: '2030-02-30' },
  ]) {
    const result = compareDocumentDates(
      'SAFETY_CARD',
      { submittedExpiresOn: '2030-10-27' },
      evidence,
    );
    assert.equal(result.status, 'UNAVAILABLE');
    assert.equal(result.detectedDate, null);
  }
  assert.equal(compareDocumentDates('SAFETY_CARD', {}, ocr).status, 'NO_REFERENCE');
  assert.equal(
    compareDocumentDates('SAFETY_CARD', { submittedExpiresOn: '2030-02-30' }, ocr).status,
    'NO_REFERENCE',
  );
});
