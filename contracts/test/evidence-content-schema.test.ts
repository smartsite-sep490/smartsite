import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { computeCanonicalPayloadHash } from '../src/hashing/canonical-hash.js';
import { validateObservationEvent } from '../src/validation/schema-validator.js';

interface EvidenceVectorFile {
  vectorVersion: string;
  schemaVersion: string;
  expectedCanonicalHash: string;
  event: Record<string, unknown>;
}

const vectorUrl = new URL('../../test/evidence-content-v1.2-vectors.json', import.meta.url);
const vectorData = JSON.parse(readFileSync(vectorUrl, 'utf8')) as EvidenceVectorFile;

const SHA_FRAME = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const SHA_CROP = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
const SHA_SNAPSHOT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function buildV12Event(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...structuredClone(vectorData.event),
    ...overrides,
  };
}

describe('Observation Event v1.2 Evidence Content SHA-256 Binding', () => {
  it('1. accepts a valid v1.2.0 envelope with lowercase 64-hex sha256 across FRAME, CROP, and SNAPSHOT evidence', () => {
    const event = buildV12Event({
      evidence: [
        { kind: 'FRAME', uri: 'local://frames/f1.jpg', sha256: SHA_FRAME },
        {
          kind: 'CROP',
          uri: 'local://crops/c1.jpg',
          trackId: 7,
          boundingBox: { x1: 0.1, y1: 0.2, x2: 0.4, y2: 0.8, coordinateSpace: 'NORMALIZED_0_1' },
          sha256: SHA_CROP,
        },
        { kind: 'SNAPSHOT', uri: 'local://snapshots/s1.jpg', sha256: SHA_SNAPSHOT },
      ],
    });

    const result = validateObservationEvent(event);
    assert.equal(
      result.isValid,
      true,
      `Expected valid v1.2 event, got: ${JSON.stringify(result.issues)}`,
    );
    assert.deepEqual(result.issues, []);
  });

  it('2. rejects missing or malformed sha256 across FRAME, CROP, and SNAPSHOT evidence in v1.2.0', () => {
    for (const kind of ['FRAME', 'CROP', 'SNAPSHOT'] as const) {
      const missingSha = buildV12Event({
        evidence: [{ kind, uri: `local://media/${kind.toLowerCase()}.jpg` }],
      });
      const missingResult = validateObservationEvent(missingSha);
      assert.equal(missingResult.isValid, false, `Missing sha256 for ${kind} must fail`);
      assert.ok(
        missingResult.issues.some(
          (issue) => issue.code === 'SCHEMA_VIOLATION' && issue.path === '/evidence/0/sha256',
        ),
        `Expected /evidence/0/sha256 violation for missing ${kind} sha256, got: ${JSON.stringify(missingResult.issues)}`,
      );

      for (const badSha of [
        '',
        SHA_FRAME.slice(0, 63),
        `${SHA_FRAME}0`,
        SHA_FRAME.toUpperCase(),
        `${SHA_FRAME.slice(0, 63)}g`,
      ]) {
        const invalidSha = buildV12Event({
          evidence: [{ kind, uri: `local://media/${kind.toLowerCase()}.jpg`, sha256: badSha }],
        });
        const invalidResult = validateObservationEvent(invalidSha);
        assert.equal(
          invalidResult.isValid,
          false,
          `Invalid sha256 (${badSha}) for ${kind} must fail`,
        );
        assert.ok(
          invalidResult.issues.some(
            (issue) => issue.code === 'SCHEMA_VIOLATION' && issue.path === '/evidence/0/sha256',
          ),
          `Expected /evidence/0/sha256 violation for ${kind} badSha=${badSha}`,
        );
      }
    }
  });

  it('3. preserves v1.0.0 and v1.1.0 without sha256 and rejects sha256 on v1.0.0 and v1.1.0 evidence items', () => {
    for (const version of ['1.0.0', '1.1.0'] as const) {
      const legacyValid = buildV12Event({
        schemaVersion: version,
        evidence: [{ kind: 'FRAME', uri: 'local://frames/legacy.jpg' }],
      });
      const validResult = validateObservationEvent(legacyValid);
      assert.equal(validResult.isValid, true, `Expected ${version} without sha256 to remain valid`);

      const legacyWithSha = buildV12Event({
        schemaVersion: version,
        evidence: [{ kind: 'FRAME', uri: 'local://frames/legacy.jpg', sha256: SHA_FRAME }],
      });
      const rejectedResult = validateObservationEvent(legacyWithSha);
      assert.equal(rejectedResult.isValid, false, `Expected ${version} with sha256 to be rejected`);
      assert.ok(
        rejectedResult.issues.some(
          (issue) => issue.code === 'SCHEMA_VIOLATION' && issue.path === '/evidence/0/sha256',
        ),
      );
    }
  });

  it('4. accepts v1.2.0 events with empty evidence array', () => {
    const emptyEvidenceEvent = buildV12Event({ evidence: [] });
    const result = validateObservationEvent(emptyEvidenceEvent);
    assert.equal(
      result.isValid,
      true,
      `Expected v1.2 empty evidence to be valid: ${JSON.stringify(result.issues)}`,
    );
    assert.deepEqual(result.issues, []);
  });

  it('5. enforces strict unknown-field rejection, unknown schemaVersion rejection, and bounding-box geometry boundaries in v1.2.0', () => {
    const extraEvidenceField = buildV12Event({
      evidence: [
        { kind: 'FRAME', uri: 'local://frames/f1.jpg', sha256: SHA_FRAME, digest: SHA_FRAME },
      ],
    });
    const extraResult = validateObservationEvent(extraEvidenceField);
    assert.equal(extraResult.isValid, false);
    assert.ok(
      extraResult.issues.some(
        (issue) => issue.code === 'SCHEMA_VIOLATION' && issue.path === '/evidence/0/digest',
      ),
    );

    const invalidGeometry = buildV12Event({
      evidence: [
        {
          kind: 'CROP',
          uri: 'local://crops/c1.jpg',
          sha256: SHA_CROP,
          boundingBox: { x1: 0.6, y1: 0.2, x2: 0.6, y2: 0.8, coordinateSpace: 'NORMALIZED_0_1' },
        },
      ],
    });
    const geometryResult = validateObservationEvent(invalidGeometry);
    assert.equal(geometryResult.isValid, false);
    assert.ok(
      geometryResult.issues.some(
        (issue) => issue.code === 'INVALID_GEOMETRY' && issue.path === '/evidence/0/boundingBox',
      ),
    );

    const unknownVersion = buildV12Event({ schemaVersion: '1.3.0' });
    assert.equal(validateObservationEvent(unknownVersion).isValid, false);
  });

  it('6. binds evidence sha256 into canonical payload hash and validates versioned v1.2 vector', () => {
    const vectorResult = validateObservationEvent(vectorData.event);
    assert.equal(
      vectorResult.isValid,
      true,
      `Vector event must be valid v1.2: ${JSON.stringify(vectorResult.issues)}`,
    );

    const vectorHash = computeCanonicalPayloadHash(vectorData.event);
    assert.match(vectorHash, /^[0-9a-f]{64}$/);
    assert.equal(vectorHash, vectorData.expectedCanonicalHash);

    const mutatedEvent = buildV12Event({
      evidence: [
        {
          kind: 'FRAME',
          uri: 'local://frames/2026-10-20/event-11111111.jpg',
          sha256: '1123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        },
        (vectorData.event.evidence as unknown[])[1],
      ],
    });
    const mutatedHash = computeCanonicalPayloadHash(mutatedEvent);
    assert.notEqual(
      mutatedHash,
      vectorHash,
      'Changing bound evidence sha256 must change canonical payload hash',
    );
  });
});
