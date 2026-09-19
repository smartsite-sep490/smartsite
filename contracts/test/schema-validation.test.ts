import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateObservationEvent } from '@smartsite/contracts';
import type { ValidationIssue } from '@smartsite/contracts';

const baseEvent = {
  eventId: 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6',
  schemaVersion: '1.0.0',
  cameraExternalId: 'cam-gate-01',
  streamSessionId: 'f81d4fae-7dec-11d0-a765-00a0c91e6bf7',
  capturedAt: '2026-09-18T10:00:00.000Z',
  frameDimensions: { width: 1920, height: 1080 },
  evidence: [],
};

test('accepts a valid PERSON observation with only type and trackId', () => {
  const result = validateObservationEvent({
    ...baseEvent,
    observations: [{ type: 'PERSON', trackId: 1 }],
  });
  assert.equal(result.isValid, true);
  assert.equal(result.issues.length, 0);
});

test('accepts PERSON observation with optional confidence and boundingBox', () => {
  const result = validateObservationEvent({
    ...baseEvent,
    observations: [
      {
        type: 'PERSON',
        trackId: 1,
        confidence: 0.95,
        boundingBox: { x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.8, coordinateSpace: 'NORMALIZED_0_1' },
      },
    ],
  });
  assert.equal(result.isValid, true);
});

test('accepts valid PPE observation and enforces PRESENT or MISSING without qualityScore or UNKNOWN', () => {
  const validPpe = validateObservationEvent({
    ...baseEvent,
    observations: [
      {
        type: 'PPE',
        trackId: 1,
        ppeItem: 'HARD_HAT',
        status: 'MISSING',
        regionId: 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6',
        geometryVersion: 1,
      },
    ],
  });
  assert.equal(validPpe.isValid, true);

  // Status UNKNOWN is rejected in authoritative contract
  const unknownStatus = validateObservationEvent({
    ...baseEvent,
    observations: [
      {
        type: 'PPE',
        trackId: 1,
        ppeItem: 'HARD_HAT',
        status: 'UNKNOWN',
        regionId: 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6',
        geometryVersion: 1,
      },
    ],
  });
  assert.equal(unknownStatus.isValid, false);

  // qualityScore is rejected in PPE
  const withQualityScore = validateObservationEvent({
    ...baseEvent,
    observations: [
      {
        type: 'PPE',
        trackId: 1,
        ppeItem: 'HARD_HAT',
        status: 'PRESENT',
        regionId: 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6',
        geometryVersion: 1,
        qualityScore: 0.9,
      },
    ],
  });
  assert.equal(withQualityScore.isValid, false);
});

test('accepts valid ZONE_ENTRY observation with regionId and geometryVersion', () => {
  const result = validateObservationEvent({
    ...baseEvent,
    observations: [
      {
        type: 'ZONE_ENTRY',
        trackId: 1,
        regionId: 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6',
        geometryVersion: 2,
        confidence: 0.85,
      },
    ],
  });
  assert.equal(result.isValid, true);
});

test('strictly rejects AI-supplied zoneId, permission result, polygonOverlapRatio, or isInside in ZONE_ENTRY', () => {
  // 1. Rejects zoneId (Backend owns Zone mapping from regionId)
  const withZoneId = validateObservationEvent({
    ...baseEvent,
    observations: [
      {
        type: 'ZONE_ENTRY',
        trackId: 1,
        regionId: 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6',
        geometryVersion: 1,
        zoneId: 'f81d4fae-7dec-11d0-a765-00a0c91e6bf8',
      },
    ],
  });
  assert.equal(withZoneId.isValid, false);
  assert.ok(withZoneId.issues.some((i: ValidationIssue) => i.message.includes('zoneId')));

  // 2. Rejects isInside
  const withIsInside = validateObservationEvent({
    ...baseEvent,
    observations: [
      {
        type: 'ZONE_ENTRY',
        trackId: 1,
        regionId: 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6',
        geometryVersion: 1,
        isInside: true,
      },
    ],
  });
  assert.equal(withIsInside.isValid, false);
  assert.ok(withIsInside.issues.some((i: ValidationIssue) => i.message.includes('isInside')));

  // 3. Rejects polygonOverlapRatio
  const withOverlap = validateObservationEvent({
    ...baseEvent,
    observations: [
      {
        type: 'ZONE_ENTRY',
        trackId: 1,
        regionId: 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6',
        geometryVersion: 1,
        polygonOverlapRatio: 0.75,
      },
    ],
  });
  assert.equal(withOverlap.isValid, false);

  // 4. Rejects permission results (authorized)
  const withAuthorized = validateObservationEvent({
    ...baseEvent,
    observations: [
      {
        type: 'ZONE_ENTRY',
        trackId: 1,
        regionId: 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6',
        geometryVersion: 1,
        authorized: false,
      },
    ],
  });
  assert.equal(withAuthorized.isValid, false);
});

