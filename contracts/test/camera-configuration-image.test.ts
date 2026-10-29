import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as contracts from '../src/index.js';

// Marker-only synthetic JPEG. Browser decode remains a separate required check.
const jpeg = Buffer.from([
  255, 216, 255, 192, 0, 17, 8, 0, 80, 0, 120, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0, 255, 217,
]);
const source = () => ({
  schemaVersion: 1,
  purpose: 'REGION_CONFIGURATION',
  sourceKind: 'LIVE',
  frame: {
    cameraExternalId: 'gate-01',
    sessionId: '33333333-3333-4333-8333-333333333333',
    sequenceNumber: '9223372036854775807',
    capturedAt: '2026-10-15T08:00:00.000Z',
    width: 120,
    height: 80,
    imageDataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
    imageSha256: 'a'.repeat(64),
  },
});
const response = () => ({
  ...source(),
  siteId: '11111111-1111-4111-8111-111111111111',
  cameraId: '22222222-2222-4222-8222-222222222222',
  configurationVersion: 4,
  referenceExpiresAt: '2026-10-15T08:05:00.000Z',
});
function parse(name: string, value: unknown): unknown {
  const fn = (contracts as unknown as Record<string, unknown>)[name];
  assert.equal(typeof fn, 'function', `Missing canonical parser ${name}`);
  return (fn as (input: unknown) => unknown)(value);
}
const sourceParser = 'parseCameraConfigurationSourceImage';
const responseParser = 'parseCameraConfigurationImageResponse';

describe('purpose-specific camera configuration image', () => {
  it('accepts model-free LIVE and explicitly labeled REPLAY without analyzing evidence', () => {
    assert.deepEqual(parse(sourceParser, source()), source());
    assert.deepEqual(parse(sourceParser, { ...source(), sourceKind: 'REPLAY' }), {
      ...source(),
      sourceKind: 'REPLAY',
    });
    assert.deepEqual(parse(responseParser, response()), response());
  });

  it('returns detached values and never aliases mutable upstream objects', () => {
    const original = response();
    const parsed = parse(responseParser, original) as ReturnType<typeof response>;
    parsed.frame.width = 999;
    assert.equal(original.frame.width, 120);
  });

  it('rejects model, authorization, source URL and unknown properties at every envelope', () => {
    for (const extra of [
      { detections: [] },
      { sourceUrl: 'rtsp://private' },
      { workerId: 'worker' },
    ]) {
      assert.throws(() => parse(sourceParser, { ...source(), ...extra }));
      assert.throws(() => parse(responseParser, { ...response(), ...extra }));
      assert.throws(() =>
        parse(sourceParser, { ...source(), frame: { ...source().frame, ...extra } }),
      );
    }
  });

  it('rejects invalid purpose/version/kind and scope/revision boundaries', () => {
    for (const change of [
      { purpose: 'AI_EVIDENCE' },
      { schemaVersion: 2 },
      { sourceKind: 'UNKNOWN' },
    ]) {
      assert.throws(() => parse(sourceParser, { ...source(), ...change }));
    }
    for (const change of [
      { siteId: 'bad' },
      { cameraId: '' },
      { configurationVersion: 0 },
      { configurationVersion: 1.5 },
      { configurationVersion: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      assert.throws(() => parse(responseParser, { ...response(), ...change }));
    }
    const withScope = { ...source(), siteId: response().siteId };
    assert.throws(() => parse(sourceParser, withScope));
  });

  it('rejects invalid capture identities, dimensions, hash and timestamps', () => {
    for (const frame of [
      { sessionId: 'not-uuid' },
      { sequenceNumber: '01' },
      { sequenceNumber: '-1' },
      { sequenceNumber: '9223372036854775808' },
      { cameraExternalId: 'private\ncredential' },
      { cameraExternalId: '' },
      { width: 0 },
      { height: 63 },
      { height: 1281 },
      { width: 120.5 },
      { height: Number.NaN },
      { imageSha256: 'A'.repeat(64) },
      { imageSha256: '' },
      { capturedAt: 'yesterday' },
    ]) {
      assert.throws(() =>
        parse(sourceParser, { ...source(), frame: { ...source().frame, ...frame } }),
      );
    }
  });

  it('bounds authoring lifetime independently of monitoring TTL', () => {
    for (const referenceExpiresAt of [
      'bad',
      '2026-10-15T07:59:59.000Z',
      '2026-10-15T08:05:00.001Z',
      '2026-10-15T08:00:00.000Z',
    ]) {
      assert.throws(() => parse(responseParser, { ...response(), referenceExpiresAt }));
    }
  });

  it('rejects malformed/noncanonical base64, oversized JPEG and dimension spoofing', () => {
    for (const imageDataUrl of [
      'data:image/png;base64,/9j/2Q==',
      'data:image/jpeg;base64,A===',
      'data:image/jpeg;base64,AB==',
      `data:image/jpeg;base64,${Buffer.alloc(1_048_577).toString('base64')}`,
      'data:image/jpeg;base64,/9j/2Q==',
    ]) {
      assert.throws(() =>
        parse(sourceParser, { ...source(), frame: { ...source().frame, imageDataUrl } }),
      );
    }
    assert.throws(() =>
      parse(sourceParser, { ...source(), frame: { ...source().frame, width: 121 } }),
    );
  });

  it('uses safe fixed errors that never echo private payloads', () => {
    assert.throws(
      () => parse(sourceParser, { secret: 'do-not-log-this' }),
      (error: unknown) =>
        error instanceof Error &&
        error.message === 'Camera configuration image is unavailable or malformed',
    );
  });

  it('rejects calendar rollovers and hour24 instead of normalizing a different capture day', () => {
    for (const capturedAt of ['2026-02-30T08:00:00.000Z', '2026-10-15T24:00:00.000Z']) {
      assert.throws(() =>
        parse(sourceParser, { ...source(), frame: { ...source().frame, capturedAt } }),
      );
    }
    assert.deepEqual(
      parse(sourceParser, {
        ...source(),
        frame: { ...source().frame, capturedAt: '2028-02-29T08:00:00.000Z' },
      }),
      { ...source(), frame: { ...source().frame, capturedAt: '2028-02-29T08:00:00.000Z' } },
    );
  });

  it('rejects non-JSON object prototypes that structuredClone would strip after validation', () => {
    assert.throws(() => parse(sourceParser, Object.assign(new Date(0), source())));
    assert.throws(() =>
      parse(sourceParser, { ...source(), frame: Object.assign(new Date(0), source().frame) }),
    );
    assert.throws(() => parse(sourceParser, { ...source(), [Symbol('extra')]: true }));
  });

  it('enforces dimension bounds even when the exported JPEG decoder is called directly', () => {
    const small = Buffer.from(jpeg);
    small[7] = 0;
    small[8] = 1;
    assert.throws(() =>
      parse('decodeConfigurationJpeg', {
        ...source().frame,
        height: 1,
        imageDataUrl: `data:image/jpeg;base64,${small.toString('base64')}`,
      }),
    );
  });
});
