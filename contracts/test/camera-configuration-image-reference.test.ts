import assert from 'node:assert/strict';
import { it } from 'node:test';
import * as imageContracts from '../src/camera-configuration-image.js';
import * as publicContracts from '../src/index.js';

const reference = () => ({
  schemaVersion: '1.0.0',
  purpose: 'REGION_CONFIGURATION',
  sourceKind: 'LIVE',
  referenceId: '10000000-0000-4000-8000-000000000001',
  siteId: '20000000-0000-4000-8000-000000000001',
  cameraId: '30000000-0000-4000-8000-000000000001',
  sessionId: '40000000-0000-4000-8000-000000000001',
  imageSha256: 'a'.repeat(64),
  width: 1280,
  height: 720,
  capturedAt: '2026-10-26T05:00:00.000Z',
  issuedAt: '2026-10-26T05:00:01.000Z',
  expiresAt: '2026-10-26T05:05:00.000Z',
  configurationVersion: 3,
  viewRevision: 2,
});
function parse(value: unknown): ReturnType<typeof reference> {
  const fn = (imageContracts as unknown as Record<string, unknown>)
    .parseCameraConfigurationImageReference;
  assert.equal(typeof fn, 'function', 'Missing canonical reference parser');
  return (fn as (input: unknown) => ReturnType<typeof reference>)(value);
}

it('accepts detached LIVE and labelled REPLAY references without asserting issuance', () => {
  assert.equal(
    publicContracts.parseCameraConfigurationImageReference,
    imageContracts.parseCameraConfigurationImageReference,
  );
  const original = reference();
  const result = parse(original);
  assert.deepEqual(result, original);
  result.width = 64;
  assert.equal(original.width, 1280);
  assert.equal(parse({ ...original, sourceKind: 'REPLAY' }).sourceKind, 'REPLAY');
});

it('rejects missing, unknown, prototype and secret/evidence fields', () => {
  for (const key of Object.keys(reference())) {
    const broken = { ...reference() } as Record<string, unknown>;
    delete broken[key];
    assert.throws(() => parse(broken), key);
  }
  for (const key of ['imageDataUrl', 'sourceUrl', 'token', 'workerId', 'loaded', 'detections'])
    assert.throws(() => parse({ ...reference(), [key]: 'untrusted' }), key);
  assert.throws(() => parse(Object.assign(Object.create({ inherited: true }), reference())));
  assert.throws(() => parse({ ...reference(), [Symbol('hidden')]: true }));
});

it('validates UUIDs, versions, dimensions, kind and immutable image digest', () => {
  for (const key of ['referenceId', 'siteId', 'cameraId', 'sessionId'])
    assert.throws(() => parse({ ...reference(), [key]: 'not-uuid' }));
  for (const key of ['configurationVersion', 'viewRevision'])
    for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, '1', true])
      assert.throws(() => parse({ ...reference(), [key]: value }));
  for (const key of ['width', 'height'])
    for (const value of [63, 1281, 64.5, '720'])
      assert.throws(() => parse({ ...reference(), [key]: value }));
  for (const imageSha256 of ['A'.repeat(64), 'a'.repeat(63), 'g'.repeat(64)])
    assert.throws(() => parse({ ...reference(), imageSha256 }));
  for (const delta of [{ sourceKind: 'UNKNOWN' }, { purpose: 'MONITORING' }, { schemaVersion: 1 }])
    assert.throws(() => parse({ ...reference(), ...delta }));
});

it('bounds expiry using capture as well as issuance without trusting client current time', () => {
  assert.deepEqual(parse(reference()), reference()); // Historical transport is structurally valid; server checks current expiry.
  for (const delta of [
    { expiresAt: '2026-10-26T05:00:01.000Z' },
    { expiresAt: '2026-10-26T05:05:00.001Z' },
    { issuedAt: '2026-10-26T05:00:02.001Z' },
    { capturedAt: '2026-10-26T05:00:02.001Z' },
  ])
    assert.throws(() => parse({ ...reference(), ...delta }));
  assert.equal(
    parse({
      ...reference(),
      capturedAt: '2026-10-26T05:00:02.000Z',
      expiresAt: '2026-10-26T05:05:01.000Z',
    }).sourceKind,
    'LIVE',
  );
});

it('rejects invalid calendar times, nonfinite and disguised timestamps', () => {
  for (const key of ['capturedAt', 'issuedAt', 'expiresAt'])
    for (const value of [
      '2026-02-29T05:00:00Z',
      '2026-10-26T24:00:00Z',
      '2026-10-26T05:00:60Z',
      'Infinity',
      0,
    ])
      assert.throws(() => parse({ ...reference(), [key]: value }));
});

it('retains valid offset timestamps and does not mutate supplied reference', () => {
  const input = {
    ...reference(),
    capturedAt: '2026-10-26T12:00:00+07:00',
    issuedAt: '2026-10-26T12:00:01+07:00',
    expiresAt: '2026-10-26T12:05:00+07:00',
  };
  assert.deepEqual(parse(input), input);
  assert.deepEqual(parse(Object.freeze(input)), input);
});
