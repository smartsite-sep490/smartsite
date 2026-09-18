import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import canonicalizePkg from 'canonicalize';
import { computeCanonicalPayloadHash, canonicalizeJson } from '@smartsite/contracts';

type CanonicalizeFn = (input: unknown) => string | undefined;

const canonicalize: CanonicalizeFn =
  typeof canonicalizePkg === 'function'
    ? (canonicalizePkg as CanonicalizeFn)
    : (canonicalizePkg as unknown as { default: CanonicalizeFn }).default;

interface Vector {
  description: string;
  input: unknown;
  expectedCanonical: string;
  expectedSha256: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In .test-build/test, resolve to ../../test/golden-vectors.json; otherwise ./golden-vectors.json
const vectorsCandidate1 = path.resolve(__dirname, '../../test/golden-vectors.json');
const vectorsCandidate2 = path.resolve(__dirname, './golden-vectors.json');
const vectorsPath = existsSync(vectorsCandidate1) ? vectorsCandidate1 : vectorsCandidate2;
const vectors: Vector[] = JSON.parse(readFileSync(vectorsPath, 'utf8'));

test('canonicalize package and project hash match pinned vectors', () => {
  for (const vector of vectors) {
    const canonical = canonicalize(vector.input);
    assert.equal(canonical, vector.expectedCanonical, vector.description);
    assert.equal(computeCanonicalPayloadHash(vector.input), vector.expectedSha256, vector.description);
    assert.equal(
      createHash('sha256').update(vector.expectedCanonical, 'utf8').digest('hex'),
      vector.expectedSha256,
      vector.description,
    );
  }
});

test('matches RFC 8785 primitive serialization example', () => {
  const input = {
    // eslint-disable-next-line no-loss-of-precision
    numbers: [333333333.33333329, 1e30, 4.5, 2e-3, 1e-27],
    string: "€$\u000f\nA'B\"\\\\\"/",
    literals: [null, true, false],
  };
  // eslint-disable-next-line no-useless-escape
  const expected = '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/\"}';
  assert.equal(canonicalize(input), expected);
});

test('canonicalizeJson strictly preserves array element order and normalizes object keys', () => {
  const arr1 = { items: [1, 2, 3] };
  const arr2 = { items: [3, 2, 1] };
  assert.notEqual(computeCanonicalPayloadHash(arr1), computeCanonicalPayloadHash(arr2));

  const obj1 = { z: 1, a: 2 };
  const obj2 = { a: 2, z: 1 };
  assert.equal(computeCanonicalPayloadHash(obj1), computeCanonicalPayloadHash(obj2));
  assert.equal(canonicalizeJson(obj1), canonicalizeJson(obj2));
});

test('computeCanonicalPayloadHash rejects undefined and non-serializable values', () => {
  assert.throws(() => computeCanonicalPayloadHash(undefined), { name: 'TypeError' });
  assert.throws(() => computeCanonicalPayloadHash(() => {}), { name: 'TypeError' });
  assert.throws(() => computeCanonicalPayloadHash(Symbol('test')), { name: 'TypeError' });
});
