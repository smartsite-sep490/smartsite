import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { computeCanonicalPayloadHash } from '../src/hashing/canonical-hash.js';
import { parseCameraPolicyConfigurationBundlePayload as legacy } from '../src/camera-policy-configuration-bundle.js';
import { PPE_ITEMS } from '../src/ppe-items.js';

const path = '../src/camera-policy-configuration-bundle-v21.js';
const api = await import(path).catch(() => ({}));
const parse = (payload: string | Uint8Array) => {
  const decoder = api.parseCameraPolicyConfigurationBundleV21Payload as
    | ((value: string | Uint8Array) => { isValid: boolean; value?: unknown; issues: unknown[] })
    | undefined;
  assert.equal(typeof decoder, 'function', 'explicit v2.1 bundle decoder must exist');
  return decoder!(payload);
};
const example = () =>
  JSON.parse(
    readFileSync(
      new URL('../schemas/v2.1/examples/mask-policy-configuration-bundle.json', import.meta.url),
      'utf8',
    ),
  );
const packet = (value: object) => {
  const body = { ...value } as Record<string, unknown>;
  Reflect.deleteProperty(body, 'bundleSha256');
  return JSON.stringify({ ...body, bundleSha256: computeCanonicalPayloadHash(body) });
};

test('version-specific policy vocabulary cannot be mutated by consumers', () => {
  assert.deepEqual(api.CAMERA_POLICY_PPE_ITEMS_V21, [
    'HARD_HAT',
    'SAFETY_VEST',
    'GLOVES',
    'BOOTS',
    'GOGGLES',
    'MASK',
  ]);
  assert.equal(Object.isFrozen(api.CAMERA_POLICY_PPE_ITEMS_V21), true);
});

test('Mask decoder retains original content, ordering, whitespace and hash for strings/UTF8', () => {
  const content = example();
  const raw = JSON.stringify(content);
  assert.deepEqual(parse(raw), { isValid: true, issues: [], value: content });
  assert.deepEqual(parse(new TextEncoder().encode(raw)).value, content);
  const six = ['MASK', 'GOGGLES', 'BOOTS', 'GLOVES', 'SAFETY_VEST', 'HARD_HAT'];
  content.cameraPpePolicy = { mode: 'EXPLICIT', requiredPpe: six };
  content.regions[0].ppePolicy = { mode: 'EXPLICIT', requiredPpe: six };
  assert.deepEqual(parse(packet(content)).value, JSON.parse(packet(content)));
  content.cameraPpePolicy = { mode: 'DISABLED', reason: '  Camera exception  ' };
  content.regions[0].ppePolicy = { mode: 'INHERIT' };
  assert.deepEqual(parse(packet(content)).value, JSON.parse(packet(content)));
  content.regions[0].ppePolicy = { mode: 'DISABLED', reason: '  Region exception  ' };
  assert.deepEqual(parse(packet(content)).value, JSON.parse(packet(content)));
  assert.equal(parse(packet({ ...example(), regions: [] })).isValid, true);
});

test('new decoder cannot reinterpret legacy versions or widen old readers', () => {
  const content = example();
  assert.equal(legacy(JSON.stringify(content)).isValid, false);
  for (const schemaVersion of ['1.0.0', '2.0.0', '2.2.0'])
    assert.equal(parse(packet({ ...content, schemaVersion })).isValid, false);
  assert.deepEqual(PPE_ITEMS, ['HARD_HAT', 'SAFETY_VEST', 'GLOVES', 'BOOTS', 'GOGGLES']);
});

test('hash tampering is rejected before any bundle is returned', () => {
  const base = example();
  for (const patch of [
    { cameraPpePolicy: { mode: 'EXPLICIT', requiredPpe: ['MASK'] } },
    { configurationVersion: base.configurationVersion + 1 },
    { viewRevision: base.viewRevision + 1 },
    { bundleSha256: 'a'.repeat(64) },
  ])
    assert.equal(parse(JSON.stringify({ ...base, ...patch })).isValid, false);
  assert.equal(parse(JSON.stringify({ ...base, bundleSha256: undefined })).isValid, false);
});

test('duplicate JSON keys cannot be hidden behind a matching last-value canonical hash', () => {
  const raw = JSON.stringify(example());
  for (const poisoned of [
    raw.replace('"schemaVersion":"2.1.0"', '"schemaVersion":"2.0.0","schemaVersion":"2.1.0"'),
    raw.replace('"mode":"EXPLICIT"', '"mode":"DISABLED","mode":"EXPLICIT"'),
    raw.replace(
      '"schemaVersion":"2.1.0"',
      String.raw`"\u0073chemaVersion":"2.1.0","schemaVersion":"2.1.0"`,
    ),
  ])
    assert.equal(parse(poisoned).isValid, false);
});

