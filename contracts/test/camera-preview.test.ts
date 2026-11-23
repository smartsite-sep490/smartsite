import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCameraPreviewFrame, parseCameraPreviewResponse } from '../src/camera-preview.js';

const SITE_ID = '11111111-1111-4111-8111-111111111111';
const CAMERA_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';

function baseFrame() {
  return {
    type: 'frame',
    previewVersion: 1,
    cameraExternalId: 'CAM-01',
    sessionId: SESSION_ID,
    sequenceNumber: '42',
    capturedAt: '2026-11-23T04:00:00Z',
    width: 640,
    height: 480,
    imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
    detections: [],
    zoneDetections: [],
    zonePolygons: [],
  };
}

function baseResponse(frame: unknown) {
  return {
    siteId: SITE_ID,
    cameraId: CAMERA_ID,
    cameraExternalId: 'CAM-01',
    sourceKind: 'LIVE',
    frame,
  };
}

test('parseCameraPreviewFrame allows omitted zoneAnchor for legacy payloads and preserves valid enum values', () => {
  const legacy = parseCameraPreviewFrame(baseFrame());
  assert.equal(legacy.zoneAnchor, undefined);
  assert.equal('zoneAnchor' in legacy, false);

  const bottom = parseCameraPreviewFrame({ ...baseFrame(), zoneAnchor: 'BOTTOM_CENTER' });
  assert.equal(bottom.zoneAnchor, 'BOTTOM_CENTER');

  const boxCenter = parseCameraPreviewFrame({ ...baseFrame(), zoneAnchor: 'BOX_CENTER' });
  assert.equal(boxCenter.zoneAnchor, 'BOX_CENTER');

  const response = parseCameraPreviewResponse(
    baseResponse({ ...baseFrame(), zoneAnchor: 'BOX_CENTER' }),
  );
  assert.equal(response.frame.zoneAnchor, 'BOX_CENTER');
});

test('parseCameraPreviewFrame and parseCameraPreviewResponse reject invalid zoneAnchor values', () => {
  for (const invalidAnchor of [
    null,
    '',
    'CENTER',
    'TOP_CENTER',
    'box_center',
    'bottom_center',
    123,
    true,
    { toString: () => 'BOX_CENTER' },
  ]) {
    assert.throws(() => parseCameraPreviewFrame({ ...baseFrame(), zoneAnchor: invalidAnchor }));
    assert.throws(() =>
      parseCameraPreviewResponse(baseResponse({ ...baseFrame(), zoneAnchor: invalidAnchor })),
    );
  }
});
