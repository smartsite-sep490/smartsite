import { isWorkerDocumentDate as isCalendarDate } from '@smartsite/contracts';
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  complianceDate,
  complianceState,
  documentReviewState,
  workerDocumentsAllowEntry,
  requireWorkerDocuments,
} from '../src/modules/workforce/documents/worker-compliance.js';
import type { EntityManager } from 'typeorm';
import {
  WorkerComplianceProfileEntity,
  WorkerDocumentEntity,
} from '../src/database/entities/worker-document.entity.js';
import { PublicHttpException } from '../src/common/http/public-http-exception.js';
import { validateWorkerDocument } from '../src/modules/workforce/documents/worker-documents.service.js';
const kinds = ['SAFETY_CARD', 'HEALTH_CERTIFICATE', 'PERSONAL_INSURANCE'] as const;
const approved = () =>
  kinds.map((kind) => ({
    kind,
    status: 'APPROVED' as const,
    issuedOn: '2026-01-01',
    expiresOn: '2026-10-17',
  }));
test('review tags distinguish no submission, waiting review and supplement without changing eligibility', () => {
  const at = new Date('2026-10-18T00:00:00Z');
  const docs = approved().map((doc, i) => ({
    ...doc,
    id: `approved-${i}`,
    expiresOn: '2027-01-01',
    uploadedAt: new Date('2026-01-01'),
  }));
  assert.deepEqual(documentReviewState([], at), {
    submissionStatus: 'NOT_SUBMITTED',
    needsSupplement: true,
  });
  assert.deepEqual(documentReviewState(docs, at), {
    submissionStatus: 'REVIEWED',
    needsSupplement: false,
  });
  const pending = {
    ...docs[0]!,
    id: 'pending',
    status: 'PENDING' as const,
    uploadedAt: new Date('2026-10-18'),
  };
  assert.deepEqual(documentReviewState([pending], at), {
    submissionStatus: 'PENDING_REVIEW',
    needsSupplement: true,
  });
  assert.deepEqual(documentReviewState([...docs, pending], at), {
    submissionStatus: 'PENDING_REVIEW',
    needsSupplement: false,
  });
  const rejected = { ...pending, status: 'REJECTED' as const };
  assert.deepEqual(documentReviewState([...docs, rejected], at), {
    submissionStatus: 'REVIEWED',
    needsSupplement: true,
  });
  assert.equal(
    documentReviewState([...docs, { ...rejected, status: 'SUPERSEDED' }], at).needsSupplement,
    false,
  );
  const expired = docs.map((doc) => ({ ...doc, expiresOn: '2026-10-17' }));
  assert.equal(documentReviewState(expired, at).needsSupplement, true);
  assert.equal(
    documentReviewState(
      docs.map((doc) => ({ ...doc, status: 'PENDING' })),
      at,
    ).needsSupplement,
    false,
  );
});
test('legacy missing or expired documents and suspension block operations, incomplete identity is independent', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-18T00:00:00Z') });
  let documents = approved().map((d) => ({ ...d, expiresOn: '2099-01-01' }));
  let profile: Partial<WorkerComplianceProfileEntity> | null = null;
  const manager = {
    getRepository(entity: unknown) {
      if (entity === WorkerComplianceProfileEntity) return { findOneBy: async () => profile };
      if (entity === WorkerDocumentEntity) return { findBy: async () => documents };
      throw new Error('Unexpected repository');
    },
  } as unknown as EntityManager;
  const worker = { id: 'synthetic-worker', isActive: true };
  await requireWorkerDocuments(manager, worker);
  const denied = (error: unknown) =>
    error instanceof PublicHttpException && error.publicPayload.code === 'FORBIDDEN';
  documents = [];
  assert.equal(await workerDocumentsAllowEntry(manager, worker.id), false);
  await assert.rejects(requireWorkerDocuments(manager, worker), denied);
  documents = approved();
  await assert.rejects(requireWorkerDocuments(manager, worker), denied);
  documents = approved().map((d) => ({ ...d, expiresOn: '2099-01-01' }));
  profile = {
    identityRequired: true,
    nationalId: '000000000001',
    gender: 'MALE',
    address: 'Synthetic address',
  };
  await requireWorkerDocuments(manager, worker);
  await assert.rejects(requireWorkerDocuments(manager, { ...worker, isActive: false }), denied);
});
test('all three approved documents are required, and expiry includes the whole Vietnam calendar day', () => {
  assert.equal(complianceDate(new Date('2026-10-17T16:59:59Z')), '2026-10-17');
  assert.equal(
    complianceState(true, approved(), new Date('2026-10-17T16:59:59Z')).status,
    'ACTIVE',
  );
  assert.equal(
    complianceState(true, approved(), new Date('2026-10-17T17:00:00Z')).status,
    'EXPIRED',
  );
  assert.equal(
    complianceState(true, approved().slice(0, 2), new Date('2026-10-17T00:00:00Z')).status,
    'PENDING',
  );
});
test('pending or rejected renewals never extend the current approved expiry', () => {
  for (const status of ['PENDING', 'REJECTED'] as const) {
    const state = complianceState(
      true,
      [
        ...approved(),
        { kind: 'SAFETY_CARD', status, issuedOn: '2026-10-01', expiresOn: '2028-10-01' },
      ],
      new Date('2026-10-18T00:00:00Z'),
    );
    assert.equal(state.status, 'EXPIRED');
    assert.equal(state.missingKinds.length, 3);
  }
  const pending = kinds.map((kind) => ({
    kind,
    status: 'PENDING' as const,
    issuedOn: '2026-01-01',
    expiresOn: '2028-01-01',
  }));
  assert.equal(complianceState(true, pending, new Date('2026-10-17T00:00:00Z')).status, 'PENDING');
});
test('future issues and malformed dates cannot establish validity; uploads require matching signatures', () => {
  assert.equal(isCalendarDate('2026-02-30'), false);
  assert.equal(isCalendarDate('0000-01-01'), false);
  assert.equal(isCalendarDate('2028-02-29'), true);
  assert.equal(
    complianceState(
      true,
      approved().map((d) => ({ ...d, issuedOn: '2026-10-18', expiresOn: '2028-10-18' })),
      new Date('2026-10-17T00:00:00Z'),
    ).status,
    'PENDING',
  );
  const buffer = Buffer.from('%PDF-1.7\nsynthetic\n%%EOF');
  assert.equal(
    validateWorkerDocument({ buffer, size: buffer.length, mimetype: 'application/pdf' }).extension,
    'pdf',
  );
  assert.throws(() =>
    validateWorkerDocument({ buffer, size: buffer.length, mimetype: 'image/jpeg' }),
  );
  assert.throws(() =>
    validateWorkerDocument({ buffer, size: buffer.length + 1, mimetype: 'application/pdf' }),
  );
});