test('key scanning respects escaped string contents and independent nested objects', () => {
  const content = example();
  const reason = String.raw`Exception: {"mode":"x","mode":"y"}, [brackets], \\ and quote "`;
  content.cameraPpePolicy = { mode: 'DISABLED', reason };
  content.regions[0].ppePolicy = { mode: 'DISABLED', reason };
  assert.deepEqual(parse(packet(content)).value, JSON.parse(packet(content)));
  const raw = packet(content);
  const duplicatedRegionPolicy = raw.replace(
    '"ppePolicy":{"mode":"DISABLED"',
    '"ppePolicy":{"mode":"EXPLICIT","mode":"DISABLED"',
  );
  assert.notEqual(duplicatedRegionPolicy, raw);
  assert.equal(parse(duplicatedRegionPolicy).isValid, false);
});

test('invalid policies fail closed at camera and Region scope', () => {
  for (const policy of [
    { mode: 'EXPLICIT', requiredPpe: ['MASK', 'MASK'] },
    { mode: 'EXPLICIT', requiredPpe: [] },
    {
      mode: 'EXPLICIT',
      requiredPpe: ['MASK', 'HARD_HAT', 'SAFETY_VEST', 'GLOVES', 'BOOTS', 'GOGGLES', 'MASK'],
    },
    { mode: 'EXPLICIT', requiredPpe: ['FULL_BODY_HARNESS'] },
    { mode: 'EXPLICIT', requiredPpe: ['LANYARD_HOOK'] },
    { mode: 'EXPLICIT', requiredPpe: ['unknown'] },
    { mode: 'EXPLICIT', requiredPpe: [null] },
    { mode: 'EXPLICIT', requiredPpe: ['MASK'], allowed: true },
    { mode: 'DISABLED', reason: ' ' },
    { mode: 'DISABLED', reason: 'bad\ncontrol' },
    { mode: 'DISABLED', reason: 'x'.repeat(501) },
    { mode: 'COMPLIANT' },
    { mode: 'INHERIT', allowed: true },
    ['MASK'],
    null,
  ]) {
    const content = example();
    assert.equal(parse(packet({ ...content, cameraPpePolicy: policy })).isValid, false);
    content.regions[0].ppePolicy = policy;
    assert.equal(parse(packet(content)).isValid, false);
  }
  assert.equal(
    parse(packet({ ...example(), cameraPpePolicy: { mode: 'INHERIT' } })).isValid,
    false,
  );
});

test('caller fields and malformed geometry remain invalid even with a valid new hash', () => {
  for (const patch of [
    { siteId: 'invented' },
    { allowed: true },
    { workerId: 'invented' },
    { configurationVersion: 0 },
    { viewRevision: 0 },
    { issuedAt: '2026-02-30T00:00:00.000Z' },
    { cameraId: 'not-a-camera-id' },
  ])
    assert.equal(parse(packet({ ...example(), ...patch })).isValid, false);
  for (const patch of [
    { requiredPpe: ['MASK'] },
    { zoneId: 'bad-zone' },
    { policyRevision: 0 },
    { geometryVersion: 0 },
    { coordinateSpace: 'PIXELS' },
    {
      polygon: {
        coordinates: [
          [-0.1, 0],
          [1, 0],
          [1, 1],
        ],
      },
    },
    {
      polygon: {
        coordinates: [
          [0, 0],
          [1, 1],
          [0, 1],
          [1, 0],
        ],
      },
    },
    {
      polygon: {
        coordinates: [
          [0, 0],
          [0.5, 0.5],
        ],
      },
    },
  ]) {
    const content = example();
    content.regions[0] = { ...content.regions[0], ...patch };
    assert.equal(parse(packet(content)).isValid, false, JSON.stringify(patch));
  }
});

test('region bounds and uniqueness retain existing geometry validation', () => {
  const content = example();
  const region = content.regions[0];
  content.regions = Array.from({ length: 64 }, (_, index) => ({
    ...region,
    regionId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  }));
  assert.equal(parse(packet(content)).isValid, true);
  content.regions.push({ ...region, regionId: '00000000-0000-4000-8000-000000000065' });
  assert.equal(parse(packet(content)).isValid, false);
  content.regions = [region, structuredClone(region)];
  assert.equal(parse(packet(content)).isValid, false);
});

test('malformed, oversized and invalid UTF8 payloads are unavailable input, not a policy exception', () => {
  for (const value of ['{', 'null', '42', '[]', new Uint8Array([0xff]), ' '.repeat(262145)])
    assert.equal(parse(value).isValid, false);
});