test('enforces IDENTITY_CANDIDATE exact oneOf semantics (BR-16)', () => {
  // CANDIDATE requires candidateWorkerId and similarityScore
  const validCandidate = validateObservationEvent({
    ...baseEvent,
    observations: [
      {
        type: 'IDENTITY_CANDIDATE',
        trackId: 1,
        status: 'CANDIDATE',
        candidateWorkerId: 'W-1001',
        similarityScore: 0.94,
        qualityScore: 0.88,
      },
    ],
  });
  assert.equal(validCandidate.isValid, true);

  // CANDIDATE missing candidateWorkerId is rejected
  const missingWorkerId = validateObservationEvent({
    ...baseEvent,
    observations: [
      {
        type: 'IDENTITY_CANDIDATE',
        trackId: 1,
        status: 'CANDIDATE',
        similarityScore: 0.94,
      },
    ],
  });
  assert.equal(missingWorkerId.isValid, false);

  // UNKNOWN carrying candidateWorkerId is rejected
  const unknownWithWorker = validateObservationEvent({
    ...baseEvent,
    observations: [
      {
        type: 'IDENTITY_CANDIDATE',
        trackId: 1,
        status: 'UNKNOWN',
        candidateWorkerId: 'W-1001',
      },
    ],
  });
  assert.equal(unknownWithWorker.isValid, false);

  // UNKNOWN carrying similarityScore is rejected
  const unknownWithScore = validateObservationEvent({
    ...baseEvent,
    observations: [
      {
        type: 'IDENTITY_CANDIDATE',
        trackId: 1,
        status: 'UNKNOWN',
        similarityScore: 0.8,
      },
    ],
  });
  assert.equal(unknownWithScore.isValid, false);

  // UNAVAILABLE carrying candidateWorkerId is rejected
  const unavailableWithWorker = validateObservationEvent({
    ...baseEvent,
    observations: [
      {
        type: 'IDENTITY_CANDIDATE',
        trackId: 1,
        status: 'UNAVAILABLE',
        candidateWorkerId: 'W-1001',
      },
    ],
  });
  assert.equal(unavailableWithWorker.isValid, false);

  // Valid UNKNOWN without workerId and similarityScore
  const validUnknown = validateObservationEvent({
    ...baseEvent,
    observations: [
      {
        type: 'IDENTITY_CANDIDATE',
        trackId: 1,
        status: 'UNKNOWN',
        qualityScore: 0.5,
      },
    ],
  });
  assert.equal(validUnknown.isValid, true);
});

test('validates evidence items (FRAME, CROP, SNAPSHOT) and rejects old legacy fields', () => {
  const validEvidence = validateObservationEvent({
    ...baseEvent,
    observations: [{ type: 'PERSON', trackId: 1 }],
    evidence: [
      {
        kind: 'FRAME',
        uri: 's3://smartsite/frames/f1.jpg',
      },
      {
        kind: 'CROP',
        uri: 's3://smartsite/crops/c1.jpg',
        trackId: 1,
        boundingBox: { x1: 0.1, y1: 0.1, x2: 0.4, y2: 0.4, coordinateSpace: 'NORMALIZED_0_1' },
      },
    ],
  });
  assert.equal(validEvidence.isValid, true);

  // Rejects old fields: id, storageUri, mimeType
  const oldEvidenceFields = validateObservationEvent({
    ...baseEvent,
    observations: [{ type: 'PERSON', trackId: 1 }],
    evidence: [
      {
        id: 'EVID-001',
        kind: 'FRAME',
        uri: 's3://smartsite/frames/f1.jpg',
        storageUri: 's3://smartsite/frames/f1.jpg',
        mimeType: 'image/jpeg',
      },
    ],
  });
  assert.equal(oldEvidenceFields.isValid, false);
});

