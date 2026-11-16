import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { computeCanonicalPayloadHash } from '../src/hashing/canonical-hash.js';
import { parseCameraConfigurationBundlePayload as legacy } from '../src/camera-configuration-bundle.js';

const modulePath = '../src/camera-policy-configuration-bundle.js';
const api = await import(modulePath).catch(() => ({}));
const parse = api.parseCameraPolicyConfigurationBundlePayload as (value: string | Uint8Array) => {
  isValid: boolean;
  value?: unknown;
};

function content() {
  return {
    schemaVersion: '2.0.0',
    cameraId: '11111111-2222-4333-8444-555555555555',
    cameraExternalId: 'camera-01',
    configurationVersion: 4,
    viewRevision: 2,
    issuedAt: '2026-11-13T00:00:00.000Z',
    cameraPpePolicy: { mode: 'EXPLICIT', requiredPpe: ['HARD_HAT', 'SAFETY_VEST'] },
    regions: [
      {
        regionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1',
        geometryVersion: 1,
        coordinateSpace: 'NORMALIZED_0_1',
        polygon: {
          coordinates: [
            [0.2, 0.2],
            [0.7, 0.2],
            [0.5, 0.7],
          ],
        },
        zoneId: '99999999-8888-4777-8666-555555555551',
        policyRevision: 1,
        ppePolicy: { mode: 'INHERIT' },
      },
    ],
  };
}
const packet = (value: object) =>
  JSON.stringify({ ...value, bundleSha256: computeCanonicalPayloadHash(value) });

test('v2 golden vector fixes the cross-runtime hash for inherit, explicit and disabled bindings', () => {
  const payload = readFileSync(
    new URL('../schemas/v2/examples/camera-policy-configuration-bundle.json', import.meta.url),
    'utf8',
  );
  const { bundleSha256, ...body } = JSON.parse(payload);
  assert.equal(bundleSha256, '5e1277da37e6c51644689c6a4c0481e8940dcfc5b2e86f66a7f0fe127297c5ca');
  assert.equal(computeCanonicalPayloadHash(body), bundleSha256);
  assert.equal(parse(payload).isValid, true);
});

test('v2 preserves independent camera and Region policy including camera scope without a polygon', () => {
  const value = packet(content());
  assert.deepEqual(parse(value).value, JSON.parse(value));
  assert.equal(parse(new TextEncoder().encode(value)).isValid, true);
  assert.equal(parse(packet({ ...content(), regions: [] })).isValid, true);
  for (const policy of [
    { mode: 'EXPLICIT', requiredPpe: ['HARD_HAT', 'SAFETY_VEST', 'GLOVES', 'BOOTS', 'GOGGLES'] },
    { mode: 'DISABLED', reason: 'Approved local exception' },
    { mode: 'INHERIT' },
  ]) {
    const value = content();
    assert.equal(
      parse(packet({ ...value, regions: [{ ...value.regions[0], ppePolicy: policy }] })).isValid,
      true,
    );
  }
});

test('v2 hash covers default, overrides and disabled reasons', () => {
  const original = JSON.parse(packet(content()));
  for (const change of [
    { cameraPpePolicy: { mode: 'DISABLED', reason: 'Changed default' } },
    {
      regions: [
        { ...original.regions[0], ppePolicy: { mode: 'DISABLED', reason: 'Changed override' } },
      ],
    },
  ])
    assert.equal(parse(JSON.stringify({ ...original, ...change })).isValid, false);
});

