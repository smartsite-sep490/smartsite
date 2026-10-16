import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as contracts from '../src/camera-preview.js';

const parse = (value: unknown) => {
  const parser = (contracts as unknown as Record<string, (v: unknown) => unknown>)
    .parseCameraPreviewResponse;
  assert.equal(typeof parser, 'function', 'scoped preview parser must exist');
  return parser!(value);
};
const valid = () => ({
  siteId: '11111111-1111-4111-8111-111111111111',
  cameraId: '22222222-2222-4222-8222-222222222222',
  cameraExternalId: 'camera-a',
  sourceKind: 'LIVE',
  frame: {
    type: 'frame',
    previewVersion: 1,
    cameraExternalId: 'camera-a',
    sessionId: '33333333-3333-4333-8333-333333333333',
    sequenceNumber: '1',
    capturedAt: '2026-10-06T12:00:00Z',
    width: 640,
    height: 480,
    imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
    detections: [],
    zoneDetections: [],
    zonePolygons: [],
  },
});
test('scoped preview preserves an exact bounded source envelope', () => {
  assert.deepEqual(parse(valid()), valid());
});

const objects = () => ({
  modelFamily: 'yolo11s', experimental: true, scope: 'OBJECT_DETECTION_ONLY',
  artifactId: 'unified8-experiment', artifactSha256: 'a'.repeat(64),
  detections: contracts.EXPERIMENTAL_OBJECT_CLASSES.map((className, classId) => ({
    classId, className, confidence: 0.8,
    boundingBox: { x1: 0.1, y1: 0.2, x2: 0.4, y2: 0.7, coordinateSpace: 'NORMALIZED_0_1' },
  })),
});
test('unified8 raw objects preserve all 15 class identities separately from wearer state', () => {
  const value = { ...valid(), frame: { ...valid().frame, modelObjects: objects() } };
  assert.deepEqual(parse(value), value);
  assert.doesNotThrow(() => parse({ ...valid(), frame: { ...valid().frame, modelObjects: { ...objects(), detections: [] } } }));
});
test('experimental objects refuse classification, geometry, scope and credential injection', () => {
  const good = objects();
  for (const modelObjects of [
    { ...good, experimental: false }, { ...good, scope: 'COMPLIANT' },
    { ...good, artifactSha256: 'bad' }, { ...good, serviceToken: 'never-relay' },
    { ...good, detections: Array(1025).fill(good.detections[0]) },
    { ...good, detections: [{ ...good.detections[0], className: 'Lanyard-Hook' }] },
    { ...good, detections: [{ ...good.detections[0], confidence: Number.NaN }] },
    { ...good, detections: [{ ...good.detections[0], workerId: 'not-authoritative' }] },
    { ...good, detections: [{ ...good.detections[0], boundingBox: { ...good.detections[0]!.boundingBox, x2: 1.1 } }] },
    { ...good, detections: [{ ...good.detections[0], boundingBox: { ...good.detections[0]!.boundingBox, x2: 0.05 } }] },
  ]) assert.throws(() => parse({ ...valid(), frame: { ...valid().frame, modelObjects } }));
});
test('preview timestamps require an explicit RFC3339 timezone', () => {
  for (const capturedAt of ['2026-10-06T12:00:00', '10/06/2026 12:00:00', '2026-10-06']) {
    assert.throws(() => parse({ ...valid(), frame: { ...valid().frame, capturedAt } }));
  }
  for (const capturedAt of ['2026-10-06T12:00:00.123456+00:00', '2026-10-06T19:00:00+07:00']) {
    assert.doesNotThrow(() => parse({ ...valid(), frame: { ...valid().frame, capturedAt } }));
  }
});
test('scoped preview refuses camera mismatch, credential additions and malformed frames', () => {
  for (const value of [
    { ...valid(), cameraExternalId: 'camera-b' },
    { ...valid(), upstreamUrl: 'http://private.invalid' },
    { ...valid(), sourceKind: 'UNKNOWN' },
    { ...valid(), siteId: '../other' },
    { ...valid(), frame: { ...valid().frame, width: 2000 } },
    { ...valid(), frame: { ...valid().frame, sequenceNumber: '-1' } },
    { ...valid(), frame: { ...valid().frame, imageDataUrl: 'data:image/svg+xml;evil' } },
    { ...valid(), frame: { ...valid().frame, detections: Array(1025).fill({}) } },
    { ...valid(), frame: { ...valid().frame, imageDataUrl: 'a'.repeat(1_400_001) } },
  ])
    assert.throws(() => parse(value));
});
test('scoped preview refuses unsupported PPE and ambiguous unbounded geometry', () => {
  const detection = {
    trackId: 1,
    confidence: 0.9,
    active: false,
    label: 'PPE UNKNOWN',
    boundingBox: { x1: 0.1, y1: 0.1, x2: 0.4, y2: 0.9 },
    ppeStatus: { HARD_HAT: 'UNKNOWN', SAFETY_VEST: 'UNKNOWN', MASK: 'PRESENT' },
  };
  assert.throws(() => parse({ ...valid(), frame: { ...valid().frame, detections: [detection] } }));
  delete (detection.ppeStatus as Record<string, string>).MASK;
  assert.doesNotThrow(() =>
    parse({ ...valid(), frame: { ...valid().frame, detections: [detection] } }),
  );
  detection.boundingBox.x2 = Number.NaN;
  assert.throws(() => parse({ ...valid(), frame: { ...valid().frame, detections: [detection] } }));
});
test('preview does not relay unexpected credential fields nested in detections', () => {
  const detection = {
    trackId: 1,
    confidence: 0.9,
    active: false,
    label: 'UNKNOWN',
    boundingBox: { x1: 0.1, y1: 0.1, x2: 0.4, y2: 0.9 },
    ppeStatus: { HARD_HAT: 'UNKNOWN', SAFETY_VEST: 'UNKNOWN' },
    token: 'fake-service-token-canary',
  };
  assert.throws(() => parse({ ...valid(), frame: { ...valid().frame, detections: [detection] } }));
});
test('preview accepts the normalized coordinate-space marker emitted by AI', () => {
  const detection = {
    trackId: 1,
    confidence: 0.9,
    active: false,
    label: 'UNKNOWN',
    boundingBox: { x1: 0.1, y1: 0.1, x2: 0.4, y2: 0.9, coordinateSpace: 'NORMALIZED_0_1' },
    ppeStatus: { HARD_HAT: 'UNKNOWN', SAFETY_VEST: 'UNKNOWN' },
  };
  assert.doesNotThrow(() =>
    parse({ ...valid(), frame: { ...valid().frame, detections: [detection] } }),
  );
});
