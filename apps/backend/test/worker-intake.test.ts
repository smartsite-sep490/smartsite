import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { IntakeAttachment } from '../src/database/entities/worker-onboarding-draft.entity.js';
import {
  missingIntakeDocuments,
  parseIntakeDraft,
} from '../src/modules/workforce/directory/worker-intake-policy.js';

test('an intake draft accepts partial details, but readiness checks required documents and dates', () => {
  const draft = parseIntakeDraft({
    expectedVersion: 0,
    displayName: '  Synthetic worker ',
    username: '',
    email: '',
    safetyCardRequired: null,
    documents: { HEALTH_CERTIFICATE: {} },
  });
  assert.equal(draft.displayName, 'Synthetic worker');
  const attachment: IntakeAttachment = {
    originalName: 'synthetic.pdf',
    file: {
      storageProvider: 'LOCAL',
      mediaType: 'application/pdf',
      sha256: 'a'.repeat(64),
      size: 100,
      storageKey: 'synthetic.pdf',
    },
  };
  assert.deepEqual(missingIntakeDocuments({ HEALTH_CERTIFICATE: attachment }, false), [
    'HEALTH_CERTIFICATE',
    'PERSONAL_INSURANCE',
  ]);
  assert.deepEqual(
    missingIntakeDocuments(
      {
        HEALTH_CERTIFICATE: { ...attachment, submittedIssuedOn: '2026-11-20' },
        PERSONAL_INSURANCE: { ...attachment, submittedExpiresOn: '2027-11-20' },
      },
      false,
    ),
    [],
  );
  assert.throws(() => parseIntakeDraft({ ...draft, nationalId: '000000000000' }));
  const dates = { submittedIssuedOn: '2026-11-20', submittedExpiresOn: '2027-11-20' };
  assert.deepEqual(
    parseIntakeDraft({ ...draft, documents: { PERSONAL_INSURANCE: dates } }).documents,
    { PERSONAL_INSURANCE: dates },
  );
  assert.throws(() =>
    parseIntakeDraft({
      ...draft,
      documents: { SAFETY_CARD: { ...dates, submittedIssuedOn: '2027-11-21' } },
    }),
  );
  assert.throws(() =>
    parseIntakeDraft({
      ...draft,
      documents: { HEALTH_CERTIFICATE: { submittedIssuedOn: '2026-02-30' } },
    }),
  );
});
