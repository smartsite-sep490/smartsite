import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BROWSER_CAMERA_UPLINK_DEFAULT_INTERVAL_MS,
  BROWSER_CAMERA_UPLINK_DEFAULT_MAX_FRAME_BYTES,
  BROWSER_CAMERA_UPLINK_DEFAULT_MAX_HEIGHT,
  BROWSER_CAMERA_UPLINK_DEFAULT_MAX_WIDTH,
  BROWSER_CAMERA_UPLINK_MAX_FRAME_BYTES,
  BROWSER_CAMERA_UPLINK_SCHEMA_VERSION,
  isFreshBrowserUplinkTimestamp,
  isJpegPayload,
  parseBrowserCameraUplinkFrameMetadata,
  parseBrowserCameraUplinkFrameReceipt,
  parseBrowserCameraUplinkStartCommand,
  parseBrowserCameraUplinkStartResponse,
  parseBrowserCameraUplinkStatusResponse,
  parseBrowserCameraUplinkStopCommand,
  parseBrowserCameraUplinkStopResponse,
} from '../src/browser-camera-uplink.js';

const SITE_ID = '11111111-1111-4111-8111-111111111111';
const CAMERA_ID = '22222222-2222-4222-8222-222222222222';
const LEASE_ID = '33333333-3333-4333-8333-333333333333';

test('default browser uplink limits fit directly inside CameraMediaFrame bounds with zero re-encode', () => {
  assert.equal(BROWSER_CAMERA_UPLINK_SCHEMA_VERSION, '1.0.0');
  assert.equal(BROWSER_CAMERA_UPLINK_DEFAULT_MAX_WIDTH, 640);
  assert.equal(BROWSER_CAMERA_UPLINK_DEFAULT_MAX_HEIGHT, 480);
  assert.equal(BROWSER_CAMERA_UPLINK_DEFAULT_MAX_FRAME_BYTES, 130_000);
  assert.equal(BROWSER_CAMERA_UPLINK_MAX_FRAME_BYTES, 256_000);
  assert.equal(BROWSER_CAMERA_UPLINK_DEFAULT_INTERVAL_MS, 667);
  // Base64 length + data URL prefix must stay <= 180_000 chars for CameraMediaFrame compatibility.
  const base64Chars = Math.ceil(BROWSER_CAMERA_UPLINK_DEFAULT_MAX_FRAME_BYTES / 3) * 4 + 23;
  assert.ok(base64Chars <= 180_000);
});

test('isJpegPayload validates JPEG SOI magic bytes and rejects empty or non-JPEG payloads', () => {
  assert.equal(isJpegPayload(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00])), true);
  assert.equal(isJpegPayload(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), false);
  assert.equal(isJpegPayload(new Uint8Array([0xff, 0xd8])), false);
  assert.equal(isJpegPayload(new Uint8Array([])), false);
});

test('isFreshBrowserUplinkTimestamp enforces <2000ms past age and <=1000ms future skew', () => {
  const nowMs = Date.parse('2026-11-26T12:00:00.000Z');
  assert.equal(isFreshBrowserUplinkTimestamp('2026-11-26T11:59:58.001Z', nowMs), true);
  assert.equal(isFreshBrowserUplinkTimestamp('2026-11-26T11:59:58.000Z', nowMs), false);
  assert.equal(isFreshBrowserUplinkTimestamp('2026-11-26T12:00:01.000Z', nowMs), true);
  assert.equal(isFreshBrowserUplinkTimestamp('2026-11-26T12:00:01.001Z', nowMs), false);
  assert.equal(isFreshBrowserUplinkTimestamp('not-a-timestamp', nowMs), false);
});

