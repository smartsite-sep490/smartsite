import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import sharp from 'sharp';
import { bindMf06FaceInvocation } from '../src/modules/safety/assessments/mf06-face-binding.js';
import type {
  Mf06CapturedRequest,
  Mf06StoredBindingInspection,
} from '../src/modules/safety/assessments/mf06-request-context.js';
import { cropSafetySubjectFrame } from '../src/modules/safety/identity/safety-subject-cropper.js';
import type { SafetySubjectCrop } from '../src/modules/safety/identity/safety-subject-cropper.js';

const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
async function fixture() {
  const request: Mf06CapturedRequest = {
    requestId: id,
    eventId: id,
    payloadHash: 'a'.repeat(64),
    personObservationIndex: 1,
    zoneObservationIndex: 2,
    subjectBindingStatus: 'BOUND',
    trackId: 5,
    siteId: id,
    cameraId: id,
    cameraExternalId: 'synthetic-camera',
    streamSessionId: id,
    regionId: id,
    geometryVersion: 1,
    zoneId: id,
    capturedAt: '2026-10-11T00:00:00.000Z',
    requestedPurpose: 'INITIAL_OBSERVATION_ASSESSMENT',
    requestRevision: 1,
    storedBindingHash: 'b'.repeat(64),
    requestedAt: '2026-10-11T00:00:01.000Z',
  };
  const subject = {
    eventId: id,
    personObservationIndex: 1,
    payloadHash: request.payloadHash,
    cameraId: id,
    cameraExternalId: request.cameraExternalId,
    streamSessionId: id,
    capturedAt: request.capturedAt,
    trackId: 5,
    personBoundingBox: {
      x1: 0.1,
      y1: 0.1,
      x2: 0.9,
      y2: 0.9,
      coordinateSpace: 'NORMALIZED_0_1' as const,
    },
  };
  const bytes = await sharp({
    create: { width: 40, height: 40, channels: 3, background: '#333333' },
  })
    .jpeg()
    .toBuffer();
  const crop = await cropSafetySubjectFrame(
    { bytes, width: 40, height: 40, sha256: createHash('sha256').update(bytes).digest('hex') },
    subject,
    { maxFrameBytes: 20000, maxFramePixels: 2000, maxCropBytes: 20000 },
  );
  const stored: Extract<Mf06StoredBindingInspection, { status: 'MATCHED' }> = {
    status: 'MATCHED',
    request,
    subject,
    contextDigest: 'c'.repeat(64),
  };
  return { stored, crop };
}

test('binding uses the real crop digest and exact stored PERSON while explicitly remaining unattested', async () => {
  const { stored, crop } = await fixture();
  const bound = bindMf06FaceInvocation(stored, crop, other, 'synthetic-v1');
  assert.equal(bound.state, 'BOUND_UNATTESTED');
  if (bound.state !== 'BOUND_UNATTESTED') return;
  assert.equal(bound.invocation.purpose, 'SAFETY_MF06');
  assert.equal(bound.invocation.cropSha256, createHash('sha256').update(crop.bytes).digest('hex'));
  assert.equal(bound.invocation.personObservationIndex, 1);
  assert.equal(bound.invocation.zoneObservationIndex, 2);
  assert.equal(bound.invocation.trackId, 5);
  assert.equal('bytes' in bound.invocation, false);
  assert.equal('workerId' in bound.invocation, false);
});

test('each invocation and original request revision has its own canonical digest', async () => {
  const { stored, crop } = await fixture();
  const values = [
    bindMf06FaceInvocation(stored, crop, id, 'synthetic-v1'),
    bindMf06FaceInvocation(stored, crop, other, 'synthetic-v1'),
    bindMf06FaceInvocation(
      { ...stored, request: { ...stored.request, requestRevision: 2 } },
      crop,
      id,
      'synthetic-v1',
    ),
    bindMf06FaceInvocation(stored, crop, id, 'synthetic-v2'),
  ];
  const digests = values.map((value) => {
    assert.equal(value.state, 'BOUND_UNATTESTED');
    return value.state === 'BOUND_UNATTESTED' ? value.invocation.bindingDigest : '';
  });
  assert.equal(new Set(digests).size, 4);
  assert.deepEqual(bindMf06FaceInvocation(stored, crop, id, 'synthetic-v1'), values[0]);
});

