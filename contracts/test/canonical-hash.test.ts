import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { computeCanonicalPayloadHash, canonicalizeJson } from '../src/hashing/canonical-hash.js';

interface GoldenVector {
  description: string;
  input: unknown;
  expectedCanonicalJson: string;
  expectedSha256: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const vectorsPath = path.resolve(__dirname, '../../test/golden-vectors.json');
const goldenVectors: GoldenVector[] = JSON.parse(fs.readFileSync(vectorsPath, 'utf8'));

test('canonicalizeJson and computeCanonicalPayloadHash match all RFC 8785 golden vectors', () => {
  assert.ok(goldenVectors.length >= 8, 'Expected at least 8 golden test vectors');

  for (const vector of goldenVectors) {
    const actualCanonical = canonicalizeJson(vector.input);
    assert.equal(
      actualCanonical,
      vector.expectedCanonicalJson,
      `Canonical JSON mismatch for vector: "${vector.description}"`,
    );

    const actualSha256 = computeCanonicalPayloadHash(vector.input);
    assert.equal(
      actualSha256,
      vector.expectedSha256,
      `SHA-256 hash mismatch for vector: "${vector.description}"`,
    );
  }
});

test('canonicalizeJson normalizes object key insertion order deterministically', () => {
  const obj1 = { z: 99, a: 'alpha', m: { b: 2, a: 1 } };
  const obj2 = { a: 'alpha', m: { a: 1, b: 2 }, z: 99 };

  const json1 = canonicalizeJson(obj1);
  const json2 = canonicalizeJson(obj2);

  assert.equal(json1, json2);
  assert.equal(computeCanonicalPayloadHash(obj1), computeCanonicalPayloadHash(obj2));
});

test('canonicalizeJson strictly preserves array element order', () => {
  const arr1 = { items: [1, 2, 3] };
  const arr2 = { items: [3, 2, 1] };

  const json1 = canonicalizeJson(arr1);
  const json2 = canonicalizeJson(arr2);

  assert.notEqual(json1, json2);
  assert.notEqual(computeCanonicalPayloadHash(arr1), computeCanonicalPayloadHash(arr2));
});

test('canonicalizeJson rejects undefined and non-serializable values', () => {
  assert.throws(
    () => canonicalizeJson(undefined),
    { name: 'TypeError' },
  );

  assert.throws(
    () => canonicalizeJson(() => {}),
    { name: 'TypeError' },
  );

  assert.throws(
    () => canonicalizeJson(Symbol('sym')),
    { name: 'TypeError' },
  );

  const circular: { self?: unknown } = {};
  circular.self = circular;
  assert.throws(
    () => canonicalizeJson(circular),
    { name: 'TypeError' },
  );
});
