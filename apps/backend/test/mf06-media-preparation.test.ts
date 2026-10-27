import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import sharp from 'sharp';
import { AiObservationEventEntity } from '../src/database/entities/ai-observation-event.entity.js';
import { EventProcessingStatus } from '../src/database/entities/enums.js';
import { ZoneEntryAssessmentRequestEntity } from '../src/database/entities/zone-entry-assessment-request.entity.js';
import type { Mf06ClaimContextLookup } from '../src/modules/safety/assessments/mf06-claim-context.reader.js';
import { bindMf06FaceInvocation } from '../src/modules/safety/assessments/mf06-face-binding.js';
import { readMf06SubjectMedia } from '../src/modules/safety/assessments/mf06-frame-media.reader.js';
import { selectMf06FrameReference } from '../src/modules/safety/assessments/mf06-frame-reference.js';
import type { Mf06JobClaim } from '../src/modules/safety/assessments/mf06-job-lease.service.js';
import { prepareMf06FaceMedia } from '../src/modules/safety/assessments/mf06-media-preparation.js';
import { inspectMf06StoredBinding } from '../src/modules/safety/assessments/mf06-request-context.js';

const SITE_ID = '11111111-1111-4111-8111-111111111111';
const CAMERA_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const REGION_ID = '44444444-4444-4444-8444-444444444444';
const ZONE_ID = '55555555-5555-4555-8555-555555555555';
const EVENT_ID = '66666666-6666-4666-8666-666666666666';
const REQUEST_ID = '77777777-7777-4777-8777-777777777777';
const LEASE_TOKEN = '88888888-8888-4888-8888-888888888888';
const INVOCATION_ID = '99999999-9999-4999-8999-999999999999';
const OTHER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SEQUENCE = 7;
const CAPTURED_AT = '2026-10-20T06:00:00.000Z';
const MODEL_VERSION = 'synthetic-face-v1';

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

async function makeDTempDir(t: TestContext): Promise<string> {
  const base = process.platform === 'win32' ? 'D:/Ky9-FPT/SmartSiteData/temp' : tmpdir();
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(join(base, 'mf06-media-prep-'));
  if (process.platform === 'win32') assert.match(dir, /^[dD]:[\\/]/);
  t.after(async () => {
    const target = await realpath(dir);
    assert.equal(dirname(target), await realpath(base));
    assert.ok(basename(target).startsWith('mf06-media-prep-'));
    await rm(target, { recursive: true, force: true });
  });
  return dir;
}

async function makeSyntheticJpeg(width = 40, height = 20, background = '#2060c0') {
  const bytes = await sharp({
    create: { width, height, channels: 3, background },
  })
    .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
    .toBuffer();
  return { bytes, sha256: sha256(bytes), width, height };
}

function flatFileName(session = SESSION_ID, seq: number | string = SEQUENCE, event = EVENT_ID) {
  return `${session}_${seq}_${event}.jpg`;
}

