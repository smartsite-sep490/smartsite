import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateGeometry, validateBoundingBox, validatePolygon } from '../src/validation/geometry-validator.js';

test('validateBoundingBox passes for valid normalized coordinates where x1 < x2 and y1 < y2', () => {
  const validBox = {
    x1: 0.1,
    y1: 0.2,
    x2: 0.5,
    y2: 0.8,
    coordinateSpace: 'NORMALIZED_0_1' as const,
  };

  const issues = validateBoundingBox(validBox, '/boundingBox');
  assert.equal(issues.length, 0);
});

test('validateBoundingBox rejects inverted horizontal coordinates x1 >= x2', () => {
  const invertedBox = {
    x1: 0.7,
    y1: 0.2,
    x2: 0.3,
    y2: 0.8,
    coordinateSpace: 'NORMALIZED_0_1' as const,
  };

  const issues = validateBoundingBox(invertedBox, '/boundingBox');
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.code, 'INVALID_GEOMETRY');
  assert.equal(issues[0]?.path, '/boundingBox/x1');
  assert.match(issues[0]?.message ?? '', /must be strictly less than/);
});

test('validateBoundingBox rejects inverted vertical coordinates y1 >= y2', () => {
  const invertedBox = {
    x1: 0.1,
    y1: 0.85,
    x2: 0.4,
    y2: 0.25,
    coordinateSpace: 'NORMALIZED_0_1' as const,
  };

  const issues = validateBoundingBox(invertedBox, '/boundingBox');
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.code, 'INVALID_GEOMETRY');
  assert.equal(issues[0]?.path, '/boundingBox/y1');
  assert.match(issues[0]?.message ?? '', /must be strictly less than/);
});

test('validateBoundingBox rejects collapsed zero-area bounding boxes where x1 == x2 or y1 == y2', () => {
  const collapsedBox = {
    x1: 0.5,
    y1: 0.2,
    x2: 0.5,
    y2: 0.8,
    coordinateSpace: 'NORMALIZED_0_1' as const,
  };

  const issues = validateBoundingBox(collapsedBox, '/boundingBox');
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.code, 'INVALID_GEOMETRY');
});

test('validatePolygon passes for valid polygon with at least 3 normalized vertices', () => {
  const validPolygon = [
    { x: 0.1, y: 0.1 },
    { x: 0.9, y: 0.1 },
    { x: 0.5, y: 0.8 },
  ];

  const issues = validatePolygon(validPolygon, '/polygon');
  assert.equal(issues.length, 0);
});

test('validatePolygon rejects polygon with fewer than 3 vertices', () => {
  const degeneratePolygon = [
    { x: 0.1, y: 0.1 },
    { x: 0.9, y: 0.1 },
  ];

  const issues = validatePolygon(degeneratePolygon, '/polygon');
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.code, 'INVALID_GEOMETRY');
  assert.equal(issues[0]?.path, '/polygon');
  assert.match(issues[0]?.message ?? '', /at least 3 vertices/);
});

test('validatePolygon rejects vertices outside normalized [0.0, 1.0] bounds', () => {
  const outOfBoundsPolygon = [
    { x: -0.1, y: 0.1 },
    { x: 0.9, y: 1.2 },
    { x: 0.5, y: 0.8 },
  ];

  const issues = validatePolygon(outOfBoundsPolygon, '/polygon');
  assert.equal(issues.length, 2);
  assert.equal(issues[0]?.path, '/polygon/0/x');
  assert.equal(issues[1]?.path, '/polygon/1/y');
});

test('validateGeometry inspects all observations in a technical observation event', () => {
  const event = {
    eventId: 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d',
    observations: [
      {
        type: 'PERSON',
        trackId: 1,
        confidence: 0.9,
        boundingBox: {
          x1: 0.6,
          y1: 0.1,
          x2: 0.2, // INVALID: x1 > x2
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
        qualityScore: 0.9,
        boundingBox: {
          x1: 0.1,
          y1: 0.7,
          x2: 0.3,
          y2: 0.4, // INVALID: y1 > y2
          coordinateSpace: 'NORMALIZED_0_1',
        },
      },
    ],
  };

  const issues = validateGeometry(event);
  assert.equal(issues.length, 2);
  assert.equal(issues[0]?.path, '/observations/0/boundingBox/x1');
  assert.equal(issues[1]?.path, '/observations/1/boundingBox/y1');
});
