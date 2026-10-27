import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { test, type TestContext } from 'node:test';
import sharp from 'sharp';
import { readMf06SubjectMedia } from '../src/modules/safety/assessments/mf06-frame-media.reader.js';
import type { Mf06FrameReference } from '../src/modules/safety/assessments/mf06-frame-reference.js';
import type { ObservationSubjectRef } from '../src/modules/safety/identity/observation-identity.types.js';
import { cropSafetySubjectFrame } from '../src/modules/safety/identity/safety-subject-cropper.js';

const EVENT_ID = '11111111-2222-4333-8444-555555555555';
const OTHER_EVENT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const SESSION_ID = '66666666-7777-4888-9999-000000000000';
const OTHER_SESSION_ID = 'ffffffff-1111-4222-8333-444444444444';
const CAMERA_ID = '22222222-3333-4444-8555-666666666666';
const PAYLOAD_HASH = 'a'.repeat(64);
const SEQUENCE = 42;
const FIXED_LIMITS = {
  maxFrameBytes: 1_048_576,
  maxFramePixels: 16_000_000,
  maxCropBytes: 1_048_576,
} as const;

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

async function makeDTempDir(t: TestContext): Promise<string> {
  const base = process.platform === 'win32' ? 'D:/Ky9-FPT/SmartSiteData/temp' : tmpdir();
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(join(base, 'mf06-frame-media-'));
  if (process.platform === 'win32') assert.match(dir, /^[dD]:[\\/]/);
  t.after(async () => {
    const target = await realpath(dir);
    assert.equal(dirname(target), await realpath(base));
    assert.ok(basename(target).startsWith('mf06-frame-media-'));
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

function makeSubject(overrides: Partial<ObservationSubjectRef> = {}): ObservationSubjectRef {
  return {
    eventId: EVENT_ID,
    personObservationIndex: 0,
    payloadHash: PAYLOAD_HASH,
    cameraId: CAMERA_ID,
    cameraExternalId: 'CAM-NORTH-01',
    streamSessionId: SESSION_ID,
    capturedAt: '2026-10-20T06:00:00Z',
    trackId: 7,
    personBoundingBox: {
      x1: 0.25,
      y1: 0.2,
      x2: 0.75,
      y2: 0.8,
      coordinateSpace: 'NORMALIZED_0_1',
    },
    ...overrides,
  };
}

function makeReference(
  digest: string,
  overrides: Partial<Mf06FrameReference> = {},
): Mf06FrameReference {
  return {
    eventId: EVENT_ID,
    streamSessionId: SESSION_ID,
    sequenceNumber: SEQUENCE,
    uri: `local://evidence/${SESSION_ID}/${SEQUENCE}/${EVENT_ID}.jpg`,
    sha256: digest,
    payloadHash: PAYLOAD_HASH,
    frameDimensions: { width: 40, height: 20 },
    ...overrides,
  };
}

function flatFileName(session = SESSION_ID, seq: number | string = SEQUENCE, event = EVENT_ID) {
  return `${session}_${seq}_${event}.jpg`;
}

test('1. real matching bytes produce expected deterministic crop and hashes', async (t) => {
  const root = await makeDTempDir(t);
  const frame = await makeSyntheticJpeg(40, 20, '#308040');
  await writeFile(join(root, flatFileName()), frame.bytes);

  const subject = makeSubject();
  const reference = makeReference(frame.sha256);
  const expected = await cropSafetySubjectFrame(frame, subject, FIXED_LIMITS);
  const actual = await readMf06SubjectMedia(root, reference, subject);

  assert.notEqual(actual, null);
  assert.deepEqual(actual, expected);
  assert.equal(actual?.frameSha256, frame.sha256);
  assert.equal(actual?.cropSha256, sha256(actual!.bytes));
  assert.deepEqual(actual?.rectangle, { left: 10, top: 4, width: 20, height: 12 });
  assert.equal(actual?.cropAlgorithmVersion, 'PERSON_FLOOR_CEIL_JPEG95_444_V1');
});

test('2. replaced bytes or JPEG dimensions mismatch return null', async (t) => {
  const root = await makeDTempDir(t);
  const original = await makeSyntheticJpeg(40, 20, '#2060c0');
  const replaced = await makeSyntheticJpeg(40, 20, '#c03020');
  const wrongDim = await makeSyntheticJpeg(32, 20, '#2060c0');
  const targetPath = join(root, flatFileName());

  await writeFile(targetPath, replaced.bytes);
  assert.equal(
    await readMf06SubjectMedia(root, makeReference(original.sha256), makeSubject()),
    null,
  );

  await writeFile(targetPath, wrongDim.bytes);
  assert.equal(
    await readMf06SubjectMedia(
      root,
      makeReference(wrongDim.sha256, { frameDimensions: { width: 40, height: 20 } }),
      makeSubject(),
    ),
    null,
  );

  await writeFile(targetPath, original.bytes);
  assert.equal(
    await readMf06SubjectMedia(
      root,
      makeReference(original.sha256, { frameDimensions: { width: 4001, height: 4000 } }),
      makeSubject(),
    ),
    null,
  );
  assert.equal(
    (await readMf06SubjectMedia(root, makeReference(original.sha256), makeSubject()))?.frameSha256,
    original.sha256,
  );
});

test('3. cross-subject, invalid reference, and pre-abort return null without accepting another frame', async (t) => {
  const root = await makeDTempDir(t);
  const validFrame = await makeSyntheticJpeg(40, 20, '#2060c0');
  const otherFrame = await makeSyntheticJpeg(40, 20, '#904010');
  await writeFile(join(root, flatFileName()), validFrame.bytes);
  await writeFile(join(root, flatFileName(SESSION_ID, SEQUENCE, OTHER_EVENT_ID)), otherFrame.bytes);
  await writeFile(join(root, flatFileName(OTHER_SESSION_ID, SEQUENCE, EVENT_ID)), otherFrame.bytes);

  const reference = makeReference(validFrame.sha256);
  const subject = makeSubject();

  for (const badSubject of [
    makeSubject({ eventId: OTHER_EVENT_ID }),
    makeSubject({ streamSessionId: OTHER_SESSION_ID }),
    makeSubject({ payloadHash: 'b'.repeat(64) }),
  ]) {
    assert.equal(await readMf06SubjectMedia(root, reference, badSubject), null);
  }

  for (const badRef of [
    makeReference(otherFrame.sha256, { eventId: OTHER_EVENT_ID }),
    makeReference(otherFrame.sha256, { streamSessionId: OTHER_SESSION_ID }),
    makeReference(validFrame.sha256, { payloadHash: 'b'.repeat(64) }),
    makeReference(otherFrame.sha256, {
      uri: `local://evidence/${SESSION_ID}/${SEQUENCE}/${OTHER_EVENT_ID}.jpg`,
    }),
    makeReference(validFrame.sha256, {
      uri: `local://evidence/${SESSION_ID}/${SEQUENCE}/../${SEQUENCE}/${EVENT_ID}.jpg`,
    }),
    makeReference(validFrame.sha256, {
      uri: `https://example.com/evidence/${SESSION_ID}/${SEQUENCE}/${EVENT_ID}.jpg`,
    }),
  ]) {
    assert.equal(await readMf06SubjectMedia(root, badRef, subject), null);
  }

  const aborted = new AbortController();
  aborted.abort();
  assert.equal(await readMf06SubjectMedia(root, reference, subject, aborted.signal), null);
  assert.equal(
    (await readMf06SubjectMedia(root, reference, subject))?.frameSha256,
    validFrame.sha256,
  );
});

test('4. oversized or missing file and root junction are refused', async (t) => {
  const parent = await makeDTempDir(t);
  const realRoot = join(parent, 'real');
  await mkdir(realRoot);
  const frame = await makeSyntheticJpeg(40, 20, '#2060c0');
  const reference = makeReference(frame.sha256);
  const subject = makeSubject();
  const targetPath = join(realRoot, flatFileName());

  assert.equal(await readMf06SubjectMedia('relative-evidence-root', reference, subject), null);
  assert.equal(await readMf06SubjectMedia(realRoot, reference, subject), null);

  const oversized = Buffer.concat([frame.bytes, Buffer.alloc(1_048_577 - frame.bytes.length)]);
  await writeFile(targetPath, oversized);
  assert.equal(
    await readMf06SubjectMedia(realRoot, makeReference(sha256(oversized)), subject),
    null,
  );

  await writeFile(targetPath, frame.bytes);
  const junctionRoot = join(parent, 'junction-root');
  await symlink(realRoot, junctionRoot, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(await readMf06SubjectMedia(junctionRoot, reference, subject), null);
  assert.equal(
    (await readMf06SubjectMedia(realRoot, reference, subject))?.frameSha256,
    frame.sha256,
  );
});

test('5. accessor properties on reference.sha256 or subject.capturedAt return null without executing getters', async (t) => {
  const root = await makeDTempDir(t);
  const frame = await makeSyntheticJpeg(40, 20, '#2060c0');
  await writeFile(join(root, flatFileName()), frame.bytes);

  let getterCalls = 0;
  const refWithShaGetter: Record<string, unknown> = { ...makeReference(frame.sha256) };
  Object.defineProperty(refWithShaGetter, 'sha256', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return frame.sha256;
    },
  });
  assert.equal(
    await readMf06SubjectMedia(
      root,
      refWithShaGetter as unknown as Mf06FrameReference,
      makeSubject(),
    ),
    null,
  );
  assert.equal(getterCalls, 0);

  const subjectWithCapturedAtGetter: Record<string, unknown> = { ...makeSubject() };
  Object.defineProperty(subjectWithCapturedAtGetter, 'capturedAt', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return '2026-10-20T06:00:00Z';
    },
  });
  assert.equal(
    await readMf06SubjectMedia(
      root,
      makeReference(frame.sha256),
      subjectWithCapturedAtGetter as unknown as ObservationSubjectRef,
    ),
    null,
  );
  assert.equal(getterCalls, 0);
});
