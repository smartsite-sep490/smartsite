import assert from 'node:assert/strict';
import { test } from 'node:test';
import { trackedRuntimePolicyEnvironment } from '../src/config/tracked-runtime-environment.js';

const policy = (wireVersion: string, recoveryOverrides?: Record<string, unknown>) =>
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
    recovery: { intervalMs: 50, maxFramesPerCamera: 8, ...recoveryOverrides },
    maxRecipients: 8,
  });

test('explicit worker v1.7 policy is accepted without dropping v1.6 or accepting unknown versions', () => {
  assert.equal(trackedRuntimePolicyEnvironment.parse(policy('1.6.0')).profile.wireVersion, '1.6.0');
  const parsedV17 = trackedRuntimePolicyEnvironment.parse(policy('1.7.0'));
  assert.equal(parsedV17.profile.wireVersion, '1.7.0');
  assert.equal(parsedV17.recovery.automaticResume, undefined);
  assert.equal(trackedRuntimePolicyEnvironment.safeParse(policy('1.8.0')).success, false);
});

test('recovery.automaticResume parses bounded config and rejects invalid bounds or unknown fields', () => {
  const validAutomaticResume = {
    hostId: 'local-ai',
    minPersistentMs: 2000,
    maxStarts: 3,
  };
  const parsed = trackedRuntimePolicyEnvironment.parse(
    policy('1.7.0', { automaticResume: validAutomaticResume }),
  );
  assert.deepEqual(parsed.recovery.automaticResume, validAutomaticResume);
  assert.equal(parsed.recovery.intervalMs, 50);
  assert.equal(parsed.recovery.maxFramesPerCamera, 8);

  assert.deepEqual(
    trackedRuntimePolicyEnvironment.parse(
      policy('1.7.0', {
        automaticResume: { hostId: 'local_ai-01', minPersistentMs: 50, maxStarts: 1 },
      }),
    ).recovery.automaticResume,
    { hostId: 'local_ai-01', minPersistentMs: 50, maxStarts: 1 },
  );
  assert.deepEqual(
    trackedRuntimePolicyEnvironment.parse(
      policy('1.7.0', {
        automaticResume: { hostId: 'a', minPersistentMs: 29999, maxStarts: 2 },
      }),
    ).recovery.automaticResume,
    { hostId: 'a', minPersistentMs: 29999, maxStarts: 2 },
  );

  const invalidCases: Array<[string, Record<string, unknown>]> = [
    ['missing hostId', { minPersistentMs: 2000, maxStarts: 3 }],
    ['empty hostId', { hostId: '', minPersistentMs: 2000, maxStarts: 3 }],
    ['whitespace hostId', { hostId: '   ', minPersistentMs: 2000, maxStarts: 3 }],
    [
      'hostId with disallowed punctuation',
      { hostId: 'local.ai', minPersistentMs: 2000, maxStarts: 3 },
    ],
    [
      'hostId exceeding 128 chars',
      { hostId: 'a'.repeat(129), minPersistentMs: 2000, maxStarts: 3 },
    ],
    ['non-string hostId', { hostId: 123, minPersistentMs: 2000, maxStarts: 3 }],
    [
      'minPersistentMs below recovery.intervalMs',
      { hostId: 'local-ai', minPersistentMs: 49, maxStarts: 3 },
    ],
    [
      'minPersistentMs equal to pending.pendingTtlMs',
      { hostId: 'local-ai', minPersistentMs: 30000, maxStarts: 3 },
    ],
    [
      'minPersistentMs above pending.pendingTtlMs',
      { hostId: 'local-ai', minPersistentMs: 30001, maxStarts: 3 },
    ],
    ['non-integer minPersistentMs', { hostId: 'local-ai', minPersistentMs: 2000.5, maxStarts: 3 }],
    ['maxStarts below 1', { hostId: 'local-ai', minPersistentMs: 2000, maxStarts: 0 }],
    ['maxStarts above 3', { hostId: 'local-ai', minPersistentMs: 2000, maxStarts: 4 }],
    ['non-integer maxStarts', { hostId: 'local-ai', minPersistentMs: 2000, maxStarts: 2.5 }],
    ['unknown field in automaticResume', { ...validAutomaticResume, unexpected: true }],
  ];

  for (const [label, automaticResume] of invalidCases) {
    assert.equal(
      trackedRuntimePolicyEnvironment.safeParse(policy('1.7.0', { automaticResume })).success,
      false,
      `expected rejection for ${label}`,
    );
  }

  assert.equal(
    trackedRuntimePolicyEnvironment.safeParse(policy('1.7.0', { automaticResume: null })).success,
    false,
    'expected rejection for null automaticResume',
  );
  assert.equal(
    trackedRuntimePolicyEnvironment.safeParse(policy('1.7.0', { extraRecoveryField: true }))
      .success,
    false,
    'expected rejection for unknown recovery field',
  );
});
