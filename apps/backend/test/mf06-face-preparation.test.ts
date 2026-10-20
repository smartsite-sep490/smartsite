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
import { Mf06RetryableWorkError } from '../src/modules/safety/assessments/mf06-assessment-worker.service.js';
import type { Mf06ClaimContextLookup } from '../src/modules/safety/assessments/mf06-claim-context.reader.js';
import { Mf06FacePreparation } from '../src/modules/safety/assessments/mf06-face-preparation.js';
import { readMf06SubjectMedia } from '../src/modules/safety/assessments/mf06-frame-media.reader.js';
import { selectMf06FrameReference } from '../src/modules/safety/assessments/mf06-frame-reference.js';
import type { Mf06JobClaim } from '../src/modules/safety/assessments/mf06-job-lease.service.js';
import { inspectMf06StoredBinding } from '../src/modules/safety/assessments/mf06-request-context.js';
import {
  inspectSafetyFaceResponse,
  type SafetyFaceCandidateTemplate,
  type SafetyFaceResolveInput,
} from '../src/modules/safety/assessments/safety-identity-resolver.port.js';
import type { SafetyFaceCandidateLookup } from '../src/modules/workforce/safety-face-candidate.reader.js';

const SITE_ID = '11111111-1111-4111-8111-111111111111';
const CAMERA_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const REGION_ID = '44444444-4444-4444-8444-444444444444';
const ZONE_ID = '55555555-5555-4555-8555-555555555555';
const EVENT_ID = '66666666-6666-4666-8666-666666666666';
const REQUEST_ID = '77777777-7777-4777-8777-777777777777';
const LEASE_TOKEN = '88888888-8888-4888-8888-888888888888';
const SEQUENCE = 7;
const CAPTURED_AT = '2026-10-20T06:00:00.000Z';
const MODEL_VERSION = 'arcface-r100-v1';

const CLAIM: Mf06JobClaim = Object.freeze({
  requestId: REQUEST_ID,
  leaseToken: LEASE_TOKEN,
  headRevision: 2,
  attemptCount: 1,
  leaseExpiresAt: '2026-10-20T06:05:00.000Z',
  deadlineAt: '2026-10-20T06:15:00.000Z',
});

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

