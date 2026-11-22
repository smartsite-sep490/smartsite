import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import sharp from 'sharp';
import type { LocalDocumentOcr } from '../src/modules/workforce/documents/local-document-ocr.js';
import { DocumentOcrService } from '../src/modules/workforce/documents/document-ocr.service.js';
import { parseDocumentSubmission } from '../src/modules/workforce/documents/worker-document-submission.js';
import {
  complianceState,
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
      PERSONAL_INSURANCE: { submittedExpiresOn: '2027-11-01' },
    },
  };
  assert.deepEqual(parseDocumentSubmission(input), input);
  for (const bad of [
    { ...input, approve: true },
    { ...input, requestId: 'invalid' },
    { ...input, expectedVersion: -1 },
    { ...input, safetyCardRequired: 'false' },
    { ...input, documents: { HEALTH_CERTIFICATE: { submittedIssuedOn: '2026-02-30' } } },
    { ...input, documents: { PERSONAL_INSURANCE: { submittedIssuedOn: '2026-11-01' } } },
  ])
    assert.throws(() => parseDocumentSubmission(bad));
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
  assert.equal(documentReviewState(documents, true, at, false).needsSupplement, false);
  assert.equal(documentReviewState(documents, true, at, true).needsSupplement, true);
});

test('AI summary gives pending discrepancies priority and retains unresolved counts', () => {
  const doc = {
    kind: 'SAFETY_CARD',
    status: 'PENDING',
    submittedExpiresOn: '2099-01-01',
    aiAnalysis: {
      status: 'COMPLETE',
      detectedKind: 'PERSONAL_INSURANCE',
      issuedOn: '2026-01-01',
      expiresOn: '2099-01-01',
      nationalId: null,
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

test('combined OCR cache is scoped, expires, and never stores original bytes', async (t) => {
  const image = await sharp({
    create: { width: 640, height: 480, channels: 3, background: 'white' },
  })
    .png()
    .toBuffer();
  let calls = 0;
  const local = {
    run: async () => {
      calls++;
      return {
        quality: { status: 'RETAKE', reason: 'IMAGE_BLURRY' },
        ocr: { status: 'READ', issuedOn: '2026-11-01', expiresOn: '2027-11-01', warnings: [] },
      };
    },
  } as unknown as LocalDocumentOcr;
  const service = new DocumentOcrService(local);
  const checked = await service.inspect(image, 'image/png', 'actor:site:contractor');
  assert.equal(checked.quality.status, 'RETAKE');
  await service.inspect(image, 'image/png', 'actor:site:contractor');
  assert.equal(calls, 1);
  await service.inspect(image, 'image/png', 'other-actor:site:contractor');
  assert.equal(calls, 2);
  const now = Date.now();
  t.mock.method(Date, 'now', () => now + 300001);
  await service.inspect(image, 'image/png', 'actor:site:contractor');
  assert.equal(calls, 3);
});

test('unavailable OCR remains advisory after a real image is decoded; malformed files fail', async () => {
  const image = await sharp({
    create: { width: 640, height: 480, channels: 3, background: 'white' },
  })
    .jpeg()
    .toBuffer();
  const service = new DocumentOcrService({ run: async () => null } as unknown as LocalDocumentOcr);
  assert.equal((await service.inspect(image, 'image/jpeg')).ocr.status, 'UNAVAILABLE');
  await assert.rejects(service.inspect(Buffer.from('invalid'), 'image/jpeg'));
});

test('PDF inspection shares decoding and enforces file validation when OCR is busy', async () => {
  const operations: string[] = [];
  let output: Record<string, unknown> | null = {
    valid: true,
    quality: { status: 'ACCEPTED', reason: 'IMAGE_ACCEPTED' },
    ocr: { status: 'UNREADABLE', issuedOn: null, expiresOn: null, warnings: [] },
  };
  let validation: boolean | null = true;
  const local = {
    run: async (_bytes: Buffer, _mime: string, operation: string) => {
      operations.push(operation);
      return operation === 'validate' ? { valid: validation } : output;
    },
  } as unknown as LocalDocumentOcr;
  const inspect = () =>
    new DocumentOcrService(local).inspect(
      Buffer.from('%PDF-fixture'),
      'application/pdf',
      'actor:site',
    );
  assert.equal((await inspect()).ocr.status, 'UNREADABLE');
  assert.deepEqual(operations, ['inspect']);
  output = null;
  operations.length = 0;
  assert.equal((await inspect()).ocr.status, 'UNAVAILABLE');
  assert.deepEqual(operations, ['inspect', 'validate']);
  validation = false;
  await assert.rejects(inspect(), { status: 422 });
  validation = null;
  await assert.rejects(inspect(), { status: 503 });
  output = { valid: false };
  validation = true;
  await assert.rejects(inspect(), { status: 422 });
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
    status: 'PENDING',
    aiAnalysis: { status: 'ANALYZING', token: 'private', expiresAt: 0 },
  } as WorkerDocumentEntity;
  assert.equal(summarizeAnalysis([doc]).status, 'INSUFFICIENT');
});
