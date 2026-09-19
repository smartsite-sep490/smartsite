import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  computeCanonicalPayloadHash,
  parseCameraRegionConfigurationPayload,
  validateCameraRegionConfiguration,
} from '@smartsite/contracts';

interface CameraRegionVector {
  description: string;
  valid: boolean;
  payload: unknown;
  expectedSha256?: string;
  expectedIssueCode?: string;
  expectedValidationLayer?: 'SCHEMA' | 'SEMANTIC';
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const vectorsCandidate1 = path.resolve(
  __dirname,
  '../../test/camera-region-configuration-vectors.json',
);
const vectorsCandidate2 = path.resolve(__dirname, './camera-region-configuration-vectors.json');
const vectorsPath = existsSync(vectorsCandidate1) ? vectorsCandidate1 : vectorsCandidate2;
const vectors: CameraRegionVector[] = JSON.parse(readFileSync(vectorsPath, 'utf8'));

const requiredDescriptions = [
  'empty active snapshot',
  'one valid polygon',
  '64-vertex valid polygon',
  'same valid polygon with different object-key insertion order',
  'extra root property',
  'duplicate region ID',
  'repeated closing point',
  'zero-area polygon',
  'self-intersecting polygon',
  '65 regions',
] as const;

function vectorByDescription(description: string): CameraRegionVector {
  const vector = vectors.find((candidate) => candidate.description === description);
  assert.ok(vector, `missing vector: ${description}`);
  return vector;
}

test('camera region fixture contains the reviewed valid and invalid cases', () => {
  assert.equal(vectors.length >= requiredDescriptions.length, true);
  for (const description of requiredDescriptions) vectorByDescription(description);

  for (const vector of vectors) {
    assert.notEqual(vector.description, '', 'vector descriptions must be non-empty');
    if (vector.valid) {
      assert.match(
        vector.expectedSha256 ?? '',
        /^[0-9a-f]{64}$/,
        `${vector.description}: valid vectors pin a lowercase SHA-256`,
      );
      assert.equal(vector.expectedIssueCode, undefined, vector.description);
      assert.equal(vector.expectedValidationLayer, undefined, vector.description);
    } else {
      assert.equal(vector.expectedSha256, undefined, vector.description);
      assert.notEqual(vector.expectedIssueCode, undefined, vector.description);
      assert.match(
        vector.expectedValidationLayer ?? '',
        /^(SCHEMA|SEMANTIC)$/,
        `${vector.description}: invalid vectors name their validation layer`,
      );
    }
  }
});

test('valid vectors parse and match their pinned RFC 8785 SHA-256 values', () => {
  for (const vector of vectors.filter((candidate) => candidate.valid)) {
    const result = parseCameraRegionConfigurationPayload(JSON.stringify(vector.payload));
    assert.equal(result.isValid, true, vector.description);
    assert.equal(
      computeCanonicalPayloadHash(vector.payload),
      vector.expectedSha256,
      vector.description,
    );
  }
});

test('invalid vectors fail at their declared validation layer with stable issue codes', () => {
  for (const vector of vectors.filter((candidate) => !candidate.valid)) {
    const schemaResult = validateCameraRegionConfiguration(vector.payload);
    const parseResult = parseCameraRegionConfigurationPayload(JSON.stringify(vector.payload));

    assert.equal(parseResult.isValid, false, vector.description);
    assert.equal(
      parseResult.issues.some((issue) => issue.code === vector.expectedIssueCode),
      true,
      `${vector.description}: expected ${vector.expectedIssueCode}`,
    );

    if (vector.expectedValidationLayer === 'SCHEMA') {
      assert.equal(schemaResult.isValid, false, vector.description);
      assert.equal(vector.expectedIssueCode, 'SCHEMA_VIOLATION', vector.description);
    } else {
      assert.equal(
        schemaResult.isValid,
        true,
        `${vector.description}: semantic vectors must satisfy JSON Schema`,
      );
      assert.notEqual(vector.expectedIssueCode, 'SCHEMA_VIOLATION', vector.description);
    }
  }
});

test('object-key insertion order does not change the canonical payload hash', () => {
  const baseline = vectorByDescription('one valid polygon');
  const reordered = vectorByDescription(
    'same valid polygon with different object-key insertion order',
  );

  assert.deepEqual(reordered.payload, baseline.payload);
  assert.notEqual(JSON.stringify(reordered.payload), JSON.stringify(baseline.payload));
  assert.equal(reordered.expectedSha256, baseline.expectedSha256);
  assert.equal(
    computeCanonicalPayloadHash(reordered.payload),
    computeCanonicalPayloadHash(baseline.payload),
  );
});