async function makeDTempDir(t: TestContext): Promise<string> {
  const base = process.platform === 'win32' ? 'D:/Ky9-FPT/SmartSiteData/temp' : tmpdir();
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(join(base, 'mf06-face-prep-'));
  if (process.platform === 'win32') assert.match(dir, /^[dD]:[\\/]/);
  t.after(async () => {
    const target = await realpath(dir);
    assert.equal(dirname(target), await realpath(base));
    assert.ok(basename(target).startsWith('mf06-face-prep-'));
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

function makeCandidate(index: number): SafetyFaceCandidateTemplate {
  const hex = index.toString(16).padStart(2, '0');
  const revGroup = index.toString(16).padStart(3, '0');
  return Object.freeze({
    profileReferenceHash: hex.repeat(32),
    profileRevision: `00000000-0000-4${revGroup}-8${revGroup}-${hex.repeat(6)}`,
    encryptedTemplate: `tpl_${hex}_`.padEnd(128, 'A'),
  });
}

function makeMatchedV13Context(
  frameSha256: string,
): Extract<Mf06ClaimContextLookup, { status: 'MATCHED' }> {
  const rawPayload = {
    schemaVersion: '1.3.0',
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
      {
        type: 'PPE',
        trackId: 7,
        ppeItem: 'MASK',
        status: 'PRESENT',
        regionId: REGION_ID,
        geometryVersion: 3,
      },
    ],
    evidence: [
      {
        kind: 'FRAME',
        uri: `local://evidence/${SESSION_ID}/${SEQUENCE}/${EVENT_ID}.jpg`,
        sha256: frameSha256,
      },
    ],
  };
  const payloadHash = computeCanonicalPayloadHash(rawPayload);
  const event = Object.assign(new AiObservationEventEntity(), {
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
  });
  const request = Object.assign(new ZoneEntryAssessmentRequestEntity(), {
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
  });
  const inspected = inspectMf06StoredBinding(request, event);
  assert.equal(inspected.status, 'MATCHED');
  if (inspected.status !== 'MATCHED') throw new Error('Expected matched v1.3 binding');

  const claimContextDigest = computeCanonicalPayloadHash({
    schemaVersion: '1.0.0',
    kind: 'MF06_CLAIM_CONTEXT',
    claim: CLAIM,
    contextDigest: inspected.contextDigest,
  });
  return Object.freeze({
    status: 'MATCHED',
    claim: CLAIM,
    siteId: SITE_ID,
    request: inspected.request,
    contextDigest: inspected.contextDigest,
    claimContextDigest,
    subject: inspected.subject,
    frameReference: selectMf06FrameReference(rawPayload, inspected.request),
  });
}

test('1. matched v1.3 context reads real disk frame crop, passes defensive copies to resolver, and returns PREPARED_UNATTESTED for listed TRUSTED_SERVICE candidate', async (t) => {
  const root = await makeDTempDir(t);
  const frame = await makeSyntheticJpeg(40, 20, '#308040');
  await writeFile(join(root, flatFileName()), frame.bytes);

  const context = makeMatchedV13Context(frame.sha256);
  const candidates = [makeCandidate(1), makeCandidate(2)] as const;
  let observedInput: SafetyFaceResolveInput | null = null;

  const preparation = new Mf06FacePreparation(
    {
      async readForClaim(claim, signal) {
        assert.deepEqual(claim, CLAIM);
        assert.equal(signal?.aborted, false);
        return context;
      },
    },
    {
      async readForSafety(siteId, modelVersion, signal) {
        assert.equal(siteId, SITE_ID);
        assert.equal(modelVersion, MODEL_VERSION);
        assert.equal(signal.aborted, false);
        return { status: 'AVAILABLE', candidates };
      },
    },
    {
      async resolve(input, signal) {
        assert.equal(signal.aborted, false);
        observedInput = input;
        // Mutating resolver input buffer must not corrupt prepared media crop bytes
        input.cropBytes[0] = (input.cropBytes[0] ?? 0) ^ 0xff;
        return {
          ...input.invocation,
          state: 'CANDIDATE',
          provenance: 'TRUSTED_SERVICE',
          profileReferenceHash: candidates[1].profileReferenceHash,
          profileRevision: candidates[1].profileRevision,
        };
      },
    },
    root,
    MODEL_VERSION,
  );

  const signal = new AbortController().signal;
  const result = await preparation.prepare(CLAIM, signal);
  assert.equal(result.state, 'PREPARED_UNATTESTED');
  if (result.state !== 'PREPARED_UNATTESTED') return;

  const expectedCrop = await readMf06SubjectMedia(
    root,
    context.frameReference!,
    context.subject!,
    signal,
  );
  assert.notEqual(expectedCrop, null);
  assert.notEqual(observedInput, null);
  assert.deepEqual(result.context, context);
  assert.equal(result.media.state, 'BOUND_UNATTESTED');
  assert.deepEqual(result.media.crop.bytes, expectedCrop!.bytes);
  assert.equal(sha256(result.media.crop.bytes), result.media.invocation.cropSha256);
  assert.equal(result.media.invocation.frameSha256, frame.sha256);
  assert.deepEqual(
    inspectSafetyFaceResponse(result.media.invocation, result.response, 'TRUSTED_SERVICE'),
    {
      state: 'CANDIDATE_REFERENCE',
      profileReferenceHash: candidates[1].profileReferenceHash,
      profileRevision: candidates[1].profileRevision,
      provenance: 'TRUSTED_SERVICE',
    },
  );
  assert.equal('workerId' in result, false);
  assert.equal('authority' in result, false);
});

test('2. stage suppression prevents candidate or resolver calls when context or disk media fails, and suppresses resolver on unavailable or empty candidates', async (t) => {
  const root = await makeDTempDir(t);
  const frame = await makeSyntheticJpeg(40, 20, '#2060c0');
  const otherFrame = await makeSyntheticJpeg(40, 20, '#c03020');
  const framePath = join(root, flatFileName());
  await writeFile(framePath, frame.bytes);

  const matchedContext = makeMatchedV13Context(frame.sha256);
  const signal = new AbortController().signal;
  let candidateCalls = 0;
  let resolverCalls = 0;

  // 2a. Unavailable claim context suppresses media, candidate reader, and resolver
  const badContextPrep = new Mf06FacePreparation(
    {
      async readForClaim() {
        return { status: 'UNAVAILABLE', reason: 'CLAIM_NOT_ACTIVE' };
      },
    },
    {
      async readForSafety() {
        candidateCalls += 1;
        return { status: 'UNAVAILABLE', reason: 'READ_UNAVAILABLE' };
      },
    },
    {
      async resolve() {
        resolverCalls += 1;
        return {};
      },
    },
    join(root, 'never-touched-root'),
    MODEL_VERSION,
  );
  assert.deepEqual(await badContextPrep.prepare(CLAIM, signal), {
    state: 'UNAVAILABLE',
    reason: 'CONTEXT_UNAVAILABLE',
  });
  assert.equal(candidateCalls, 0);
  assert.equal(resolverCalls, 0);

  // 2b. Tampered disk frame bytes suppress candidate reader and resolver
  await writeFile(framePath, otherFrame.bytes);
  const badMediaPrep = new Mf06FacePreparation(
    {
      async readForClaim() {
        return matchedContext;
      },
    },
    {
      async readForSafety() {
        candidateCalls += 1;
        return { status: 'AVAILABLE', candidates: [makeCandidate(1)] };
      },
    },
    {
      async resolve() {
        resolverCalls += 1;
        return {};
      },
    },
    root,
    MODEL_VERSION,
  );
  assert.deepEqual(await badMediaPrep.prepare(CLAIM, signal), {
    state: 'UNAVAILABLE',
    reason: 'MEDIA_UNAVAILABLE',
  });
  assert.equal(candidateCalls, 0);
  assert.equal(resolverCalls, 0);

  // 2c. Unavailable or empty candidate corpus suppresses resolver invocation
  await writeFile(framePath, frame.bytes);
  for (const candidateLookup of [
    { status: 'UNAVAILABLE', reason: 'CANDIDATE_LIMIT' },
    { status: 'AVAILABLE', candidates: [] },
  ] satisfies SafetyFaceCandidateLookup[]) {
    const noCandidatePrep = new Mf06FacePreparation(
      {
        async readForClaim() {
          return matchedContext;
        },
      },
      {
        async readForSafety() {
          candidateCalls += 1;
          return candidateLookup;
        },
      },
      {
        async resolve() {
          resolverCalls += 1;
          return {};
        },
      },
      root,
      MODEL_VERSION,
    );
    assert.deepEqual(await noCandidatePrep.prepare(CLAIM, signal), {
      state: 'UNAVAILABLE',
      reason: 'CANDIDATES_UNAVAILABLE',
    });
    assert.equal(resolverCalls, 0);
  }
  assert.equal(candidateCalls, 2);
});

test('3. pre-abort, mid-await abort, correlation mismatch, unlisted candidate, or getter-poisoned response fail closed without leaking internals', async (t) => {
  const root = await makeDTempDir(t);
  const frame = await makeSyntheticJpeg(40, 20, '#308040');
  await writeFile(join(root, flatFileName()), frame.bytes);

  const context = makeMatchedV13Context(frame.sha256);
  const supplied = [makeCandidate(1), makeCandidate(2)] as const;
  const unlisted = makeCandidate(9);

  // 3a. Pre-aborted signal stops before reading claim context
  let contextCalls = 0;
  const preAborted = new AbortController();
  preAborted.abort();
  const preAbortPrep = new Mf06FacePreparation(
    {
      async readForClaim() {
        contextCalls += 1;
        return context;
      },
    },
    {
      async readForSafety() {
        return { status: 'AVAILABLE', candidates: supplied };
      },
    },
    {
      async resolve() {
        return {};
      },
    },
    root,
    MODEL_VERSION,
  );
  assert.deepEqual(await preAbortPrep.prepare(CLAIM, preAborted.signal), {
    state: 'UNAVAILABLE',
    reason: 'ABORTED',
  });
  assert.equal(contextCalls, 0);

  // 3b. Mid-await abort during resolver call fails closed as ABORTED
  const midController = new AbortController();
  const midAbortPrep = new Mf06FacePreparation(
    {
      async readForClaim() {
        return context;
      },
    },
    {
      async readForSafety() {
        return { status: 'AVAILABLE', candidates: supplied };
      },
    },
    {
      async resolve(input) {
        midController.abort();
        return {
          ...input.invocation,
          state: 'CANDIDATE',
          provenance: 'TRUSTED_SERVICE',
          profileReferenceHash: supplied[0].profileReferenceHash,
          profileRevision: supplied[0].profileRevision,
        };
      },
    },
    root,
    MODEL_VERSION,
  );
  assert.deepEqual(await midAbortPrep.prepare(CLAIM, midController.signal), {
    state: 'UNAVAILABLE',
    reason: 'ABORTED',
  });

  // 3c. Wrong correlation, unlisted candidate hash/revision, or getter-poisoned response fail closed
  let getterCalls = 0;
  for (const makeBadResponse of [
    (input: SafetyFaceResolveInput) => {
      input.invocation.bindingDigest = 'f'.repeat(64);
      return {
        ...input.invocation,
        state: 'CANDIDATE',
        provenance: 'TRUSTED_SERVICE',
        profileReferenceHash: supplied[0].profileReferenceHash,
        profileRevision: supplied[0].profileRevision,
      };
    },
    (input: SafetyFaceResolveInput) => {
      assert.ok(input.candidates[0]);
      Object.assign(input.candidates[0], unlisted);
      return {
        ...input.invocation,
        state: 'CANDIDATE',
        provenance: 'TRUSTED_SERVICE',
        profileReferenceHash: unlisted.profileReferenceHash,
        profileRevision: unlisted.profileRevision,
      };
    },
    (input: SafetyFaceResolveInput) => ({
      ...input.invocation,
      bindingDigest: 'f'.repeat(64),
      state: 'CANDIDATE',
      provenance: 'TRUSTED_SERVICE',
      profileReferenceHash: supplied[0].profileReferenceHash,
      profileRevision: supplied[0].profileRevision,
    }),
    (input: SafetyFaceResolveInput) => ({
      ...input.invocation,
      state: 'CANDIDATE',
      provenance: 'TRUSTED_SERVICE',
      profileReferenceHash: unlisted.profileReferenceHash,
      profileRevision: supplied[0].profileRevision,
    }),
    (input: SafetyFaceResolveInput) => ({
      ...input.invocation,
      state: 'CANDIDATE',
      provenance: 'TRUSTED_SERVICE',
      profileReferenceHash: supplied[0].profileReferenceHash,
      profileRevision: unlisted.profileRevision,
    }),
    (input: SafetyFaceResolveInput) => {
      const poisoned: Record<string, unknown> = {
        ...input.invocation,
        state: 'CANDIDATE',
        provenance: 'TRUSTED_SERVICE',
        profileRevision: supplied[0].profileRevision,
      };
      Object.defineProperty(poisoned, 'profileReferenceHash', {
        enumerable: true,
        get() {
          getterCalls += 1;
          return supplied[0].profileReferenceHash;
        },
      });
      return poisoned;
    },
  ]) {
    const badResolverPrep = new Mf06FacePreparation(
      {
        async readForClaim() {
          return context;
        },
      },
      {
        async readForSafety() {
          return { status: 'AVAILABLE', candidates: supplied };
        },
      },
      {
        async resolve(input) {
          return makeBadResponse(input);
        },
      },
      root,
      MODEL_VERSION,
    );
    const rejected = await badResolverPrep.prepare(CLAIM, new AbortController().signal);
    assert.equal(rejected.state, 'UNAVAILABLE');
    assert.deepEqual(Object.keys(rejected), ['state', 'reason']);
  }
  assert.equal(getterCalls, 0);
});

test('4. resolver Mf06RetryableWorkError is rethrown when signal stays active, while mid-resolver abort wins as UNAVAILABLE/ABORTED', async (t) => {
  const root = await makeDTempDir(t);
  const frame = await makeSyntheticJpeg(40, 20, '#308040');
  await writeFile(join(root, flatFileName()), frame.bytes);

  const context = makeMatchedV13Context(frame.sha256);
  const candidates = [makeCandidate(1)] as const;
  const retryableError = new Mf06RetryableWorkError('RESOLVER_UNAVAILABLE');
  let shouldAbortInResolver = false;
  const controller = new AbortController();

  const preparation = new Mf06FacePreparation(
    {
      async readForClaim() {
        return context;
      },
    },
    {
      async readForSafety() {
        return { status: 'AVAILABLE', candidates };
      },
    },
    {
      async resolve(input) {
        assert.equal(input.invocation.frameSha256, frame.sha256);
        assert.equal(input.candidates.length, 1);
        if (shouldAbortInResolver) controller.abort();
        throw retryableError;
      },
    },
    root,
    MODEL_VERSION,
  );

  await assert.rejects(
    preparation.prepare(CLAIM, new AbortController().signal),
    (error: unknown) => error === retryableError,
  );

  shouldAbortInResolver = true;
  assert.deepEqual(await preparation.prepare(CLAIM, controller.signal), {
    state: 'UNAVAILABLE',
    reason: 'ABORTED',
  });
});

test('5. identical Face inputs retain invocation and binding across lease retries, while model, candidate or media changes create a new invocation', async (t) => {
  const root = await makeDTempDir(t);
  let frame = await makeSyntheticJpeg(40, 20, '#308040');
  await writeFile(join(root, flatFileName()), frame.bytes);
  let candidates = [makeCandidate(1), makeCandidate(2)];
  async function invoke(claim = CLAIM, modelVersion = MODEL_VERSION) {
    const context = makeMatchedV13Context(frame.sha256);
    const preparation = new Mf06FacePreparation(
      {
        async readForClaim() {
          return {
            ...context,
            claim,
            claimContextDigest: sha256(Buffer.from(JSON.stringify(claim))),
          };
        },
      },
      {
        async readForSafety() {
          return { status: 'AVAILABLE', candidates };
        },
      },
      {
        async resolve(input) {
          return {
            ...input.invocation,
            state: 'CANDIDATE',
            provenance: 'TRUSTED_SERVICE',
            profileReferenceHash: input.candidates[0]!.profileReferenceHash,
            profileRevision: input.candidates[0]!.profileRevision,
          };
        },
      },
      root,
      modelVersion,
    );
    const result = await preparation.prepare(claim, new AbortController().signal);
    assert.equal(result.state, 'PREPARED_UNATTESTED');
    if (result.state !== 'PREPARED_UNATTESTED') throw new Error('Expected actual prepared media');
    return result.media.invocation;
  }
  const first = await invoke();
  const repeated = await invoke();
  assert.equal(repeated.invocationId, first.invocationId);
  assert.equal(repeated.bindingDigest, first.bindingDigest);
  const reclaimed = await invoke({
    ...CLAIM,
    leaseToken: '99999999-9999-4999-8999-999999999999',
    headRevision: 4,
    attemptCount: 2,
  });
  assert.equal(reclaimed.invocationId, first.invocationId);
  assert.equal(reclaimed.bindingDigest, first.bindingDigest);
  const changedModel = await invoke(CLAIM, 'arcface-r100-v2');
  assert.notEqual(changedModel.invocationId, first.invocationId);
  candidates = [makeCandidate(2), makeCandidate(1)];
  assert.notEqual((await invoke()).invocationId, first.invocationId);
  candidates = [makeCandidate(1), { ...makeCandidate(2), encryptedTemplate: 'B'.repeat(128) }];
  assert.notEqual((await invoke()).invocationId, first.invocationId);
  candidates = [makeCandidate(1), makeCandidate(2)];
  frame = await makeSyntheticJpeg(40, 20, '#804030');
  await writeFile(join(root, flatFileName()), frame.bytes);
  const changedMedia = await invoke();
  assert.notEqual(changedMedia.invocationId, first.invocationId);
  assert.notEqual(changedMedia.cropSha256, first.cropSha256);
});