test('all unavailable or unbound request states stop before resolver input', async () => {
  const { stored, crop } = await fixture();
  assert.equal(
    bindMf06FaceInvocation(
      { status: 'UNAVAILABLE', reason: 'REQUEST_NOT_FOUND' },
      crop,
      id,
      'synthetic-v1',
    ).state,
    'UNAVAILABLE',
  );
  for (const status of [
    'PERSON_NOT_FOUND',
    'PERSON_BOX_UNAVAILABLE',
    'AMBIGUOUS_PERSON_TRACK',
  ] as const)
    assert.equal(
      bindMf06FaceInvocation(
        { ...stored, request: { ...stored.request, subjectBindingStatus: status } },
        crop,
        id,
        'synthetic-v1',
      ).state,
      'UNAVAILABLE',
    );
  assert.equal(
    bindMf06FaceInvocation({ ...stored, subject: null }, crop, id, 'synthetic-v1').state,
    'UNAVAILABLE',
  );
});

test('crop bytes, exact subject, timestamp and frame hash cannot be substituted', async () => {
  const { stored, crop } = await fixture();
  for (const altered of [
    { ...crop, bytes: Buffer.from('replacement') },
    { ...crop, frameSha256: '' },
    { ...crop, subject: { ...crop.subject, trackId: 6 } },
    { ...crop, subject: { ...crop.subject, capturedAt: '2026-10-11T00:00:00.001Z' } },
    {
      ...crop,
      subject: {
        ...crop.subject,
        personBoundingBox: { ...crop.subject.personBoundingBox, x1: 0.2 },
      },
    },
  ])
    assert.deepEqual(bindMf06FaceInvocation(stored, altered, id, 'synthetic-v1'), {
      state: 'UNAVAILABLE',
      reason: 'MEDIA_MISMATCH',
    });
});

test('malformed correlation metadata never produces an invocation', async () => {
  const { stored, crop } = await fixture();
  for (const changed of [
    { siteId: 'bad' },
    { zoneObservationIndex: 1 },
    { requestedPurpose: 'GATE' },
    { requestRevision: 0 },
    { geometryVersion: Infinity },
  ])
    assert.equal(
      bindMf06FaceInvocation(
        { ...stored, request: { ...stored.request, ...changed } as Mf06CapturedRequest },
        crop,
        id,
        'synthetic-v1',
      ).state,
      'UNAVAILABLE',
    );
  for (const [invocation, model] of [
    ['bad', 'synthetic-v1'],
    [id, ''],
    [id, '  '],
  ])
    assert.equal(bindMf06FaceInvocation(stored, crop, invocation!, model!).state, 'UNAVAILABLE');
  assert.equal(
    bindMf06FaceInvocation(
      stored,
      { ...crop, cropAlgorithmVersion: 'GATE' } as unknown as SafetySubjectCrop,
      id,
      'synthetic-v1',
    ).state,
    'UNAVAILABLE',
  );
});

test('equivalent raw timestamps keep their original evidence spelling instead of being rejected', async () => {
  const { stored, crop } = await fixture();
  const rawTime = '2026-10-11T07:00:00+07:00';
  const subject = { ...crop.subject, capturedAt: rawTime };
  const bound = bindMf06FaceInvocation(
    { ...stored, subject },
    { ...crop, subject },
    id,
    'synthetic-v1',
  );
  assert.equal(bound.state, 'BOUND_UNATTESTED');
  if (bound.state !== 'BOUND_UNATTESTED') return;
  assert.equal(bound.invocation.capturedAt, '2026-10-11T00:00:00.000Z');
  assert.equal(
    (bound.invocation as unknown as Record<string, unknown>).originalCapturedAt,
    rawTime,
  );
});
