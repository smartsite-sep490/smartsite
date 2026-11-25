import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { computeCanonicalPayloadHash } from '../src/hashing/canonical-hash.js';
import { parseCameraPolicyConfigurationBundlePayload } from '../src/camera-policy-configuration-bundle.js';
import { PPE_ITEMS } from '../src/ppe-items.js';
import { validateTrackedCameraPpeEvent } from '../src/validation/schema-validator.js';

const read = (path: string) => readFileSync(new URL('../schemas/' + path, import.meta.url));
const json = (path: string) => JSON.parse(read(path).toString('utf8'));
const six = [...PPE_ITEMS, 'MASK'];

function validators() {
  const ajv = new Ajv2020.default({ strict: true, allErrors: true });
  addFormats.default(ajv);
  for (const version of ['v1', 'v1.1', 'v1.2', 'v1.3', 'v1.4', 'v1.5', 'v1.6', 'v1.7'])
    ajv.addSchema(json(`${version}/technical-observation-event.json`));
  ajv.addSchema(json('v1/camera-region-configuration.json'));
  return {
    event: ajv.compile(json('v1.8/technical-observation-event.json')),
    bundle: ajv.compile(json('v2.1/camera-policy-configuration-bundle.json')),
  };
}

test('new Mask contracts do not change released schema bytes or current default policy items', () => {
  for (const [path, expected] of [
    [
      'v1.7/technical-observation-event.json',
      'e5d5813c94b480e6e06075be9744393e5311f0188fad9445e91c23803d6b996f',
    ],
    [
      'v2/camera-policy-configuration-bundle.json',
      'dce75c6f92bfb4c7705dab57c2415a1819b39c8d43696989c5f286368b54df5a',
    ],
  ])
    assert.equal(createHash('sha256').update(read(path!)).digest('hex'), expected);
  assert.deepEqual(PPE_ITEMS, ['HARD_HAT', 'SAFETY_VEST', 'GLOVES', 'BOOTS', 'GOGGLES']);
});

test('v1.8 schema accepts explicit Mask evidence for CAMERA and REGION without widening old readers', () => {
  const { event: validate } = validators();
  const example = json('v1.8/examples/mask-camera-observation.json');
  const before = structuredClone(example);
  assert.equal(validate(example), true, JSON.stringify(validate.errors));
  assert.deepEqual(example, before);
  for (const ppeItem of six)
    for (const status of ['PRESENT', 'MISSING']) {
      const item = structuredClone(example);
      Object.assign(item.observations[1], { ppeItem, status });
      assert.equal(validate(item), true, `${ppeItem}:${status}`);
    }
  const region = structuredClone(example);
  region.observations[1] = {
    type: 'PPE',
    trackId: 0,
    regionId: '00000000-0000-4000-8000-000000000010',
    geometryVersion: 1,
    ppeItem: 'MASK',
    status: 'MISSING',
  };
  assert.equal(validate(region), true, JSON.stringify(validate.errors));
  assert.equal(validateTrackedCameraPpeEvent(example).isValid, false);
  assert.equal(
    validateTrackedCameraPpeEvent({ ...example, schemaVersion: '1.7.0' }).isValid,
    false,
  );
});

test('v1.8 preserves scope, known-class, strict-field and PRESENT_ONLY schema boundaries', () => {
  const validate = validators().event;
  const base = json('v1.8/examples/mask-camera-observation.json');
  for (const patch of [
    { ppeItem: 'FULL_BODY_HARNESS' },
    { ppeItem: 'LANYARD_HOOK' },
    { ppeItem: 'UNKNOWN_PPE' },
    { status: 'UNKNOWN' },
    { status: 'COMPLIANT' },
    { allowed: true },
    { workerId: 'invented' },
    { zoneId: '00000000-0000-4000-8000-000000000010' },
    { scope: 'SITE' },
  ]) {
    const item = structuredClone(base);
    Object.assign(item.observations[1], patch);
    assert.equal(validate(item), false, JSON.stringify(patch));
  }
  for (const ppeItem of ['FULL_BODY_HARNESS', 'LANYARD_HOOK']) {
    const item = structuredClone(base);
    item.observations[1] = {
      type: 'PPE',
      trackId: 0,
      regionId: '00000000-0000-4000-8000-000000000010',
      geometryVersion: 1,
      ppeItem,
      status: 'PRESENT',
    };
    assert.equal(validate(item), true);
    item.observations[1].status = 'MISSING';
    assert.equal(validate(item), false);
  }
});

test('v2.1 permits six-item camera and Region policies while old decoder remains closed', () => {
  const validate = validators().bundle;
  const base = json('v2.1/examples/mask-policy-configuration-bundle.json');
  assert.equal(validate(base), true, JSON.stringify(validate.errors));
  const all = structuredClone(base);
  all.cameraPpePolicy = { mode: 'EXPLICIT', requiredPpe: six };
  all.regions[0].ppePolicy = { mode: 'EXPLICIT', requiredPpe: six };
  assert.equal(validate(all), true, JSON.stringify(validate.errors));
  assert.equal(parseCameraPolicyConfigurationBundlePayload(JSON.stringify(base)).isValid, false);
  assert.equal(
    parseCameraPolicyConfigurationBundlePayload(JSON.stringify({ ...base, schemaVersion: '2.0.0' }))
      .isValid,
    false,
  );
  for (const policy of [
    { mode: 'EXPLICIT', requiredPpe: ['MASK', 'MASK'] },
    { mode: 'EXPLICIT', requiredPpe: [...six, 'MASK'] },
    { mode: 'EXPLICIT', requiredPpe: [] },
    { mode: 'EXPLICIT', requiredPpe: ['FULL_BODY_HARNESS'] },
    { mode: 'EXPLICIT', requiredPpe: ['LANYARD_HOOK'] },
    { mode: 'EXPLICIT', requiredPpe: ['UNKNOWN_PPE'] },
    { mode: 'EXPLICIT', requiredPpe: ['MASK'], workerId: 'invented' },
  ]) {
    assert.equal(validate({ ...base, cameraPpePolicy: policy }), false);
    const item = structuredClone(base);
    item.regions[0].ppePolicy = policy;
    assert.equal(validate(item), false);
  }
});

test('synthetic Mask examples retain reproducible canonical hash vectors', () => {
  const vector = json('v1.8/examples/mask-contract-hashes.json');
  assert.equal(
    vector.eventSha256,
    'c3df004996d6f2d70003393e9bea7efd323e2baedb93a097fe9bd79d41527ae1',
  );
  assert.equal(
    vector.bundleSha256,
    '05f703a6aa84ff9c181b66cd41e5aa9445c80db1d18b73a177614b10f42359a9',
  );
  const event = json('v1.8/examples/mask-camera-observation.json');
  const { bundleSha256, ...body } = json('v2.1/examples/mask-policy-configuration-bundle.json');
  assert.equal(computeCanonicalPayloadHash(event), vector.eventSha256);
  assert.equal(computeCanonicalPayloadHash(body), vector.bundleSha256);
  assert.equal(bundleSha256, vector.bundleSha256);
  assert.notEqual(
    computeCanonicalPayloadHash({ ...event, schemaVersion: '1.7.0' }),
    vector.eventSha256,
  );
  assert.notEqual(
    computeCanonicalPayloadHash({ ...body, schemaVersion: '2.0.0' }),
    vector.bundleSha256,
  );
});
