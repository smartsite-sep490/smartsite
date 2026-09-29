import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decideFaceGate } from '../src/modules/workforce/face-gate-policy.js';

test('face gate policy permits QR fallback only for inconclusive technical outcomes', () => {
  const result = decideFaceGate({ technicalOutcome: 'LOW_CONFIDENCE' });

  assert.deepEqual(result, {
    technicalOutcome: 'LOW_CONFIDENCE',
    authorization: 'MANUAL_REVIEW',
    reasonCode: 'FACE_CONFIDENCE_LOW',
    qrFallbackAllowed: true,
  });
});

test('face gate policy never converts a technical match into allowed access', () => {
  const result = decideFaceGate({ technicalOutcome: 'MATCHED' });

  assert.deepEqual(result, {
    technicalOutcome: 'MATCHED',
    authorization: 'MANUAL_REVIEW',
    reasonCode: 'AUTHORIZATION_UNAVAILABLE',
    qrFallbackAllowed: false,
  });
});

test('face gate policy preserves a Backend denial after a technical match', () => {
  const result = decideFaceGate({
    technicalOutcome: 'MATCHED',
    authorization: 'DENIED',
    reasonCode: 'ASSIGNMENT_EXPIRED',
  });

  assert.deepEqual(result, {
    technicalOutcome: 'MATCHED',
    authorization: 'DENIED',
    reasonCode: 'ASSIGNMENT_EXPIRED',
    qrFallbackAllowed: false,
  });
});