function makeMatchedClaimContext(
  frameSha256: string,
  eventVersion: '1.0.0' | '1.2.0' = '1.2.0',
): Extract<Mf06ClaimContextLookup, { status: 'MATCHED' }> {
  const rawPayload = {
    schemaVersion: eventVersion,
    eventId: EVENT_ID,
    cameraExternalId: 'CAM-NORTH-01',
    streamSessionId: SESSION_ID,
    capturedAt: CAPTURED_AT,
    frameDimensions: { width: 40, height: 20 },
    observations: [
      {
        type: 'PERSON',
        trackId: 7,
        boundingBox: {
          x1: 0.25,
          y1: 0.2,
          x2: 0.75,
          y2: 0.8,
          coordinateSpace: 'NORMALIZED_0_1',
        },
      },
      {
        type: 'ZONE_ENTRY',
        trackId: 7,
        regionId: REGION_ID,
        geometryVersion: 3,
      },
    ],
    evidence:
      eventVersion === '1.2.0'
        ? [
            {
              kind: 'FRAME',
              uri: `local://evidence/${SESSION_ID}/${SEQUENCE}/${EVENT_ID}.jpg`,
              sha256: frameSha256,
            },
          ]
        : [{ kind: 'FRAME', uri: `local://evidence/${SESSION_ID}/${SEQUENCE}/${EVENT_ID}.jpg` }],
  };
  const payloadHash = computeCanonicalPayloadHash(rawPayload);
  const event: AiObservationEventEntity = {
    eventId: EVENT_ID,
    payloadHash,
    cameraExternalId: 'CAM-NORTH-01',
    resolvedCameraId: CAMERA_ID,
    streamSessionId: SESSION_ID,
    capturedAt: new Date(CAPTURED_AT),
    receivedAt: new Date('2026-10-20T06:00:01.000Z'),
    rawPayload,
    processingStatus: EventProcessingStatus.PROCESSED,
    processingNote: null,
    createdAt: new Date('2026-10-20T06:00:01.000Z'),
  };
  const request: ZoneEntryAssessmentRequestEntity = {
    requestId: REQUEST_ID,
    eventId: EVENT_ID,
    payloadHash,
    personObservationIndex: 0,
    zoneObservationIndex: 1,
    subjectBindingStatus: 'BOUND',
    trackId: 7,
    siteId: SITE_ID,
    cameraId: CAMERA_ID,
    cameraExternalId: 'CAM-NORTH-01',
    streamSessionId: SESSION_ID,
    regionId: REGION_ID,
    geometryVersion: 3,
    zoneId: ZONE_ID,
    capturedAt: new Date(CAPTURED_AT),
    requestedPurpose: 'INITIAL_OBSERVATION_ASSESSMENT',
    requestRevision: 1,
    bindingHash: 'b'.repeat(64),
    requestedAt: new Date('2026-10-20T06:00:02.000Z'),
  };
  const inspected = inspectMf06StoredBinding(request, event);
  assert.equal(inspected.status, 'MATCHED');
  if (inspected.status !== 'MATCHED') throw new Error('Expected matched binding');

  const claim: Mf06JobClaim = Object.freeze({
    requestId: REQUEST_ID,
    leaseToken: LEASE_TOKEN,
    headRevision: 2,
    attemptCount: 1,
    leaseExpiresAt: '2026-10-20T06:05:00.000Z',
    deadlineAt: '2026-10-20T06:15:00.000Z',
  });
  const claimContextDigest = computeCanonicalPayloadHash({
    schemaVersion: '1.0.0',
    kind: 'MF06_CLAIM_CONTEXT',
    claim,
    contextDigest: inspected.contextDigest,
  });
  return Object.freeze({
    status: 'MATCHED',
    claim,
    siteId: SITE_ID,
    request: inspected.request,
    contextDigest: inspected.contextDigest,
    claimContextDigest,
    subject: inspected.subject,
    frameReference: selectMf06FrameReference(rawPayload, inspected.request),
  });
}

test('1. matched v1.2 claim context with verified disk frame produces BOUND_UNATTESTED with exact crop and face invocation', async (t) => {
  const root = await makeDTempDir(t);
  const frame = await makeSyntheticJpeg(40, 20, '#308040');
  await writeFile(join(root, flatFileName()), frame.bytes);

  const context = makeMatchedClaimContext(frame.sha256, '1.2.0');
  const controller = new AbortController();
  const prepared = await prepareMf06FaceMedia(
    context,
    root,
    INVOCATION_ID,
    MODEL_VERSION,
    controller.signal,
  );

  assert.equal(prepared.state, 'BOUND_UNATTESTED');
  if (prepared.state !== 'BOUND_UNATTESTED') return;

  const expectedCrop = await readMf06SubjectMedia(
    root,
    context.frameReference!,
    context.subject!,
    controller.signal,
  );
  assert.notEqual(expectedCrop, null);
  const expectedBound = bindMf06FaceInvocation(
    context,
    expectedCrop!,
    INVOCATION_ID,
    MODEL_VERSION,
  );
  assert.equal(expectedBound.state, 'BOUND_UNATTESTED');
  if (expectedBound.state !== 'BOUND_UNATTESTED') return;

  assert.deepEqual(prepared.crop, expectedCrop);
  assert.deepEqual(prepared.invocation, expectedBound.invocation);
  assert.equal(prepared.invocation.frameSha256, frame.sha256);
  assert.equal(prepared.crop.frameSha256, frame.sha256);
  assert.equal('workerId' in prepared, false);
  assert.equal('profileReferenceHash' in prepared, false);
});