test('v2 rejects malformed policy, legacy policy fields and caller-invented provenance even when rehashed', () => {
  for (const policy of [
    { mode: 'INHERIT' },
    { mode: 'EXPLICIT', requiredPpe: [] },
    { mode: 'EXPLICIT', requiredPpe: ['MASK'] },
    { mode: 'EXPLICIT', requiredPpe: ['GLOVES', 'GLOVES'] },
    { mode: 'DISABLED', reason: ' ' },
    { mode: 'DISABLED', reason: 'hidden\ncontrol' },
  ])
    assert.equal(parse(packet({ ...content(), cameraPpePolicy: policy })).isValid, false);
  for (const extra of [{ requiredPpe: [] }, { actorId: 'invented' }]) {
    assert.equal(parse(packet({ ...content(), ...extra })).isValid, false);
    assert.equal(
      parse(packet({ ...content(), regions: [{ ...content().regions[0], ...extra }] })).isValid,
      false,
    );
  }
  assert.equal(
    parse(
      packet({
        ...content(),
        regions: [{ ...content().regions[0], ppePolicy: { mode: 'DISABLED', reason: '' } }],
      }),
    ).isValid,
    false,
  );
});

test('v2 retains existing metadata, duplicate Region and polygon validation', () => {
  for (const change of [
    { configurationVersion: 0 },
    { viewRevision: 1.5 },
    { cameraId: 'invented' },
    { issuedAt: '2026-02-30T00:00:00.000Z' },
    { cameraExternalId: '' },
    { regions: [content().regions[0], content().regions[0]] },
    { regions: [{ ...content().regions[0], policyRevision: 0 }] },
    {
      regions: [
        {
          ...content().regions[0],
          polygon: {
            coordinates: [
              [0, 0],
              [1, 1],
              [0, 1],
              [1, 0],
            ],
          },
        },
      ],
    },
  ])
    assert.equal(parse(packet({ ...content(), ...change })).isValid, false);
});

test('v2 and v1 require separate decoders and never silently convert legacy semantics', () => {
  assert.equal(legacy(packet(content())).isValid, false);
  const base = { ...content() };
  Reflect.deleteProperty(base, 'cameraPpePolicy');
  const region = { ...base.regions[0]! };
  Reflect.deleteProperty(region, 'ppePolicy');
  const v1 = packet({ ...base, schemaVersion: '1.0.0', regions: [{ ...region, requiredPpe: [] }] });
  assert.equal(legacy(v1).isValid, true);
  assert.equal(parse(v1).isValid, false);
});

test('v2 bounds bytes and rejects malformed UTF8 and JSON without throwing', () => {
  for (const value of [new Uint8Array([0xff]), '{', ' '.repeat(262145)]) {
    assert.equal(parse(value).isValid, false);
  }
});

test('v2 structural schema accepts policy modes and leaves digest checking to the decoder', () => {
  const ajv = new Ajv2020.default({ strict: true, allErrors: true });
  addFormats.default(ajv);
  const schema = (path: string) =>
    JSON.parse(readFileSync(new URL('../schemas/' + path, import.meta.url), 'utf8'));
  ajv.addSchema(schema('v1/camera-region-configuration.json'));
  const validate = ajv.compile(schema('v2/camera-policy-configuration-bundle.json'));
  assert.equal(validate(JSON.parse(packet(content()))), true);
  for (const [cameraPpePolicy, accepted] of [
    [{ mode: 'DISABLED', reason: 'Local exception' }, true],
    [{ mode: 'DISABLED', reason: ' ' }, false],
    [{ mode: 'DISABLED', reason: 'hidden\ncontrol' }, false],
    [{ mode: 'DISABLED', reason: 'x'.repeat(501) }, false],
    [{ mode: 'EXPLICIT', requiredPpe: ['GLOVES', 'GLOVES'] }, false],
    [{ mode: 'EXPLICIT', requiredPpe: ['MASK'] }, false],
  ] as const) {
    assert.equal(validate({ ...JSON.parse(packet(content())), cameraPpePolicy }), accepted);
  }
  assert.equal(
    validate({ ...JSON.parse(packet(content())), cameraPpePolicy: { mode: 'INHERIT' } }),
    false,
  );
  assert.equal(validate({ ...JSON.parse(packet(content())), bundleSha256: '0'.repeat(64) }), true);
});
