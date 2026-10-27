import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import Ajv2020Pkg from 'ajv/dist/2020.js';
import addFormatsPkg from 'ajv-formats';
import { computeCanonicalPayloadHash } from '../src/hashing/canonical-hash.js';
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
const read = (path: string) =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as unknown;
const schema = read('../../schemas/v1.2/technical-observation-event.json');
const validate = ajv.compile(schema);
const vector = read('../../test/evidence-content-v1.2-vectors.json') as {
  event: Record<string, unknown>;
  expectedCanonicalHash: string;
};
const sha = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const payload = (evidence: unknown[]) => ({ ...structuredClone(vector.event), evidence });

for (const kind of ['FRAME', 'CROP', 'SNAPSHOT']) {
  test(`v1.2 requires a lowercase SHA256 for ${kind} evidence`, () => {
    const item = { kind, uri: 'local://synthetic/image.jpg', sha256: sha };
    assert.equal(validate(payload([item])), true);
    const { sha256: omitted, ...missing } = item;
    void omitted;
    assert.equal(validate(payload([missing])), false);
    for (const hash of ['', sha.toUpperCase(), sha.slice(1), sha + '0', 'g'.repeat(64)])
      assert.equal(validate(payload([{ ...item, sha256: hash }])), false);
  });
}

test('v1.2 preserves v1.1 schema rules except version identity and required evidence SHA', () => {
  const expected = read('../../schemas/v1.1/technical-observation-event.json') as {
    $id: string;
    properties: { schemaVersion: { const: string } };
    $defs: { evidenceItem: { required: string[]; properties: Record<string, unknown> } };
  };
  expected.$id = 'https://smartsite.local/contracts/v1.2/technical-observation-event.json';
  expected.properties.schemaVersion.const = '1.2.0';
  expected.$defs.evidenceItem.required.push('sha256');
  expected.$defs.evidenceItem.properties.sha256 = { type: 'string', pattern: '^[0-9a-f]{64}$' };
  assert.deepEqual(schema, expected);
});

test('v1.2 canonical golden vector preserves its expected event hash', () => {
  assert.equal(validate(vector.event), true);
  assert.deepEqual(validateGeometries(vector.event), []);
  assert.equal(computeCanonicalPayloadHash(vector.event), vector.expectedCanonicalHash);
  const changed = payload([{ kind: 'FRAME', uri: 'local://synthetic/image.jpg', sha256: sha }]);
  assert.notEqual(computeCanonicalPayloadHash(changed), vector.expectedCanonicalHash);
});

test('v1.2 asset does not change existing v1.0 runtime admission or hash rules', () => {
  assert.equal(validateObservationEvent(vector.event).isValid, false);
  assert.equal(validate({ ...vector.event, schemaVersion: '1.0.0' }), false);
  assert.equal(validate({ ...vector.event, extra: true }), false);
  assert.equal(
    validate(payload([{ kind: 'FILE', uri: 'local://synthetic/image.jpg', sha256: sha }])),
    false,
  );
  assert.equal(
    validate(
      payload([
        { kind: 'FRAME', uri: 'local://synthetic/image.jpg', sha256: sha, workerId: 'untrusted' },
      ]),
    ),
    false,
  );
});

test('an evidence digest does not replace semantic geometry validation', () => {
  const malformed = payload([
    {
      kind: 'CROP',
      uri: 'local://synthetic/image.jpg',
      sha256: sha,
      boundingBox: { x1: 0.8, y1: 0.2, x2: 0.1, y2: 0.5, coordinateSpace: 'NORMALIZED_0_1' },
    },
  ]);
  assert.equal(validate(malformed), true);
  assert.notEqual(validateGeometries(malformed).length, 0);
});