test('2. unavailable context, legacy/missing frame, or unbound subject returns no prepared media', async (t) => {
  const root = await makeDTempDir(t);
  const frame = await makeSyntheticJpeg(40, 20, '#2060c0');
  await writeFile(join(root, flatFileName()), frame.bytes);

  const v12Context = makeMatchedClaimContext(frame.sha256, '1.2.0');
  const legacyV10Context = makeMatchedClaimContext(frame.sha256, '1.0.0');
  assert.equal(legacyV10Context.frameReference, null);

  const signal = new AbortController().signal;
  for (const rejectedContext of [
    { status: 'UNAVAILABLE', reason: 'CLAIM_NOT_ACTIVE' } as const,
    legacyV10Context,
    { ...v12Context, frameReference: null },
    { ...v12Context, subject: null },
    {
      ...v12Context,
      request: { ...v12Context.request, subjectBindingStatus: 'PERSON_NOT_FOUND' as const },
    },
  ]) {
    const res = await prepareMf06FaceMedia(
      rejectedContext,
      join(root, 'non-existent-root-never-touched'),
      INVOCATION_ID,
      MODEL_VERSION,
      signal,
    );
    assert.equal(res.state, 'UNAVAILABLE');
    assert.equal('invocation' in res, false);
    assert.equal('crop' in res, false);
  }
});

test('3. mismatched bound frame SHA, tampered disk bytes, or invalid binding parameters return UNAVAILABLE', async (t) => {
  const root = await makeDTempDir(t);
  const original = await makeSyntheticJpeg(40, 20, '#2060c0');
  const replaced = await makeSyntheticJpeg(40, 20, '#c03020');
  const targetPath = join(root, flatFileName());

  const context = makeMatchedClaimContext(original.sha256, '1.2.0');
  const signal = new AbortController().signal;

  // Disk bytes replaced after event ingestion
  await writeFile(targetPath, replaced.bytes);
  const onReplacedBytes = await prepareMf06FaceMedia(
    context,
    root,
    INVOCATION_ID,
    MODEL_VERSION,
    signal,
  );
  assert.equal(onReplacedBytes.state, 'UNAVAILABLE');

  // Reference SHA altered away from bound context / disk bytes
  await writeFile(targetPath, original.bytes);
  const mismatchedRefSha = {
    ...context,
    frameReference: { ...context.frameReference!, sha256: replaced.sha256 },
  };
  assert.equal(
    (await prepareMf06FaceMedia(mismatchedRefSha, root, INVOCATION_ID, MODEL_VERSION, signal))
      .state,
    'UNAVAILABLE',
  );

  // Reference payloadHash or eventId out of sync with bound request/subject
  for (const badRef of [
    { ...context.frameReference!, payloadHash: 'f'.repeat(64) },
    { ...context.frameReference!, eventId: OTHER_ID },
  ]) {
    assert.equal(
      (
        await prepareMf06FaceMedia(
          { ...context, frameReference: badRef },
          root,
          INVOCATION_ID,
          MODEL_VERSION,
          signal,
        )
      ).state,
      'UNAVAILABLE',
    );
  }

  // Invalid binder invocationId or modelVersion
  assert.equal(
    (await prepareMf06FaceMedia(context, root, 'invalid-uuid', MODEL_VERSION, signal)).state,
    'UNAVAILABLE',
  );
  assert.equal(
    (await prepareMf06FaceMedia(context, root, INVOCATION_ID, '   ', signal)).state,
    'UNAVAILABLE',
  );
});

test('4. pre-aborted signal and accessor properties on context fail closed as UNAVAILABLE', async (t) => {
  const root = await makeDTempDir(t);
  const frame = await makeSyntheticJpeg(40, 20, '#2060c0');
  await writeFile(join(root, flatFileName()), frame.bytes);

  const context = makeMatchedClaimContext(frame.sha256, '1.2.0');
  const aborted = new AbortController();
  aborted.abort();
  assert.equal(
    (await prepareMf06FaceMedia(context, root, INVOCATION_ID, MODEL_VERSION, aborted.signal)).state,
    'UNAVAILABLE',
  );

  let getterCalls = 0;
  const refWithGetter: Record<string, unknown> = { ...context.frameReference! };
  Object.defineProperty(refWithGetter, 'sha256', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return frame.sha256;
    },
  });
  const res = await prepareMf06FaceMedia(
    { ...context, frameReference: refWithGetter as unknown as typeof context.frameReference },
    root,
    INVOCATION_ID,
    MODEL_VERSION,
    new AbortController().signal,
  );
  assert.equal(res.state, 'UNAVAILABLE');
  assert.equal(getterCalls, 0);
});
