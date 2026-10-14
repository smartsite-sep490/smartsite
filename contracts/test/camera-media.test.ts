import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as contracts from '../src/camera-preview.js';

const valid = () => ({
  type: 'media-frame',
  mediaVersion: 1,
  cameraExternalId: 'camera-a',
  sessionId: '33333333-3333-4333-8333-333333333333',
  sequenceNumber: '42',
  capturedAt: '2026-10-08T11:30:00Z',
  width: 640,
  height: 360,
  imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
});
const parse = (input: unknown) =>
  (
    contracts as unknown as {
      parseCameraMediaFrame: (input: unknown) => unknown;
    }
  ).parseCameraMediaFrame(input);
test('raw media frame has an independent strict parser', () => {
  assert.equal(
    typeof (contracts as unknown as Record<string, unknown>).parseCameraMediaFrame,
    'function',
  );
  assert.deepEqual(parse(valid()), valid());
});
test('media frame rejects AI observations and credentials', () => {
  for (const extra of [{ detections: [] }, { token: 'secret' }, { modelObjects: {} }]) {
    assert.throws(() => parse({ ...valid(), ...extra }));
  }
});
test('media frame rejects malformed scope, time and sequence', () => {
  for (const extra of [
    { sessionId: 'bad' },
    { cameraExternalId: '' },
    { capturedAt: '2026-01-01' },
    { sequenceNumber: '-1' },
    { sequenceNumber: '9223372036854775808' },
    { mediaVersion: 2 },
  ]) {
    assert.throws(() => parse({ ...valid(), ...extra }));
  }
});
test('media frame rejects large pixels and non-JPEG payloads', () => {
  for (const extra of [
    { width: 1280 },
    { height: 2000 },
    { imageDataUrl: 'data:text/html;base64,AAAA' },
    { imageDataUrl: 'data:image/jpeg;base64,' + 'A'.repeat(262144) },
  ]) {
    assert.throws(() => parse({ ...valid(), ...extra }));
  }
});