test('rejects invalid evidence geometry', () => {
  const invalidEvidenceGeometry = validateObservationEvent({
    ...baseEvent,
    observations: [{ type: 'PERSON', trackId: 1 }],
    evidence: [
      {
        kind: 'SNAPSHOT',
        uri: 's3://smartsite/snaps/s1.jpg',
        boundingBox: { x1: 0.8, y1: 0.1, x2: 0.2, y2: 0.5, coordinateSpace: 'NORMALIZED_0_1' }, // x1 > x2
      },
    ],
  });
  assert.equal(invalidEvidenceGeometry.isValid, false);
  assert.ok(
    invalidEvidenceGeometry.issues.some(
      (i: ValidationIssue) => i.code === 'INVALID_GEOMETRY' && i.path === '/evidence/0/boundingBox',
    ),
  );
});

test('enforces root constraints: frameDimensions required, UUID streamSessionId, maxLength 128 cameraExternalId', () => {
  // Missing frameDimensions
  const noFrameDimensions = { ...baseEvent, observations: [{ type: 'PERSON', trackId: 1 }] };
  delete (noFrameDimensions as Record<string, unknown>).frameDimensions;
  assert.equal(validateObservationEvent(noFrameDimensions).isValid, false);

  // streamSessionId not a UUID
  const invalidSession = {
    ...baseEvent,
    streamSessionId: 'not-a-uuid-session',
    observations: [{ type: 'PERSON', trackId: 1 }],
  };
  assert.equal(validateObservationEvent(invalidSession).isValid, false);

  // cameraExternalId exceeding 128 chars
  const longCameraId = {
    ...baseEvent,
    cameraExternalId: 'a'.repeat(129),
    observations: [{ type: 'PERSON', trackId: 1 }],
  };
  assert.equal(validateObservationEvent(longCameraId).isValid, false);

  // Extra root property
  const extraRoot = {
    ...baseEvent,
    observations: [{ type: 'PERSON', trackId: 1 }],
    unexpectedProperty: 'forbidden',
  };
  assert.equal(validateObservationEvent(extraRoot).isValid, false);
});

test('does not throw and returns isValid: false when observations or evidence have non-array types (observations:{}, evidence:{})', () => {
  assert.doesNotThrow(() => {
    const resObservationsObj = validateObservationEvent({
      ...baseEvent,
      observations: {},
    });
    assert.equal(resObservationsObj.isValid, false);
    assert.ok(
      resObservationsObj.issues.some(
        (i: ValidationIssue) => i.code === 'SCHEMA_VIOLATION' && i.path.includes('observations'),
      ),
    );
  });

  assert.doesNotThrow(() => {
    const resEvidenceObj = validateObservationEvent({
      ...baseEvent,
      observations: [{ type: 'PERSON', trackId: 1 }],
      evidence: {},
    });
    assert.equal(resEvidenceObj.isValid, false);
    assert.ok(
      resEvidenceObj.issues.some(
        (i: ValidationIssue) => i.code === 'SCHEMA_VIOLATION' && i.path.includes('evidence'),
      ),
    );
  });
});

test('strictly rejects PPE observation missing regionId or geometryVersion and asserts required issues', () => {
  // Missing regionId
  const missingRegion = validateObservationEvent({
    ...baseEvent,
    observations: [
      {
        type: 'PPE',
        trackId: 1,
        ppeItem: 'HARD_HAT',
        status: 'PRESENT',
        geometryVersion: 1,
      },
    ],
  });
  assert.equal(missingRegion.isValid, false);
  assert.ok(
    missingRegion.issues.some(
      (i: ValidationIssue) =>
        i.path === '/observations/0/regionId' && i.message.includes('regionId'),
    ),
  );

  // Missing geometryVersion
  const missingGeomVersion = validateObservationEvent({
    ...baseEvent,
    observations: [
      {
        type: 'PPE',
        trackId: 1,
        ppeItem: 'HARD_HAT',
        status: 'PRESENT',
        regionId: 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6',
      },
    ],
  });
  assert.equal(missingGeomVersion.isValid, false);
  assert.ok(
    missingGeomVersion.issues.some(
      (i: ValidationIssue) =>
        i.path === '/observations/0/geometryVersion' && i.message.includes('geometryVersion'),
    ),
  );
});

