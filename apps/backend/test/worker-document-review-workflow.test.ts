import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { parseDocumentSubmission } from '../src/modules/workforce/documents/worker-document-submission.js';
import {
  complianceState,
  documentDraftMissingKinds,
  documentReviewState,
} from '../src/modules/workforce/documents/worker-compliance.js';
import { summarizeAnalysis } from '../src/modules/workforce/documents/worker-documents.service.js';
import type { WorkerDocumentEntity } from '../src/database/entities/worker-document.entity.js';

test('submission validates the complete envelope and declared dates before persistence', () => {
  const input = {
    requestId: randomUUID(),
    expectedVersion: 0,
    safetyCardRequired: false,
    documents: {
      HEALTH_CERTIFICATE: { submittedIssuedOn: '2026-11-01' },
      PERSONAL_INSURANCE: { submittedIssuedOn: '2026-11-01', submittedExpiresOn: '2027-11-01' },
    },
  };
  assert.deepEqual(parseDocumentSubmission(input), input);
  for (const bad of [
    { ...input, approve: true },
    {
      ...input,
      identity: {
        nationalId: '000000000001',
        phoneNumber: '0900000000',
        gender: 'OTHER',
        address: 'Test',
      },
    },
    { ...input, requestId: 'invalid' },
    { ...input, expectedVersion: -1 },
    { ...input, safetyCardRequired: 'false' },
    { ...input, documents: { HEALTH_CERTIFICATE: { submittedIssuedOn: '2026-02-30' } } },
    { ...input, documents: { PERSONAL_INSURANCE: { submittedIssuedOn: '2026-11-01' } } },
    {
      ...input,
      documents: {
        SAFETY_CARD: { submittedIssuedOn: '2027-11-02', submittedExpiresOn: '2027-11-01' },
      },
    },
  ])
    assert.throws(() => parseDocumentSubmission(bad));
});

test('AI summary checks a declared start date but preserves older expiry-only drafts', () => {
  const document = {
    kind: 'PERSONAL_INSURANCE',
    status: 'DRAFT',
    submittedExpiresOn: '2099-01-01',
    aiAnalysis: {
      status: 'COMPLETE',
      detectedKind: 'PERSONAL_INSURANCE',
      issuedOn: '2020-01-02',
      expiresOn: '2099-01-01',
    },
  } as WorkerDocumentEntity;
  assert.equal(summarizeAnalysis([document]).status, 'NO_DISCREPANCY');
  assert.equal(
    summarizeAnalysis([{ ...document, submittedIssuedOn: '2020-01-01' }]).status,
    'ATTENTION',
  );
  assert.equal(
    summarizeAnalysis([
      {
        ...document,
        submittedIssuedOn: '2020-01-02',
        aiAnalysis: {
          status: 'COMPLETE',
          detectedKind: 'PERSONAL_INSURANCE',
          issuedOn: null,
          expiresOn: '2099-01-01',
        },
      },
    ]).status,
    'INSUFFICIENT',
  );
});

test('optional safety card is applied consistently to eligibility and supplement flags', () => {
  const at = new Date('2026-11-21T03:00:00Z');
  const documents = (['HEALTH_CERTIFICATE', 'PERSONAL_INSURANCE'] as const).map((kind) => ({
    id: randomUUID(),
    kind,
    status: 'APPROVED' as const,
    issuedOn: '2026-11-01',
    expiresOn: '2027-11-01',
    uploadedAt: at,
  }));
  assert.equal(complianceState(true, documents, at, 30, false).status, 'ACTIVE');
  assert.deepEqual(complianceState(true, documents, at).missingKinds, ['SAFETY_CARD']);
  assert.equal(documentReviewState(documents, at, false).needsSupplement, false);
  assert.equal(documentReviewState(documents, at, true).needsSupplement, true);
});

test('AI summary gives draft discrepancies priority and retains unresolved counts', () => {
  const doc = {
    kind: 'SAFETY_CARD',
    status: 'DRAFT',
    submittedExpiresOn: '2099-01-01',
    aiAnalysis: {
      status: 'COMPLETE',
      detectedKind: 'PERSONAL_INSURANCE',
      issuedOn: '2026-01-01',
      expiresOn: '2099-01-01',
    },
  } as WorkerDocumentEntity;
  const unknown = { ...doc, aiAnalysis: null };
  const summary = summarizeAnalysis([doc, unknown]);
  assert.equal(summary.status, 'ATTENTION');
  assert.equal(summary.complete, 1);
  assert.equal(summary.unresolved, 1);
  assert.equal(summarizeAnalysis([{ ...doc, status: 'APPROVED' }]).status, 'NOT_SCANNED');
  assert.equal(
    summarizeAnalysis([{ ...doc, aiAnalysis: { status: 'UNAVAILABLE' } }]).status,
    'INSUFFICIENT',
  );
});

test('unsubmitted drafts are not a Safety submission', () => {
  const document = {
    id: randomUUID(),
    kind: 'HEALTH_CERTIFICATE',
    status: 'DRAFT',
    issuedOn: null,
    expiresOn: null,
    uploadedAt: new Date(),
  } as unknown as WorkerDocumentEntity;
  assert.equal(documentReviewState([document]).submissionStatus, 'NOT_SUBMITTED');
});

test('sender can combine drafts, pending certificates and current approvals', () => {
  const at = new Date('2026-11-21T03:00:00Z');
  const drafts = [
    { kind: 'HEALTH_CERTIFICATE', status: 'DRAFT', issuedOn: null, expiresOn: null },
    { kind: 'PERSONAL_INSURANCE', status: 'PENDING', issuedOn: null, expiresOn: null },
  ] as const;
  const card = {
    kind: 'SAFETY_CARD',
    status: 'APPROVED',
    issuedOn: '2026-01-01',
    expiresOn: '2026-11-20',
  } as const;
  assert.deepEqual(documentDraftMissingKinds([...drafts, card], true, at), ['SAFETY_CARD']);
  assert.deepEqual(documentDraftMissingKinds([...drafts, card], false, at), []);
  assert.deepEqual(
    documentDraftMissingKinds([...drafts, { ...card, expiresOn: '2026-11-21' }], true, at),
    [],
  );
});

test('expired AI leases become retryable and optional expired cards do not mislabel missing required papers', () => {
  const at = new Date('2026-11-21T03:00:00Z');
  const card = {
    kind: 'SAFETY_CARD' as const,
    status: 'APPROVED' as const,
    issuedOn: '2020-01-01',
    expiresOn: '2020-12-31',
  };
  assert.equal(complianceState(true, [card], at, 30, false).status, 'PENDING');
  const doc = {
    ...card,
    status: 'DRAFT',
    aiAnalysis: { status: 'ANALYZING', token: 'private', expiresAt: 0 },
  } as WorkerDocumentEntity;
  assert.equal(summarizeAnalysis([doc]).status, 'INSUFFICIENT');
});
