import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import sharp from 'sharp';
import type { ObservationSubjectRef } from '../src/modules/safety/identity/observation-identity.types.js';
import { cropSafetySubjectFrame } from '../src/modules/safety/identity/safety-subject-cropper.js';

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const subject = (): ObservationSubjectRef => ({
  eventId: '11111111-1111-4111-8111-111111111111',
  payloadHash: 'a'.repeat(64),
  personObservationIndex: 2,
  cameraId: '22222222-2222-4222-8222-222222222222',
  cameraExternalId: 'synthetic-camera',
  streamSessionId: '33333333-3333-4333-8333-333333333333',
  capturedAt: '2026-10-02T00:00:00Z',
  trackId: 7,
  personBoundingBox: { x1: 0.25, y1: 0.2, x2: 0.75, y2: 0.8, coordinateSpace: 'NORMALIZED_0_1' },
});
const limits = { maxFrameBytes: 1_048_576, maxFramePixels: 10_000, maxCropBytes: 1_048_576 };
async function frame() {
  const bytes = await sharp({
    create: { width: 40, height: 20, channels: 3, background: '#c03020' },
  })
    .jpeg()
    .toBuffer();
  return { bytes, sha256: digest(bytes), width: 40, height: 20 };
}

test('crop retains separate frame/crop hashes, exact subject and no-resize rectangle', async () => {
  const input = await frame(),
    ref = subject();
  const result = await cropSafetySubjectFrame(input, ref, limits);
  assert.deepEqual(result.rectangle, { left: 10, top: 4, width: 20, height: 12 });
  assert.equal(result.frameSha256, input.sha256);
  assert.equal(result.cropSha256, digest(result.bytes));
  assert.notEqual(result.cropSha256, input.sha256);
  assert.deepEqual(result.subject, ref);
  assert.equal(result.cropAlgorithmVersion, 'PERSON_FLOOR_CEIL_JPEG95_444_V1');
  const metadata = await sharp(result.bytes).metadata();
  assert.equal(metadata.width, 20);
  assert.equal(metadata.height, 12);
  assert.equal(metadata.format, 'jpeg');
  assert.equal(metadata.exif, undefined);
  assert.equal('workerId' in result, false);
  assert.equal('verified' in result, false);
});

test('fractional pixel edges use covering floor/ceil and permit full-frame boundary', async () => {
  const input = await frame(),
    ref = subject();
  ref.personBoundingBox = {
    x1: 0.251,
    y1: 0.201,
    x2: 0.751,
    y2: 0.801,
    coordinateSpace: 'NORMALIZED_0_1',
  };
  const result = await cropSafetySubjectFrame(input, ref, limits);
  assert.deepEqual(result.rectangle, { left: 10, top: 4, width: 21, height: 13 });
  ref.personBoundingBox = { x1: 0, y1: 0, x2: 1, y2: 1, coordinateSpace: 'NORMALIZED_0_1' };
  const full = await cropSafetySubjectFrame(input, ref, limits);
  assert.deepEqual(full.rectangle, { left: 0, top: 0, width: 40, height: 20 });
});

test('crop pixels come from the selected region, not another person-sized region', async () => {
  const pixels = Buffer.alloc(40 * 20 * 3);
  for (let y = 0; y < 20; y++) {
    for (let x = 0; x < 40; x++) {
      const offset = (y * 40 + x) * 3;
      pixels[offset + (x < 20 ? 0 : 2)] = 240;
    }
  }
  const bytes = await sharp(pixels, { raw: { width: 40, height: 20, channels: 3 } })
    .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
    .toBuffer();
  const ref = subject();
  ref.personBoundingBox = {
    x1: 0.6,
    y1: 0.2,
    x2: 0.9,
    y2: 0.8,
    coordinateSpace: 'NORMALIZED_0_1',
  };
  const result = await cropSafetySubjectFrame(
    { bytes, sha256: digest(bytes), width: 40, height: 20 },
    ref,
    limits,
  );
  const { data, info } = await sharp(result.bytes)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 3);
  for (let offset = 0; offset < data.length; offset += 3) {
    assert.ok(data[offset]! < 20, 'red background/person region must not enter this crop');
    assert.ok(data[offset + 2]! > 220, 'selected blue region must survive JPEG encoding');
  }
});

test('input buffers and subject changes after starting do not alter crop binding', async () => {
  const input = await frame(),
    ref = subject(),
    original = structuredClone(ref);
  const pending = cropSafetySubjectFrame(input, ref, limits);
  input.bytes.fill(0);
  ref.personBoundingBox.x1 = 0;
  ref.trackId = 99;
  const result = await pending;
  assert.deepEqual(result.subject, original);
  assert.deepEqual(result.rectangle, { left: 10, top: 4, width: 20, height: 12 });
});

test('tampered bytes and dimensions fail before a crop is returned', async () => {
  const input = await frame();
  await assert.rejects(
    cropSafetySubjectFrame({ ...input, sha256: 'b'.repeat(64) }, subject(), limits),
    { message: 'Safety subject frame rejected: FRAME_DIGEST_MISMATCH' },
  );
  await assert.rejects(cropSafetySubjectFrame({ ...input, width: 41 }, subject(), limits), {
    message: 'Safety subject frame rejected: FRAME_DIMENSIONS_MISMATCH',
  });
});

test('invalid normalized boxes, track and subject anchors are rejected, never clamped', async () => {
  const input = await frame();
  for (const ref of [
    { ...subject(), trackId: Number.NaN },
    { ...subject(), personObservationIndex: 256 },
    { ...subject(), payloadHash: 'not-a-hash' },
    { ...subject(), personBoundingBox: { ...subject().personBoundingBox, x1: -0.01 } },
    {
      ...subject(),
      personBoundingBox: { ...subject().personBoundingBox, x2: Number.POSITIVE_INFINITY },
    },
    { ...subject(), personBoundingBox: { ...subject().personBoundingBox, y1: 0.8 } },
  ])
    await assert.rejects(cropSafetySubjectFrame(input, ref, limits), {
      message: 'Safety subject frame rejected: SUBJECT_INVALID',
    });
});

test('non-JPEG, truncated JPEG and rotated EXIF frames are rejected without leaking decoder details', async () => {
  const original = await frame();
  const png = await sharp(original.bytes).png().toBuffer();
  const truncated = original.bytes.subarray(0, original.bytes.length - 30);
  const rotated = await sharp(original.bytes).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  for (const bytes of [png, truncated, rotated]) {
    await assert.rejects(
      cropSafetySubjectFrame({ ...original, bytes, sha256: digest(bytes) }, subject(), limits),
      (error: Error) => {
        assert.match(
          error.message,
          /^Safety subject frame rejected: FRAME_(INVALID|ORIENTATION_UNSUPPORTED)$/,
        );
        assert.equal('cause' in error, false);
        return true;
      },
    );
  }
});

test('frame byte/pixel and output bounds reject instead of bypassing limits', async () => {
  const input = await frame();
  for (const overrides of [{ maxFrameBytes: 1 }, { maxFramePixels: 799 }, { maxCropBytes: 1 }]) {
    await assert.rejects(cropSafetySubjectFrame(input, subject(), { ...limits, ...overrides }), {
      message: 'Safety subject frame rejected: RESOURCE_LIMIT',
    });
  }
  for (const maxFramePixels of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
    await assert.rejects(cropSafetySubjectFrame(input, subject(), { ...limits, maxFramePixels }), {
      message: 'Safety subject frame rejected: LIMITS_INVALID',
    });
  }
});
