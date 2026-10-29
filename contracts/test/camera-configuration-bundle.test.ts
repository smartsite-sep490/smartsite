import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parseCameraConfigurationBundlePayload as parse } from '../src/camera-configuration-bundle.js';
import { computeCanonicalPayloadHash } from '../src/hashing/canonical-hash.js';
import { PPE_ITEMS } from '../src/ppe-items.js';
import { parseCameraRegionConfigurationPayload as legacy } from '../src/validation/camera-region-configuration-validator.js';

function content() {
  return {
    schemaVersion: '1.0.0' as const,
    cameraId: '11111111-2222-4333-8444-555555555555',
    cameraExternalId: 'camera-01',
    configurationVersion: 3,
    viewRevision: 2,
    issuedAt: '2026-10-25T12:00:00.000Z',
    regions: [
      {
        regionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1',
        geometryVersion: 1,
        coordinateSpace: 'NORMALIZED_0_1' as const,
        polygon: {
          coordinates: [
            [0.1, 0.1],
            [0.5, 0.1],
            [0.5, 0.5],
            [0.1, 0.5],
          ],
        },
        zoneId: '99999999-8888-4777-8666-555555555551',
        policyRevision: 1,
        requiredPpe: [...PPE_ITEMS],
      },
    ],
  };
}
function packet(value: object = content()) {
  return JSON.stringify({ ...value, bundleSha256: computeCanonicalPayloadHash(value) });
}

test('bundle structural schema compiles with canonical Region refs and leaves hash verification to parser', () => {
  const ajv = new Ajv2020.default({ strict: true, allErrors: true });
  addFormats.default(ajv);
  const schema = (name: string) =>
    JSON.parse(readFileSync(new URL(`../schemas/v1/${name}.json`, import.meta.url), 'utf8'));
  ajv.addSchema(schema('camera-region-configuration'));
  const validate = ajv.compile(schema('camera-configuration-bundle'));
  const valid = JSON.parse(packet());
  assert.equal(validate(valid), true);
  assert.equal(validate({ ...valid, workerGenerationId: 'invented' }), false);
  const tampered = { ...valid, bundleSha256: '0'.repeat(64) };
  assert.equal(validate(tampered), true);
  assert.equal(parse(JSON.stringify(tampered)).isValid, false);
});
function rejected(value: object) {
  const result = parse(packet(value));
  assert.equal(result.isValid, false);
  assert.equal(result.value, undefined);
}

test('valid bundle accepts text/bytes, all five PPE, empty effective PPE and empty regions', () => {
  const value = packet();
  assert.deepEqual(parse(value).value, JSON.parse(value));
  assert.equal(parse(new TextEncoder().encode(value)).isValid, true);
  const emptyPolicy = content();
  emptyPolicy.regions[0].requiredPpe = [];
  assert.equal(parse(packet(emptyPolicy)).isValid, true);
  assert.equal(parse(packet({ ...content(), regions: [] })).isValid, true);
});

test('polygon, policy, view and source mutations cannot reuse the old canonical checksum', () => {
  const mutations = [
    (v: ReturnType<typeof content>) => {
      v.regions[0].polygon.coordinates[0][0] = 0.12;
    },
    (v: ReturnType<typeof content>) => {
      v.regions[0].policyRevision++;
    },
    (v: ReturnType<typeof content>) => {
      v.regions[0].requiredPpe = [];
    },
    (v: ReturnType<typeof content>) => {
      v.viewRevision++;
    },
    (v: ReturnType<typeof content>) => {
      v.cameraExternalId = 'camera-02';
    },
  ];
  for (const mutate of mutations) {
    const value = JSON.parse(packet());
    mutate(value);
    assert.equal(parse(JSON.stringify(value)).isValid, false);
  }
});

test('unsafe versions, noncanonical IDs and unknown properties are rejected even if rehashed', () => {
  for (const version of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    if (Number.isSafeInteger(version) || !Number.isInteger(version)) {
      rejected({ ...content(), viewRevision: version });
    } else {
      const raw = JSON.parse(packet());
      raw.configurationVersion = version;
      assert.equal(parse(JSON.stringify(raw)).isValid, false);
    }
  }
  rejected({ ...content(), cameraId: 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEE1' });
  rejected({ ...content(), applied: true });
  rejected({ ...content(), regions: [{ ...content().regions[0], extra: true }] });
});

test('unknown or duplicate PPE, duplicate region IDs and invalid policy revisions fail closed', () => {
  for (const requiredPpe of [['MASK'], ['HARD_HAT', 'HARD_HAT'], [null]])
    rejected({ ...content(), regions: [{ ...content().regions[0], requiredPpe }] });
  rejected({ ...content(), regions: [content().regions[0], content().regions[0]] });
  rejected({ ...content(), regions: [{ ...content().regions[0], policyRevision: 0 }] });
});

test('existing geometry checks reject self-intersection, zero area, bounds and unknown polygon fields', () => {
  for (const coordinates of [
    [
      [0.1, 0.1],
      [0.5, 0.5],
      [0.5, 0.1],
      [0.1, 0.5],
    ],
    [
      [0.1, 0.1],
      [0.2, 0.2],
      [0.3, 0.3],
    ],
    [
      [-0.1, 0.1],
      [0.5, 0.1],
      [0.5, 0.5],
    ],
  ])
    rejected({ ...content(), regions: [{ ...content().regions[0], polygon: { coordinates } }] });
  rejected({
    ...content(),
    regions: [
      { ...content().regions[0], polygon: { ...content().regions[0].polygon, extra: true } },
    ],
  });
});

test('invalid UTF8, oversize and deeply nested input return invalid rather than throw', () => {
  assert.equal(parse(new Uint8Array([255])).issues[0].code, 'INVALID_JSON');
  assert.equal(parse('x'.repeat(262145)).issues[0].code, 'PAYLOAD_TOO_LARGE');
  const deep = packet().replace(
    JSON.stringify(content().regions[0].polygon),
    '['.repeat(16000) + '0' + ']'.repeat(16000),
  );
  assert.doesNotThrow(() => assert.equal(parse(deep).isValid, false));
});

test('issuedAt rejects calendar rollover, offsets, omitted milliseconds and leap seconds', () => {
  for (const issuedAt of [
    '2026-02-29T12:00:00.000Z',
    '2026-04-31T00:00:00.000Z',
    '2026-10-25T24:00:00.000Z',
    '2026-10-25T12:00:60.000Z',
    '2026-10-25T12:00:00Z',
    '2026-10-25T12:00:00.000+00:00',
  ])
    rejected({ ...content(), issuedAt });
});

test('legacy camera configuration stays a separate accepted resource', () => {
  const value = content();
  const old = {
    schemaVersion: value.schemaVersion,
    configurationVersion: value.configurationVersion,
    cameraExternalId: value.cameraExternalId,
    regions: value.regions.map(({ regionId, geometryVersion, coordinateSpace, polygon }) => ({
      regionId,
      geometryVersion,
      coordinateSpace,
      polygon,
    })),
  };
  assert.equal(legacy(JSON.stringify(old)).isValid, true);
  assert.equal(legacy(packet()).isValid, false);
  assert.equal(parse(JSON.stringify(old)).isValid, false);
});
