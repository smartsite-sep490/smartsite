import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateGeometries } from '@smartsite/contracts';

test('validateGeometries passes when bounding boxes in observations and evidence are valid', () => {
  const payload = {
    observations: [
      {
        type: 'PERSON',
        trackId: 1,
        boundingBox: { x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.8, coordinateSpace: 'NORMALIZED_0_1' },
      },
      {
        type: 'PPE',
        trackId: 1,
        ppeItem: 'HARD_HAT',
        status: 'PRESENT',
        regionId: 'f81d4fae-7dec-11d0-a765-00a0c91e6bf6',
        geometryVersion: 1,
        boundingBox: { x1: 0.2, y1: 0.1, x2: 0.4, y2: 0.3, coordinateSpace: 'NORMALIZED_0_1' },
      },
    ],
    evidence: [
      {
        kind: 'CROP',
        uri: 's3://smartsite/evidence/crop-1.jpg',
        trackId: 1,
        boundingBox: { x1: 0.15, y1: 0.15, x2: 0.35, y2: 0.35, coordinateSpace: 'NORMALIZED_0_1' },
      },
    ],
  };

  const issues = validateGeometries(payload);
  assert.equal(issues.length, 0);
});

test('validateGeometries rejects inverted observation horizontal and vertical coordinates', () => {
  const payload = {
    observations: [
      {
        type: 'PERSON',
        trackId: 1,
        boundingBox: { x1: 0.8, y1: 0.9, x2: 0.2, y2: 0.3, coordinateSpace: 'NORMALIZED_0_1' },
      },
    ],
  };

  const issues = validateGeometries(payload);
  assert.equal(issues.length, 2);
  assert.ok(issues.some((i) => i.code === 'INVALID_GEOMETRY' && i.path === '/observations/0/boundingBox' && i.message.includes('x1')));
  assert.ok(issues.some((i) => i.code === 'INVALID_GEOMETRY' && i.path === '/observations/0/boundingBox' && i.message.includes('y1')));
});

test('validateGeometries rejects invalid bounding box in evidence item', () => {
  const payload = {
    observations: [],
    evidence: [
      {
        kind: 'SNAPSHOT',
        uri: 's3://smartsite/evidence/snap-1.jpg',
        boundingBox: { x1: 0.7, y1: 0.1, x2: 0.4, y2: 0.8, coordinateSpace: 'NORMALIZED_0_1' },
      },
    ],
  };

  const issues = validateGeometries(payload);
  assert.equal(issues.length, 1);
  assert.equal(issues[0]?.code, 'INVALID_GEOMETRY');
  assert.equal(issues[0]?.path, '/evidence/0/boundingBox');
  assert.equal(issues[0]?.message, 'x1 must be less than x2');
});

test('validateGeometries safely handles non-array observations and evidence without throwing', () => {
  assert.doesNotThrow(() => {
    const issues = validateGeometries({ observations: {}, evidence: {} });
    assert.deepEqual(issues, []);
  });
});
