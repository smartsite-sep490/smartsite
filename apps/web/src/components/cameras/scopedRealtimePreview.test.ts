import { expect, it } from 'vitest';
import { parseScopedRealtimePreview } from './scopedRealtimePreview';

const frame = () => ({
  type: 'frame',
  previewVersion: 1,
  cameraExternalId: 'CAM-01',
  sessionId: '11111111-1111-4111-8111-111111111111',
  sequenceNumber: '9007199254740993',
  capturedAt: '2026-11-03T04:00:00Z',
  width: 640,
  height: 480,
  imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
  detections: [],
  zoneDetections: [],
  zonePolygons: [],
});
const detection = () => ({
  trackId: 3,
  confidence: 0.9,
  active: true,
  label: 'UNKNOWN',
  boundingBox: { x1: 0.1, y1: 0.2, x2: 0.4, y2: 0.8 },
  ppeStatus: {
    HARD_HAT: 'UNKNOWN',
    SAFETY_VEST: 'UNKNOWN',
    GLOVES: 'MISSING',
    BOOTS: 'PRESENT',
    GOGGLES: 'UNKNOWN',
  },
  alertState: 'UNKNOWN',
  confirmedMissingItems: ['GLOVES'],
});

it('preserves five wearer observations, exact sequence and explicit confirmed items separately', () => {
  const parsed = parseScopedRealtimePreview({ ...frame(), detections: [detection()] });
  expect(parsed.sequenceNumber).toBe('9007199254740993');
  expect(parsed.detections[0]).toMatchObject({
    ppeStatus: detection().ppeStatus,
    alertState: 'UNKNOWN',
    confirmedMissingItems: ['GLOVES'],
    trackId: 3,
  });
  expect(parsed.detections[0]?.eventId).toBe('REALTIME-ppe-TRACK-3');
  expect(parsed.detections[0]).not.toHaveProperty('workerId');
});

it('keeps raw PPE objects separate and never infers a wearer state from them', () => {
  const modelObjects = {
    modelFamily: 'yolo11s',
    experimental: true,
    scope: 'OBJECT_DETECTION_ONLY',
    artifactId: 'trial',
    artifactSha256: 'a'.repeat(64),
    detections: [
      {
        classId: 5,
        className: 'Gloves',
        confidence: 0.8,
        boundingBox: { x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.4, coordinateSpace: 'NORMALIZED_0_1' },
      },
    ],
  };
  const parsed = parseScopedRealtimePreview({ ...frame(), modelObjects });
  expect(parsed.modelObjects).toEqual(modelObjects);
  expect(parsed.detections).toEqual([]);
  expect(parsed.zoneDetections).toEqual([]);
});

it('defaults zone wearer state to UNKNOWN and rejects credential/identity or malformed frames', () => {
  const zone = { ...detection(), ppeStatus: undefined };
  expect(
    parseScopedRealtimePreview({ ...frame(), zoneDetections: [zone] }).zoneDetections[0]?.ppeStatus,
  ).toEqual({ HARD_HAT: 'UNKNOWN', SAFETY_VEST: 'UNKNOWN' });
  for (const value of [
    { ...frame(), token: 'forbidden' },
    { ...frame(), detections: [{ ...detection(), workerId: 'not-identity' }] },
    { ...frame(), sequenceNumber: 3 },
    { ...frame(), width: 0 },
  ]) {
    expect(() => parseScopedRealtimePreview(value)).toThrow();
  }
});