test('start command and start response parsers accept valid payloads and reject unknown keys or out-of-range bounds', () => {
  const cmd = parseBrowserCameraUplinkStartCommand({
    clientSessionId: 'tab-session-01',
    deviceLabel: 'Integrated Webcam',
    targetIntervalMs: 667,
  });
  assert.equal(cmd.clientSessionId, 'tab-session-01');
  assert.equal(cmd.targetIntervalMs, 667);

  assert.throws(() =>
    parseBrowserCameraUplinkStartCommand({
      clientSessionId: 'tab-session-01',
      targetIntervalMs: 100, // below minimum 500ms
    }),
  );
  assert.throws(() =>
    parseBrowserCameraUplinkStartCommand({
      clientSessionId: 'tab-session-01',
      extraKey: true,
    }),
  );

  const res = parseBrowserCameraUplinkStartResponse({
    schemaVersion: '1.0.0',
    leaseId: LEASE_ID,
    siteId: SITE_ID,
    cameraId: CAMERA_ID,
    state: 'ACTIVE',
    leaseExpiresAt: '2026-11-26T12:00:15.000Z',
    maxFrameBytes: 130_000,
    maxWidth: 640,
    maxHeight: 480,
    recommendedIntervalMs: 667,
  });
  assert.equal(res.leaseId, LEASE_ID);
  assert.equal(res.state, 'ACTIVE');

  assert.throws(() =>
    parseBrowserCameraUplinkStartResponse({
      schemaVersion: '1.0.0',
      leaseId: LEASE_ID,
      siteId: SITE_ID,
      cameraId: CAMERA_ID,
      state: 'ACTIVE',
      leaseExpiresAt: '2026-11-26T12:00:15.000Z',
      maxFrameBytes: 300_000, // exceeds 256_000 hard cap
      maxWidth: 640,
      maxHeight: 480,
      recommendedIntervalMs: 667,
    }),
  );
});

test('frame metadata and receipt parsers enforce bounds and reject malformed inputs', () => {
  const meta = parseBrowserCameraUplinkFrameMetadata({
    leaseId: LEASE_ID,
    sequence: 1,
    capturedAt: '2026-11-26T12:00:00.000Z',
    width: 640,
    height: 480,
    byteLength: 42_000,
  });
  assert.equal(meta.sequence, 1);

  assert.throws(() =>
    parseBrowserCameraUplinkFrameMetadata({
      leaseId: LEASE_ID,
      sequence: 0, // must be >= 1
      capturedAt: '2026-11-26T12:00:00.000Z',
      width: 640,
      height: 480,
      byteLength: 42_000,
    }),
  );
  assert.throws(() =>
    parseBrowserCameraUplinkFrameMetadata({
      leaseId: LEASE_ID,
      sequence: 1,
      capturedAt: '2026-11-26T12:00:00.000Z',
      width: 32, // below 64px min
      height: 480,
      byteLength: 42_000,
    }),
  );

  const receipt = parseBrowserCameraUplinkFrameReceipt({
    schemaVersion: '1.0.0',
    leaseId: LEASE_ID,
    sequence: 1,
    acceptedAt: '2026-11-26T12:00:00.120Z',
    leaseExpiresAt: '2026-11-26T12:00:10.120Z',
    width: 640,
    height: 480,
    byteLength: 42_000,
  });
  assert.equal(receipt.sequence, 1);
  assert.equal(receipt.byteLength, 42_000);
});

test('stop command, stop response, and status response parsers enforce strict schema', () => {
  const stopCmd = parseBrowserCameraUplinkStopCommand({
    leaseId: LEASE_ID,
    reason: 'PAGE_HIDDEN',
  });
  assert.equal(stopCmd.reason, 'PAGE_HIDDEN');
  assert.throws(() =>
    parseBrowserCameraUplinkStopCommand({ leaseId: LEASE_ID, reason: 'INVALID_REASON' }),
  );

  const stopRes = parseBrowserCameraUplinkStopResponse({
    schemaVersion: '1.0.0',
    leaseId: LEASE_ID,
    state: 'STOPPED',
    stoppedAt: '2026-11-26T12:01:00.000Z',
  });
  assert.equal(stopRes.state, 'STOPPED');

  const statusRes = parseBrowserCameraUplinkStatusResponse({
    schemaVersion: '1.0.0',
    supported: true,
    siteId: SITE_ID,
    cameraId: CAMERA_ID,
    state: 'IDLE',
    activeLeaseId: null,
    ownedByCurrentUser: false,
    lastSequence: null,
    lastFrameCapturedAt: null,
    leaseExpiresAt: null,
    width: null,
    height: null,
  });
  assert.equal(statusRes.supported, true);
  assert.equal(statusRes.state, 'IDLE');

  assert.throws(() =>
    parseBrowserCameraUplinkStatusResponse({
      schemaVersion: '2.0.0',
      supported: true,
      siteId: SITE_ID,
      cameraId: CAMERA_ID,
      state: 'IDLE',
    }),
  );
});
