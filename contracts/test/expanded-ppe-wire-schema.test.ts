import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import Ajv2020Pkg from 'ajv/dist/2020.js';
import addFormatsPkg from 'ajv-formats';
import { validateObservationEvent } from '../src/validation/schema-validator.js';
import { validateGeometries } from '../src/validation/geometry-validator.js';

type Validator = (data: unknown) => boolean;
interface Compiler {
  compile(schema: unknown): Validator;
}
const Ajv = Ajv2020Pkg as unknown as new (options: Record<string, unknown>) => Compiler;
const addFormats = addFormatsPkg as unknown as (compiler: Compiler) => void;
const ajv = new Ajv({ strict: true, allErrors: true });
addFormats(ajv);
const schema = JSON.parse(
  readFileSync(
    new URL('../../schemas/v1.1/technical-observation-event.json', import.meta.url),
    'utf8',
  ),
) as unknown;
const validate = ajv.compile(schema);

test('v1.1 preserves every v1 schema rule except its identity, version and PPE enum', () => {
  const expected = JSON.parse(
    readFileSync(
      new URL('../../schemas/v1/technical-observation-event.json', import.meta.url),
      'utf8',
    ),
  ) as {
    $id: string;
    properties: { schemaVersion: { const: string } };
    $defs: { ppeObservation: { properties: { ppeItem: { enum: string[] } } } };
  };
  expected.$id = 'https://smartsite.local/contracts/v1.1/technical-observation-event.json';
  expected.properties.schemaVersion.const = '1.1.0';
  expected.$defs.ppeObservation.properties.ppeItem.enum = [
    'HARD_HAT',
    'SAFETY_VEST',
    'GLOVES',
    'BOOTS',
    'GOGGLES',
  ];
  assert.deepEqual(schema, expected);
});

function event(item: string, status = 'MISSING') {
  return {
    eventId: '11111111-1111-4111-8111-111111111111',
    schemaVersion: '1.1.0',
    cameraExternalId: 'SYNTHETIC-CAMERA',
    streamSessionId: '22222222-2222-4222-8222-222222222222',
    capturedAt: '2026-10-06T00:00:00.000Z',
    frameDimensions: { width: 640, height: 480 },
    observations: [
      {
        type: 'PPE',
        trackId: 1,
        ppeItem: item,
        status,
        regionId: '33333333-3333-4333-8333-333333333333',
        geometryVersion: 1,
      },
    ],
    evidence: [],
  };
}

for (const item of ['HARD_HAT', 'SAFETY_VEST', 'GLOVES', 'BOOTS', 'GOGGLES']) {
  test(`v1.1 wire schema describes explicit ${item} observations`, () => {
    for (const status of ['PRESENT', 'MISSING']) {
      const payload = event(item, status);
      assert.equal(validate(payload), true);
      assert.deepEqual(validateGeometries(payload), []);
    }
  });
}

test('new schema asset does not activate v1.1 admission in existing runtime validators', () => {
  assert.equal(validateObservationEvent(event('GLOVES')).isValid, false);
  assert.equal(
    validateObservationEvent({ ...event('HARD_HAT'), schemaVersion: '1.0.0' }).isValid,
    true,
  );
  assert.equal(
    validateObservationEvent({ ...event('GLOVES'), schemaVersion: '1.0.0' }).isValid,
    false,
  );
});

test('v1.1 keeps unknown, extra fields and unsupported item families outside the wire contract', () => {
  assert.equal(validate(event('GLOVES', 'UNKNOWN')), false);
  assert.equal(validate(event('HARNESS')), false);
  assert.equal(validate({ ...event('BOOTS'), extra: true }), false);
  assert.equal(validate({ ...event('BOOTS'), schemaVersion: '2.0.0' }), false);
  assert.equal(validate({ ...event('BOOTS'), observations: [] }), false);
});

test('schema validation still requires the existing semantic geometry check', () => {
  const payload = event('GOGGLES');
  const malformed = {
    ...payload,
    observations: [
      {
        ...payload.observations[0],
        boundingBox: {
          x1: 0.8,
          y1: 0.2,
          x2: 0.1,
          y2: 0.5,
          coordinateSpace: 'NORMALIZED_0_1',
        },
      },
    ],
  };
  assert.equal(validate(malformed), true);
  assert.notEqual(validateGeometries(malformed).length, 0);
});
