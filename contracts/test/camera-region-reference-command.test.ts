import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import {
  parseCreateReferenceRegionCommand as create,
  parseUpdateReferenceRegionPolygonCommand as update,
} from '../src/index.js';

const referenceId = '11111111-2222-4333-8444-555555555551';
const zoneId = '22222222-3333-4444-8555-666666666662';
const base = () => ({
  expectedConfigurationVersion: 3,
  referenceId,
  viewRevision: 2,
  confirmReferenceView: true,
  polygon: {
    coordinates: [
      [0.1, 0.1],
      [0.9, 0.1],
      [0.5, 0.9],
    ],
  },
});

test('public create/update parsers accept only their explicit command shapes', () => {
  assert.deepEqual(update(base()), base());
  assert.deepEqual(create({ ...base(), zoneId }), { ...base(), zoneId });
  assert.throws(() => create(base()));
  assert.throws(() => update({ ...base(), zoneId }));
});

test('confirmation, reference and revision fields cannot be absent or coerced', () => {
  for (const field of [
    'referenceId',
    'viewRevision',
    'expectedConfigurationVersion',
    'confirmReferenceView',
  ]) {
    const input: Record<string, unknown> = base();
    delete input[field];
    assert.throws(() => update(input), field);
  }
  for (const confirmReferenceView of [false, 1, 'true', null])
    assert.throws(() => update({ ...base(), confirmReferenceView }));
  for (const field of ['viewRevision', 'expectedConfigurationVersion'])
    for (const value of [0, -1, 1.5, '2', true, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])
      assert.throws(() => update({ ...base(), [field]: value }));
  assert.equal(
    update({ ...base(), viewRevision: Number.MAX_SAFE_INTEGER }).viewRevision,
    Number.MAX_SAFE_INTEGER,
  );
});

test('rejects malformed identifiers and client-supplied authority/provenance fields', () => {
  for (const referenceId of [
    '',
    'camera-1',
    ' ' + zoneId,
    'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE',
    'x'.repeat(36),
  ]) {
    assert.throws(() => update({ ...base(), referenceId }));
  }
  assert.throws(() => create({ ...base(), zoneId: 'other-zone' }));
  for (const field of [
    'actorUserId',
    'confirmedAt',
    'siteId',
    'cameraId',
    'viewValidity',
    'appliedAt',
  ])
    assert.throws(() => update({ ...base(), [field]: referenceId }));
  assert.throws(() => update({ ...base(), [Symbol('hidden')]: true }));
  assert.throws(() => update(Object.assign(Object.create({ extra: true }), base())));
});

test('polygon coordinates must be finite bounded pairs with a valid simple area', () => {
  for (const coordinates of [
    [],
    [
      [0, 0],
      [1, 1],
    ],
    [
      [0, 0],
      [1, 1],
      [0, 0],
    ],
    [
      [0, 0],
      [0.5, 0.5],
      [1, 1],
    ],
    [
      [0, 0],
      [1, 1],
      [0, 1],
      [1, 0],
    ],
    [
      [-0.1, 0],
      [1, 0],
      [0, 1],
    ],
    [
      [0, 0],
      [1.1, 0],
      [0, 1],
    ],
    [
      [0, 0],
      [Infinity, 0],
      [0, 1],
    ],
    [
      [0, 0],
      [NaN, 0],
      [0, 1],
    ],
    [
      [0, 0, 1],
      [1, 0],
      [0, 1],
    ],
    [
      [0, 0],
      ['1', 0],
      [0, 1],
    ],
    [[0, 0], [1, 0], Array(2)],
    Array.from({ length: 65 }, (_, i) => [i / 65, 0.1]),
  ])
    assert.throws(() => update({ ...base(), polygon: { coordinates } }));
  assert.throws(() =>
    update({ ...base(), polygon: { ...base().polygon, coordinateSpace: 'PIXELS' } }),
  );
  assert.deepEqual(
    update({
      ...base(),
      polygon: {
        coordinates: [
          [0, 0],
          [1, 0],
          [0, 1],
        ],
      },
    }).polygon.coordinates,
    [
      [0, 0],
      [1, 0],
      [0, 1],
    ],
  );
});

test('returned polygon is detached from caller mutations and no server claims are synthesized', () => {
  const input = base();
  const parsed = update(input);
  input.polygon.coordinates[0][0] = 0.8;
  assert.equal(parsed.polygon.coordinates[0][0], 0.1);
  assert.equal('geometryConfirmation' in parsed, false);
  assert.equal('confirmedAt' in parsed, false);
});

test('JSON schemas match create/update structural examples and reuse the canonical polygon shape', () => {
  const require = createRequire(import.meta.url);
  type Validator = (value: unknown) => boolean;
  type SchemaCompiler = { addSchema(value: unknown): void; compile(value: unknown): Validator };
  const Ajv = require('ajv/dist/2020.js').default as new (options: object) => SchemaCompiler;
  const addFormats = require('ajv-formats') as (instance: SchemaCompiler) => void;
  const ajv = new Ajv({ strict: true, allErrors: true });
  addFormats(ajv);
  const schema = (name: string) =>
    JSON.parse(readFileSync(new URL(`../schemas/v1/${name}.json`, import.meta.url), 'utf8'));
  ajv.addSchema(schema('camera-region-configuration'));
  const validCreate = ajv.compile(schema('create-reference-region-command'));
  const validUpdate = ajv.compile(schema('update-reference-region-polygon-command'));
  assert.equal(validCreate(create({ ...base(), zoneId })), true);
  assert.equal(validUpdate(update(base())), true);
  assert.equal(validCreate(base()), false);
  assert.equal(validUpdate({ ...base(), zoneId }), false);
  for (const invalid of [
    { ...base(), confirmReferenceView: false },
    { ...base(), viewRevision: '2' },
    { ...base(), actorUserId: referenceId },
    { ...base(), referenceId: 'other' },
    {
      ...base(),
      polygon: {
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
    },
  ]) {
    assert.equal(validUpdate(invalid), false);
    assert.throws(() => update(invalid));
  }
});
