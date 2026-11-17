import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  planTrackedHeads,
  type TrackedHeadSnapshot,
  type TrackedPredecessorSnapshot,
} from '../src/integrations/ai/tracked-head-plan.js';
import { inspectTrackedFrameParts } from '../src/integrations/ai/tracked-frame-parts.js';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scopeSha256 = 'b'.repeat(64),
  policy = {
    firstFramePolicy: 'FIRST_COMMITTED_CAPTURE' as const,
    maxCaptureGapMs: 1000,
    maxSourceSequenceGap: '1',
  };
const capturedAt = Date.parse('2026-11-01T00:00:01.000Z');
const capturedAtNs = BigInt(capturedAt) * 1_000_000n;
function frame(sequenceNumber = '1', previous?: string, empty = false, retired = false) {
  const payload = {
    schemaVersion: '1.5.0',
    eventId: id(10),
    cameraExternalId: 'CAM-1',
    streamSessionId: id(2),
    capturedAt: new Date(capturedAt).toISOString(),
    frameDimensions: { width: 120, height: 80 },
    framePartition: { frameId: id(3), sequenceNumber, partIndex: 0, partCount: 1 },
    observations: empty ? [] : [{ type: 'PERSON', trackId: 7 }],
    evidence: [],
    continuity: {
      schemaVersion: '1.0.0',
      profileSha256: 'a'.repeat(64),
      coverage: { status: 'COMPLETE' },
      subjects: empty
        ? []
        : [
            {
              personObservationIndex: 0,
              segmentId: id(4),
              link: previous
                ? { kind: 'CONTINUE', previousEventId: previous, previousPersonObservationIndex: 2 }
                : { kind: 'START', reason: 'INITIAL' },
            },
          ],
      retiredSegments: retired ? [{ segmentId: id(4), reason: 'LOST_TRACK' }] : [],
    },
  };
  const result = inspectTrackedFrameParts([
    {
      eventId: payload.eventId,
      payloadHash: computeCanonicalPayloadHash(payload),
      rawPayload: payload,
      scopeSha256,
    },
  ]);
  if (result.kind !== 'COMPLETE') throw new Error('Invalid complete fixture');
  return result;
}
const head = (): TrackedHeadSnapshot => ({
  segmentId: id(4),
  scopeSha256,
  state: 'ACTIVE',
  eventId: id(9),
  personObservationIndex: 2,
  sequenceNumber: '0',
  capturedAtNs: capturedAtNs - 1_000_000_000n,
});
const state = (
  heads: TrackedHeadSnapshot[] = [],
  predecessors: TrackedPredecessorSnapshot[] = [],
) => ({ heads, predecessors, earlierPending: false, scopeTransitionPending: false });

