import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { inspectTrackedFrameParts } from '../src/integrations/ai/tracked-frame-parts.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function event(partIndex = 0, partCount = 1) {
  return {
    eventId: id(10 + partIndex),
    schemaVersion: '1.5.0',
    cameraExternalId: 'CAM-1',
    streamSessionId: id(2),
    capturedAt: '2026-11-01T00:00:00.000Z',
    frameDimensions: { width: 1280, height: 720 },
    framePartition: {
      frameId: id(3),
      sequenceNumber: '18446744073709551615',
      partIndex,
      partCount,
    },
    observations: [{ type: 'PERSON', trackId: 9 }],
    evidence: [],
    continuity: {
      schemaVersion: '1.0.0',
      profileSha256: 'a'.repeat(64),
      coverage: { status: 'COMPLETE' },
      subjects: [
        { personObservationIndex: 0, segmentId: id(4), link: { kind: 'START', reason: 'INITIAL' } },
      ],
      retiredSegments: [],
    },
  };
}
const row = (payload = event(), scopeSha256 = 'b'.repeat(64)) => ({
  eventId: payload.eventId,
  payloadHash: computeCanonicalPayloadHash(payload),
  rawPayload: payload,
  scopeSha256,
});

test('nonzero orphan parts remain pending without fabricating a coordinator or subjects', () => {
  assert.deepEqual(inspectTrackedFrameParts([row(event(1, 2))]), {
    kind: 'PENDING_PARTS',
    missingPartCount: 1,
  });
  assert.throws(() => inspectTrackedFrameParts([]));
});
test('reverse arrival folds one repeated PERSON to its lowest original part/index without rounding uint64', () => {
  const result = inspectTrackedFrameParts([row(event(1, 2)), row(event(0, 2))]);
  assert.equal(result.kind, 'COMPLETE');
  if (result.kind !== 'COMPLETE') throw new Error('Expected complete frame');
  assert.equal(result.sequenceNumber, '18446744073709551615');
  assert.deepEqual(result.subjects, [
    {
      segmentId: id(4),
      eventId: id(10),
      personObservationIndex: 0,
      partIndex: 0,
      link: { kind: 'START', reason: 'INITIAL' },
      contributors: [
        { eventId: id(10), personObservationIndex: 0, partIndex: 0 },
        { eventId: id(11), personObservationIndex: 0, partIndex: 1 },
      ],
    },
  ]);
});
test('conflicting frame, scope or stored payload hash cannot be assembled', () => {
  const a = event(0, 2),
    b = event(1, 2);
  assert.throws(() => inspectTrackedFrameParts([row(a), row(b, 'c'.repeat(64))]));
  b.framePartition.sequenceNumber = '18446744073709551614';
  assert.throws(() => inspectTrackedFrameParts([row(a), row(b)]));
  assert.throws(() => inspectTrackedFrameParts([{ ...row(a), payloadHash: 'd'.repeat(64) }]));
  assert.throws(() => inspectTrackedFrameParts([row(a), row(a)]));
});
test('one track cannot fork segments or carry conflicting subject context across parts', () => {
  const a = event(0, 2),
    b = event(1, 2);
  b.continuity.subjects[0]!.segmentId = id(5);
  assert.throws(() => inspectTrackedFrameParts([row(a), row(b)]));
  b.continuity.subjects[0]!.segmentId = id(4);
  b.continuity.subjects[0]!.link.reason = 'RECONNECT';
  assert.throws(() => inspectTrackedFrameParts([row(a), row(b)]));
});
test('incomplete coverage retains review-only outcome and never proposes subject advancement', () => {
  const payload = {
    ...event(),
    observations: [],
    continuity: {
      ...event().continuity,
      coverage: { status: 'INCOMPLETE', reason: 'INFERENCE_ERROR' },
      subjects: [],
    },
  };
  assert.deepEqual(inspectTrackedFrameParts([row(payload)]), {
    kind: 'REVIEW_ONLY',
    reason: 'INCOMPLETE_COVERAGE',
  });
});
test('captured empty COMPLETE frame stays distinct from missing parts and silence', () => {
  const payload = {
    ...event(),
    observations: [],
    continuity: { ...event().continuity, subjects: [] },
  };
  const result = inspectTrackedFrameParts([row(payload)]);
  assert.equal(result.kind, 'COMPLETE');
  if (result.kind !== 'COMPLETE') throw new Error('Expected captured empty frame');
  assert.deepEqual(result.subjects, []);
});
