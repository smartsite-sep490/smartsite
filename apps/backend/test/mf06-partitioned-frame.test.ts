import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { selectMf06FrameReference } from '../src/modules/safety/assessments/mf06-frame-reference.js';
import { validateMf06ObservationEvent } from '../src/modules/safety/assessments/mf06-observation-event.js';
import {
  readMf06FrameMedia,
  readMf06SubjectMedia,
} from '../src/modules/safety/assessments/mf06-frame-media.reader.js';
import { readConsistentMf06RawEvent } from '../src/modules/safety/assessments/mf06-observation-event.js';
import { AiObservationEventEntity } from '../src/database/entities/ai-observation-event.entity.js';

const session = '11111111-1111-4111-8111-111111111111';
const eventId = '22222222-2222-4222-8222-222222222222';
const frameId = '33333333-3333-4333-8333-333333333333';
function fixture(sequenceNumber = '18446744073709551615', sha256 = 'a'.repeat(64)) {
  const raw = {
    schemaVersion: '1.4.0',
    eventId,
    streamSessionId: session,
    cameraExternalId: 'CAM-1',
    capturedAt: '2026-10-27T12:00:00.123456789Z',
    frameDimensions: { width: 16, height: 16 },
    framePartition: { frameId, sequenceNumber, partIndex: 1, partCount: 2 },
    observations: [
      { type: 'PERSON', trackId: 7 },
      {
        type: 'ZONE_ENTRY',
        trackId: 7,
        regionId: '44444444-4444-4444-8444-444444444444',
        geometryVersion: 1,
      },
    ],
    evidence: [
      {
        kind: 'FRAME',
        uri: `local://evidence/${session}/${sequenceNumber}/${eventId}.jpg`,
        sha256,
      },
    ],
  };
  return {
    raw,
    expected: { eventId, streamSessionId: session, payloadHash: computeCanonicalPayloadHash(raw) },
  };
}

test('MF06 selects v1.4 part-local immutable frame metadata and full-precision sequence', () => {
  const { raw, expected } = fixture();
  assert.equal(validateMf06ObservationEvent(raw).isValid, true);
  const ref = selectMf06FrameReference(raw, expected);
  assert(ref);
  assert.equal(ref.sequenceNumber, '18446744073709551615');
  assert.deepEqual(ref.framePartition, raw.framePartition);
  assert(Object.isFrozen(ref.framePartition));
  raw.framePartition.partIndex = 0;
  assert.equal(ref.framePartition?.partIndex, 1);
  assert.equal(selectMf06FrameReference(raw, expected), null);
});

test('part, source sequence and evidence event/session must agree even with a recomputed payload hash', () => {
  const original = fixture('9007199254740993');
  for (const uri of [
    original.raw.evidence[0]!.uri.replace('9007199254740993', '9007199254740992'),
    original.raw.evidence[0]!.uri.replace(eventId, frameId),
    original.raw.evidence[0]!.uri.replace(session, frameId),
  ]) {
    const raw = { ...original.raw, evidence: [{ ...original.raw.evidence[0]!, uri }] };
    assert.equal(
      selectMf06FrameReference(raw, {
        ...original.expected,
        payloadHash: computeCanonicalPayloadHash(raw),
      }),
      null,
    );
  }
});

test('reads real hash-bound JPEG with uint64 sequence while refusing tampered content or partition', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mf06-part-frame-'));
  const bytes = await sharp({
    create: { width: 16, height: 16, channels: 3, background: '#208070' },
  })
    .jpeg()
    .toBuffer();
  const { raw, expected } = fixture(
    '18446744073709551615',
    createHash('sha256').update(bytes).digest('hex'),
  );
  const ref = selectMf06FrameReference(raw, expected);
  assert(ref);
  await writeFile(join(root, `${session}_${ref.sequenceNumber}_${eventId}.jpg`), bytes);
  assert.equal((await readMf06FrameMedia(root, ref))?.sha256, ref.sha256);
  assert.equal(
    await readMf06FrameMedia(root, {
      ...ref,
      framePartition: { ...raw.framePartition, sequenceNumber: '1' },
    }),
    null,
  );
  assert.equal(await readMf06FrameMedia(root, { ...ref, sha256: 'b'.repeat(64) }), null);
  const subject = {
    eventId,
    streamSessionId: session,
    personObservationIndex: 0,
    cameraId: frameId,
    cameraExternalId: raw.cameraExternalId,
    capturedAt: raw.capturedAt,
    payloadHash: expected.payloadHash,
    trackId: 7,
    personBoundingBox: {
      x1: 0.25,
      y1: 0.25,
      x2: 0.75,
      y2: 0.75,
      coordinateSpace: 'NORMALIZED_0_1' as const,
    },
  };
  const crop = await readMf06SubjectMedia(root, ref, subject);
  assert.equal(crop?.frameSha256, ref.sha256);
  assert.deepEqual(crop?.rectangle, { left: 4, top: 4, width: 8, height: 8 });
  assert.equal(await readMf06SubjectMedia(root, ref, { ...subject, eventId: frameId }), null);
  assert.equal(
    await readMf06SubjectMedia(root, ref, { ...subject, payloadHash: 'b'.repeat(64) }),
    null,
  );
});

test('stored v1.4 raw reader requires the original hash and consistent persisted scope', () => {
  const { raw, expected } = fixture('42');
  const saved = Object.assign(new AiObservationEventEntity(), {
    eventId,
    streamSessionId: session,
    cameraExternalId: raw.cameraExternalId,
    capturedAt: new Date(raw.capturedAt),
    payloadHash: expected.payloadHash,
    rawPayload: raw,
  });
  assert.deepEqual(readConsistentMf06RawEvent(saved), raw);
  saved.rawPayload = { ...raw, framePartition: { ...raw.framePartition, partIndex: 0 } };
  assert.equal(readConsistentMf06RawEvent(saved), null);
  saved.rawPayload = raw;
  saved.cameraExternalId = 'OTHER';
  assert.equal(readConsistentMf06RawEvent(saved), null);
});