test('a healthy original PERSON creates a technical start plan without a business episode', () => {
  const result = planTrackedHeads(frame(), scopeSha256, capturedAtNs, state(), policy);
  assert.equal(result.kind, 'READY');
  if (result.kind !== 'READY') throw new Error('Expected ready');
  assert.equal(result.subjects[0]?.kind, 'START');
  assert.deepEqual(result.retirements, []);
});
test('exact original head and uint64 next sequence continue at the approved fixture gap boundary', () => {
  const h = { ...head(), sequenceNumber: '18446744073709551614' };
  const result = planTrackedHeads(
    frame('18446744073709551615', id(9)),
    scopeSha256,
    capturedAtNs,
    { ...state([h]), watermark: h.sequenceNumber },
    policy,
  );
  assert.equal(result.kind, 'READY');
  if (result.kind !== 'READY') throw new Error('Expected ready');
  assert.equal(result.subjects[0]?.kind, 'CONTINUE');
});
test('missing or pending predecessor never advances a subject; future predecessor is rejected', () => {
  const f = frame('2', id(8));
  assert.equal(
    planTrackedHeads(f, scopeSha256, capturedAtNs, state(), policy).kind,
    'PENDING_PREDECESSOR',
  );
  const predecessor: TrackedPredecessorSnapshot = {
    eventId: id(8),
    personObservationIndex: 2,
    segmentId: id(4),
    scopeSha256,
    sequenceNumber: '1',
    state: 'PENDING',
  };
  assert.equal(
    planTrackedHeads(f, scopeSha256, capturedAtNs, state([], [predecessor]), policy).kind,
    'PENDING_PREDECESSOR',
  );
  assert.deepEqual(
    planTrackedHeads(
      f,
      scopeSha256,
      capturedAtNs,
      state([], [{ ...predecessor, sequenceNumber: '2' }]),
      policy,
    ),
    { kind: 'REVIEW_ONLY', reason: 'INVALID_PREDECESSOR' },
  );
});
test('stale predecessor forks and retired segment resurrection are review-only', () => {
  const predecessor: TrackedPredecessorSnapshot = {
    eventId: id(8),
    personObservationIndex: 2,
    segmentId: id(4),
    scopeSha256,
    sequenceNumber: '0',
    state: 'SEALED',
  };
  assert.deepEqual(
    planTrackedHeads(
      frame('2', id(8)),
      scopeSha256,
      capturedAtNs,
      state([{ ...head(), sequenceNumber: '1' }], [predecessor]),
      policy,
    ),
    { kind: 'REVIEW_ONLY', reason: 'PREDECESSOR_FORK' },
  );
  assert.deepEqual(
    planTrackedHeads(
      frame(),
      scopeSha256,
      capturedAtNs,
      state([{ ...head(), state: 'RETIRED' }]),
      policy,
    ),
    { kind: 'REVIEW_ONLY', reason: 'SEGMENT_RETIRED' },
  );
});
test('capture gap or rewind cannot silently continue or mutate the supplied head', () => {
  const h = head(),
    original = structuredClone(h);
  assert.deepEqual(
    planTrackedHeads(frame('1', id(9)), scopeSha256, capturedAtNs + 1n, state([h]), policy),
    { kind: 'REVIEW_ONLY', reason: 'CAPTURE_GAP_EXCEEDED' },
  );
  assert.deepEqual(
    planTrackedHeads(frame('1', id(9)), scopeSha256, h.capturedAtNs! - 1n, state([h]), policy),
    { kind: 'REVIEW_ONLY', reason: 'CAPTURE_REWIND' },
  );
  assert.deepEqual(
    planTrackedHeads(
      frame('1', undefined, true, true),
      scopeSha256,
      h.capturedAtNs! - 1n,
      state([h]),
      policy,
    ),
    { kind: 'REVIEW_ONLY', reason: 'CAPTURE_REWIND' },
  );
  assert.deepEqual(h, original);
});
test('captured empty alone retires nobody; explicit complete orphan retirement makes a tombstone plan', () => {
  const empty = planTrackedHeads(
    frame('1', undefined, true),
    scopeSha256,
    capturedAtNs,
    state([head()]),
    policy,
  );
  assert.equal(empty.kind, 'READY');
  if (empty.kind !== 'READY') throw new Error('Expected empty ready');
  assert.deepEqual(empty.subjects, []);
  assert.deepEqual(empty.retirements, []);
  const orphan = planTrackedHeads(
    frame('1', undefined, true, true),
    scopeSha256,
    capturedAtNs,
    state(),
    policy,
  );
  assert.equal(orphan.kind, 'READY');
  if (orphan.kind !== 'READY') throw new Error('Expected explicit retirement');
  assert.deepEqual(orphan.retirements, [
    { segmentId: id(4), reason: 'LOST_TRACK', tombstone: true },
  ]);
});
test('earlier work/source transition/gap blocks admission and committed watermark never rewinds', () => {
  assert.equal(
    planTrackedHeads(
      frame(),
      scopeSha256,
      capturedAtNs,
      { ...state(), earlierPending: true },
      policy,
    ).kind,
    'PENDING_PREDECESSOR',
  );
  assert.equal(
    planTrackedHeads(
      frame(),
      scopeSha256,
      capturedAtNs,
      { ...state(), scopeTransitionPending: true },
      policy,
    ).kind,
    'PENDING_PREDECESSOR',
  );
  assert.equal(
    planTrackedHeads(frame('3'), scopeSha256, capturedAtNs, { ...state(), watermark: '1' }, policy)
      .kind,
    'PENDING_PREDECESSOR',
  );
  assert.deepEqual(
    planTrackedHeads(frame('1'), scopeSha256, capturedAtNs, { ...state(), watermark: '2' }, policy),
    { kind: 'REVIEW_ONLY', reason: 'LATE_SOURCE_SEQUENCE' },
  );
});
