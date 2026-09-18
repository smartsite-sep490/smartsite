import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateObservationEvent } from '../src/validation/schema-validator.js';
import type { ValidationIssue } from '../src/validation/geometry-validator.js';

const validBaseEvent = {
  eventId: 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6',
  schemaVersion: '1.0.0',
  cameraExternalId: 'CAM_GATE_01',
  streamSessionId: 'SESSION_20260918_001',
  capturedAt: '2026-09-18T10:15:30.500Z',
  frameDimensions: {
    width: 1920,
    height: 1080,
  },
  observations: [
    {
      type: 'PERSON',
      trackId: 1,
      confidence: 0.95,
      boundingBox: {
        x1: 0.1,
        y1: 0.2,
        x2: 0.5,
        y2: 0.8,
        coordinateSpace: 'NORMALIZED_0_1',
      },
    },
    {
      type: 'PPE',
      trackId: 1,
      ppeItem: 'HARD_HAT',
      status: 'MISSING',
      confidence: 0.9,
      qualityScore: 0.85,
    },
    {
      type: 'ZONE_ENTRY',
      trackId: 1,
      zoneId: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
      regionId: 'b2c3d4e5-f6a7-4b5c-9d0e-1f2a3b4c5d6e',
      geometryVersion: 1,
      polygonOverlapRatio: 0.8,
      isInside: true,
    },
    {
      type: 'IDENTITY_CANDIDATE',
      trackId: 1,
      status: 'CANDIDATE',
      candidateWorkerId: 'W-1001',
      similarityScore: 0.92,
      qualityScore: 0.88,
    },
  ],
  evidence: [
    {
      id: 'EVID-001',
      type: 'FULL_FRAME',
      storageUri: 's3://smartsite/frames/f1.jpg',
      mimeType: 'image/jpeg',
      trackId: 1,
    },
  ],
};

test('validateObservationEvent succeeds for canonical valid event payload', () => {
  const result = validateObservationEvent(validBaseEvent);
  assert.equal(result.isValid, true);
  assert.equal(result.issues.length, 0);
});

test('validateObservationEvent rejects missing top-level required fields', () => {
  const incomplete = { ...validBaseEvent };
  delete (incomplete as Record<string, unknown>).eventId;
  delete (incomplete as Record<string, unknown>).cameraExternalId;

  const result = validateObservationEvent(incomplete);
  assert.equal(result.isValid, false);
  assert.ok(result.issues.some((i: ValidationIssue) => i.code === 'SCHEMA_VIOLATION' && i.message.includes('eventId')));
  assert.ok(result.issues.some((i: ValidationIssue) => i.code === 'SCHEMA_VIOLATION' && i.message.includes('cameraExternalId')));
});

test('validateObservationEvent strictly enforces additionalProperties:false at all levels', () => {
  const extraTopLevel = { ...validBaseEvent, rogueProperty: 'illegal' };
  const res1 = validateObservationEvent(extraTopLevel);
  assert.equal(res1.isValid, false);
  assert.ok(res1.issues.some((i: ValidationIssue) => i.code === 'SCHEMA_VIOLATION' && i.message.includes('rogueProperty')));

  const extraInObservation = JSON.parse(JSON.stringify(validBaseEvent));
  extraInObservation.observations[0].rogueNestedProperty = 123;
  const res2 = validateObservationEvent(extraInObservation);
  assert.equal(res2.isValid, false);
  assert.ok(res2.issues.some((i: ValidationIssue) => i.code === 'SCHEMA_VIOLATION' && i.path.includes('/observations/0')));
});

test('validateObservationEvent requires at least one observation item', () => {
  const emptyObs = { ...validBaseEvent, observations: [] };
  const result = validateObservationEvent(emptyObs);
  assert.equal(result.isValid, false);
  assert.ok(result.issues.some((i: ValidationIssue) => i.code === 'SCHEMA_VIOLATION' && i.path.includes('/observations')));
});

test('validateObservationEvent rejects non-UUID and non-date formats', () => {
  const invalidFormat = {
    ...validBaseEvent,
    eventId: 'not-a-uuid',
    capturedAt: 'invalid-date-format',
  };
  const result = validateObservationEvent(invalidFormat);
  assert.equal(result.isValid, false);
  assert.ok(result.issues.some((i: ValidationIssue) => i.path === '/eventId'));
  assert.ok(result.issues.some((i: ValidationIssue) => i.path === '/capturedAt'));
});

test('validateObservationEvent rejects coordinate bounds outside [0.0, 1.0]', () => {
  const outOfBounds = JSON.parse(JSON.stringify(validBaseEvent));
  outOfBounds.observations[0].boundingBox.x2 = 1.25;
  const result = validateObservationEvent(outOfBounds);
  assert.equal(result.isValid, false);
  assert.ok(result.issues.some((i: ValidationIssue) => i.code === 'SCHEMA_VIOLATION' && i.path.includes('/boundingBox/x2')));
});

test('validateObservationEvent enforces conditional identity semantics (BR-16)', () => {
  // 1. CANDIDATE status requires candidateWorkerId and similarityScore
  const missingCandidateFields = JSON.parse(JSON.stringify(validBaseEvent));
  delete missingCandidateFields.observations[3].candidateWorkerId;
  const res1 = validateObservationEvent(missingCandidateFields);
  assert.equal(res1.isValid, false);
  assert.ok(res1.issues.some((i: ValidationIssue) => i.code === 'SCHEMA_VIOLATION' && i.path.includes('/observations/3')));

  // 2. UNKNOWN status forbids candidateWorkerId
  const unknownWithId = JSON.parse(JSON.stringify(validBaseEvent));
  unknownWithId.observations[3].status = 'UNKNOWN';
  unknownWithId.observations[3].candidateWorkerId = 'W-1001';
  const res2 = validateObservationEvent(unknownWithId);
  assert.equal(res2.isValid, false);
  assert.ok(res2.issues.some((i: ValidationIssue) => i.code === 'SCHEMA_VIOLATION' && i.path.includes('/observations/3')));

  // 3. UNAVAILABLE status forbids candidateWorkerId
  const unavailableWithId = JSON.parse(JSON.stringify(validBaseEvent));
  unavailableWithId.observations[3].status = 'UNAVAILABLE';
  unavailableWithId.observations[3].candidateWorkerId = 'W-1001';
  const res3 = validateObservationEvent(unavailableWithId);
  assert.equal(res3.isValid, false);
  assert.ok(res3.issues.some((i: ValidationIssue) => i.code === 'SCHEMA_VIOLATION' && i.path.includes('/observations/3')));

  // 4. UNKNOWN status without candidateWorkerId is valid
  const unknownWithoutId = JSON.parse(JSON.stringify(validBaseEvent));
  unknownWithoutId.observations[3].status = 'UNKNOWN';
  delete unknownWithoutId.observations[3].candidateWorkerId;
  delete unknownWithoutId.observations[3].similarityScore;
  const res4 = validateObservationEvent(unknownWithoutId);
  assert.equal(res4.isValid, true);
});

test('validateObservationEvent integrates semantic geometry validation', () => {
  const invertedGeometry = JSON.parse(JSON.stringify(validBaseEvent));
  invertedGeometry.observations[0].boundingBox.x1 = 0.8;
  invertedGeometry.observations[0].boundingBox.x2 = 0.2; // x1 > x2

  const result = validateObservationEvent(invertedGeometry);
  assert.equal(result.isValid, false);
  assert.ok(result.issues.some((i: ValidationIssue) => i.code === 'INVALID_GEOMETRY' && i.path === '/observations/0/boundingBox/x1'));
});
