import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as validators from '../src/index.js';
import { computeCanonicalPayloadHash } from '../src/hashing/canonical-hash.js';

const frameId = '11111111-1111-4111-8111-111111111111';
const regionId = '22222222-2222-4222-8222-222222222222';
function event() {
  return {
    eventId: '33333333-3333-4333-8333-333333333333',
    schemaVersion: '1.4.0',
    cameraExternalId: 'CAM-1',
    streamSessionId: frameId,
    capturedAt: '2026-10-27T10:00:00.123456789Z',
    frameDimensions: { width: 1280, height: 720 },
    framePartition: { frameId, sequenceNumber: '9223372036854775807', partIndex: 1, partCount: 2 },
    observations: [
      { type: 'PERSON', trackId: 7 },
      { type: 'ZONE_ENTRY', trackId: 7, regionId, geometryVersion: 1 },
    ],
    evidence: [],
  };
}
function validate(payload: unknown) {
  const fn = (validators as unknown as Record<string, unknown>).validatePartitionedObservationEvent;
  assert.equal(typeof fn, 'function', 'explicit partitioned-frame validator must exist');
  return (fn as (data: unknown) => { isValid: boolean; issues: { path: string }[] })(payload);
}

test('explicit validator accepts exact full-precision sequence/capture metadata; legacy admission stays closed', () => {
  const payload = event();
  assert.equal(validate(payload).isValid, true);
  assert.equal(validators.validateObservationEvent(payload).isValid, false);
  assert.equal(validators.validateEightFamilyObservationEvent(payload).isValid, false);
});

test('accepts uint64 endpoints and final part index without Number coercion', () => {
  for (const sequenceNumber of ['0', '18446744073709551615']) {
    assert.equal(
      validate({
        ...event(),
        framePartition: {
          frameId,
          sequenceNumber,
          partIndex: 1023,
          partCount: 1024,
        },
      }).isValid,
      true,
    );
  }
});

for (const [field, value] of [
  ['partIndex', 2],
  ['partIndex', -1],
  ['partIndex', '1'],
  ['partIndex', true],
  ['partCount', 0],
  ['partCount', 1025],
  ['sequenceNumber', '01'],
  ['sequenceNumber', '-1'],
  ['sequenceNumber', 12],
  ['sequenceNumber', '18446744073709551616'],
  ['frameId', frameId.toUpperCase().replace('1111', 'AAAA')],
] as const) {
  test(`rejects malformed partition ${field}=${String(value)}`, () => {
    const payload = event();
    Object.assign(payload.framePartition, { [field]: value });
    assert.equal(validate(payload).isValid, false);
  });
}

test('requires partition context, rejects undeclared fields, and retains wire limits', () => {
  const missing: Partial<ReturnType<typeof event>> = { ...event() };
  delete missing.framePartition;
  assert.equal(validate(missing).isValid, false);
  assert.equal(
    validate({ ...event(), framePartition: { ...event().framePartition, workerId: 'invented' } })
      .isValid,
    false,
  );
  assert.equal(
    validate({
      ...event(),
      observations: Array.from({ length: 257 }, (_, trackId) => ({ type: 'PERSON', trackId })),
    }).isValid,
    false,
  );
});

test('each subject requires exactly one same-part PERSON; identity ambiguity remains data', () => {
  const payload = event();
  assert.equal(
    validate({ ...payload, observations: payload.observations.slice(1) }).isValid,
    false,
  );
  assert.equal(
    validate({ ...payload, observations: [payload.observations[0], ...payload.observations] })
      .isValid,
    false,
  );
  assert.equal(
    validate({
      ...payload,
      observations: [
        ...payload.observations,
        { type: 'IDENTITY_CANDIDATE', trackId: 8, status: 'UNKNOWN' },
      ],
    }).isValid,
    false,
  );
  assert.equal(
    validate({
      ...payload,
      observations: [
        ...payload.observations,
        { type: 'IDENTITY_CANDIDATE', trackId: 7, status: 'UNKNOWN' },
        { type: 'IDENTITY_CANDIDATE', trackId: 7, status: 'UNAVAILABLE' },
      ],
    }).isValid,
    true,
  );
});

test('retains hash-bound evidence and geometry semantics; JCS hash binds part context', () => {
  const payload = event();
  const evidence = { kind: 'FRAME', uri: 'local-evidence://frame.jpg', sha256: 'a'.repeat(64) };
  assert.equal(validate({ ...payload, evidence: [evidence] }).isValid, true);
  const unbound = { kind: evidence.kind, uri: evidence.uri };
  assert.equal(validate({ ...payload, evidence: [unbound] }).isValid, false);
  assert.equal(
    validate({
      ...payload,
      observations: [
        {
          type: 'PERSON',
          trackId: 7,
          boundingBox: { x1: 0.9, x2: 0.1, y1: 0, y2: 1, coordinateSpace: 'NORMALIZED_0_1' },
        },
      ],
    }).isValid,
    false,
  );
  assert.notEqual(
    computeCanonicalPayloadHash(payload),
    computeCanonicalPayloadHash({
      ...payload,
      framePartition: { ...payload.framePartition, partIndex: 0 },
    }),
  );
});