test('strictly rejects ZONE_ENTRY observation missing regionId or geometryVersion and asserts required issues', () => {
  // Missing regionId
  const missingRegion = validateObservationEvent({
    ...baseEvent,
    observations: [
      {
        type: 'ZONE_ENTRY',
        trackId: 1,
        geometryVersion: 1,
      },
    ],
  });
  assert.equal(missingRegion.isValid, false);
  assert.ok(
    missingRegion.issues.some(
      (i: ValidationIssue) =>
        i.path === '/observations/0/regionId' && i.message.includes('regionId'),
    ),
  );

  // Missing geometryVersion
  const missingGeomVersion = validateObservationEvent({
    ...baseEvent,
    observations: [
      {
        type: 'ZONE_ENTRY',
        trackId: 1,
        regionId: 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6',
      },
    ],
  });
  assert.equal(missingGeomVersion.isValid, false);
  assert.ok(
    missingGeomVersion.issues.some(
      (i: ValidationIssue) =>
        i.path === '/observations/0/geometryVersion' && i.message.includes('geometryVersion'),
    ),
  );
});

test('rejects values that cannot be represented safely across JavaScript, JCS, and PostgreSQL', () => {
  const unsafeInteger = Number.MAX_SAFE_INTEGER + 1;
  const canonicalUuid = '11111111-1111-4111-8111-111111111111';

  for (const payload of [
    {
      ...baseEvent,
      eventId: `urn:uuid:${canonicalUuid}`,
      observations: [{ type: 'PERSON', trackId: 1 }],
    },
    {
      ...baseEvent,
      capturedAt: '2026-09-18 10:00:00Z',
      observations: [{ type: 'PERSON', trackId: 1 }],
    },
    {
      ...baseEvent,
      capturedAt: '2026-09-18T10:00:00+00',
      observations: [{ type: 'PERSON', trackId: 1 }],
    },
    {
      ...baseEvent,
      frameDimensions: { width: unsafeInteger, height: 1080 },
      observations: [{ type: 'PERSON', trackId: 1 }],
    },
    { ...baseEvent, observations: [{ type: 'PERSON', trackId: unsafeInteger }] },
    {
      ...baseEvent,
      observations: [
        {
          type: 'IDENTITY_CANDIDATE',
          trackId: 1,
          status: 'CANDIDATE',
          candidateWorkerId: 'W'.repeat(129),
          similarityScore: 0.9,
        },
      ],
    },
    {
      ...baseEvent,
      cameraExternalId: 'CAM\u0000BROKEN',
      observations: [{ type: 'PERSON', trackId: 1 }],
    },
    {
      ...baseEvent,
      observations: [{ type: 'PERSON', trackId: 1 }],
      evidence: [{ kind: 'FRAME', uri: 's3://bucket/frame\u0000.jpg' }],
    },
  ]) {
    assert.equal(validateObservationEvent(payload).isValid, false);
  }
});

test('accepts storage and numeric boundary values', () => {
  const result = validateObservationEvent({
    ...baseEvent,
    frameDimensions: { width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER },
    observations: [
      {
        type: 'IDENTITY_CANDIDATE',
        trackId: Number.MAX_SAFE_INTEGER,
        status: 'CANDIDATE',
        candidateWorkerId: 'W'.repeat(128),
        similarityScore: 0.9,
      },
    ],
    evidence: [{ kind: 'FRAME', uri: 's3://bucket/frame.jpg', trackId: Number.MAX_SAFE_INTEGER }],
  });
  assert.equal(result.isValid, true, JSON.stringify(result.issues));
});

test('bounds per-event collection work', () => {
  assert.equal(
    validateObservationEvent({
      ...baseEvent,
      observations: Array.from({ length: 257 }, (_, trackId) => ({ type: 'PERSON', trackId })),
    }).isValid,
    false,
  );
  assert.equal(
    validateObservationEvent({
      ...baseEvent,
      observations: [{ type: 'PERSON', trackId: 1 }],
      evidence: Array.from({ length: 257 }, (_, index) => ({
        kind: 'FRAME',
        uri: `s3://frames/${index}`,
      })),
    }).isValid,
    false,
  );
});
