import assert from 'node:assert/strict';
import { test } from 'node:test';
import { trackedRuntimePolicyEnvironment } from '../src/config/tracked-runtime-environment.js';

const policy = (wireVersion: string) =>
  JSON.stringify({
    profile: {
      wireVersion,
      routeEpoch: '11111111-1111-4111-8111-111111111111',
      profileSha256: 'a'.repeat(64),
      allowedCameraIds: ['22222222-2222-4222-8222-222222222222'],
      clockToleranceMs: 5000,
    },
    pending: {
      pendingTtlMs: 30000,
      maxPendingFrames: 8,
      maxPendingParts: 16,
      maxPendingPayloadBytes: 100000,
    },
    heads: {
      firstFramePolicy: 'FIRST_COMMITTED_CAPTURE',
      maxCaptureGapMs: 10000,
      maxSourceSequenceGap: '1',
      maxSegmentRows: 32,
    },
    recovery: { intervalMs: 50, maxFramesPerCamera: 8 },
    maxRecipients: 8,
  });

test('explicit worker v1.7 policy is accepted without dropping v1.6 or accepting unknown versions', () => {
  assert.equal(trackedRuntimePolicyEnvironment.parse(policy('1.6.0')).profile.wireVersion, '1.6.0');
  assert.equal(trackedRuntimePolicyEnvironment.parse(policy('1.7.0')).profile.wireVersion, '1.7.0');
  assert.equal(trackedRuntimePolicyEnvironment.safeParse(policy('1.8.0')).success, false);
});
