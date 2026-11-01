import type { inspectTrackedFrameParts } from './tracked-frame-parts.js';

export type CompleteTrackedFrame = Extract<
  ReturnType<typeof inspectTrackedFrameParts>,
  { kind: 'COMPLETE' }
>;
export interface TrackedHeadSnapshot {
  segmentId: string;
  scopeSha256: string;
  state: 'ACTIVE' | 'RETIRED';
  eventId: string | null;
  personObservationIndex: number | null;
  sequenceNumber: string | null;
  capturedAtNs: bigint | null;
}
export interface TrackedPredecessorSnapshot {
  eventId: string;
  personObservationIndex: number;
  segmentId: string;
  scopeSha256: string;
  sequenceNumber: string;
  state: 'PENDING' | 'SEALED' | 'REJECTED';
}
export interface TrackedOrderingSnapshot {
  heads: readonly TrackedHeadSnapshot[];
  predecessors: readonly TrackedPredecessorSnapshot[];
  watermark?: string;
  earlierPending: boolean;
  scopeTransitionPending: boolean;
}
export interface TrackedHeadPolicy {
  readonly firstFramePolicy: 'FIRST_COMMITTED_CAPTURE';
  readonly maxCaptureGapMs: number;
  readonly maxSourceSequenceGap: string;
}
type SubjectAction = {
  kind: 'START' | 'CONTINUE';
  subject: CompleteTrackedFrame['subjects'][number];
};
export type TrackedHeadPlan =
  | {
      kind: 'READY';
      subjects: SubjectAction[];
      retirements: Array<CompleteTrackedFrame['retiredSegments'][number] & { tombstone: boolean }>;
    }
  | {
      kind: 'PENDING_PREDECESSOR';
      reason:
        'EARLIER_PENDING' | 'SOURCE_TRANSITION_REQUIRED' | 'SOURCE_GAP' | 'MISSING_PREDECESSOR';
    }
  | {
      kind: 'REVIEW_ONLY';
      reason:
        | 'LATE_SOURCE_SEQUENCE'
        | 'SEGMENT_SCOPE_CONFLICT'
        | 'SEGMENT_RETIRED'
        | 'SEGMENT_ALREADY_EXISTS'
        | 'INVALID_PREDECESSOR'
        | 'PREDECESSOR_REJECTED'
        | 'PREDECESSOR_FORK'
        | 'HEAD_UNAVAILABLE'
        | 'CAPTURE_REWIND'
        | 'CAPTURE_GAP_EXCEEDED';
    };
function sequence(value: string): bigint {
  if (!/^(0|[1-9][0-9]{0,19})$/.test(value) || BigInt(value) > 18446744073709551615n)
    throw new Error('Invalid stored source sequence');
  return BigInt(value);
}

/** Pure plan for an already complete, authenticated/profile-pinned frame and locked snapshots.
 * Policy values are injected, never learned from a worker claim or defaulted here.
 * No projection/identity/authorization or mutation is performed by planning.
 */
export function planTrackedHeads(
  frame: CompleteTrackedFrame,
  scopeSha256: string,
  capturedAtNs: bigint,
  snapshot: TrackedOrderingSnapshot,
  policy: TrackedHeadPolicy,
): TrackedHeadPlan {
  if (
    policy.firstFramePolicy !== 'FIRST_COMMITTED_CAPTURE' ||
    !/^[a-f0-9]{64}$/.test(scopeSha256) ||
    typeof capturedAtNs !== 'bigint' ||
    !Number.isSafeInteger(policy.maxCaptureGapMs) ||
    policy.maxCaptureGapMs < 0 ||
    sequence(policy.maxSourceSequenceGap) < 1n
  )
    throw new Error('Invalid server tracking plan policy');
  const next = sequence(frame.sequenceNumber);
  if (snapshot.watermark !== undefined && next <= sequence(snapshot.watermark))
    return { kind: 'REVIEW_ONLY', reason: 'LATE_SOURCE_SEQUENCE' };
  if (snapshot.scopeTransitionPending)
    return { kind: 'PENDING_PREDECESSOR', reason: 'SOURCE_TRANSITION_REQUIRED' };
  if (snapshot.earlierPending) return { kind: 'PENDING_PREDECESSOR', reason: 'EARLIER_PENDING' };
  if (
    snapshot.watermark !== undefined &&
    next - sequence(snapshot.watermark) > sequence(policy.maxSourceSequenceGap)
  )
    return { kind: 'PENDING_PREDECESSOR', reason: 'SOURCE_GAP' };
  const heads = new Map(snapshot.heads.map((head) => [head.segmentId, head]));
  const predecessors = new Map(
    snapshot.predecessors.map((prior) => [
      `${prior.eventId.toLowerCase()}:${prior.personObservationIndex}`,
      prior,
    ]),
  );
  const subjects: SubjectAction[] = [];
  for (const subject of frame.subjects) {
    const head = heads.get(subject.segmentId);
    if (head && head.scopeSha256 !== scopeSha256)
      return { kind: 'REVIEW_ONLY', reason: 'SEGMENT_SCOPE_CONFLICT' };
    if (head?.state === 'RETIRED') return { kind: 'REVIEW_ONLY', reason: 'SEGMENT_RETIRED' };
    if (subject.link.kind === 'START') {
      if (head) return { kind: 'REVIEW_ONLY', reason: 'SEGMENT_ALREADY_EXISTS' };
      subjects.push({ kind: 'START', subject });
      continue;
    }
    const link = subject.link;
    const exact =
      head &&
      head.eventId?.toLowerCase() === link.previousEventId.toLowerCase() &&
      head.personObservationIndex === link.previousPersonObservationIndex;
    if (!exact) {
      const prior = predecessors.get(
        `${link.previousEventId.toLowerCase()}:${link.previousPersonObservationIndex}`,
      );
      if (!prior) return { kind: 'PENDING_PREDECESSOR', reason: 'MISSING_PREDECESSOR' };
      if (
        prior.segmentId !== subject.segmentId ||
        prior.scopeSha256 !== scopeSha256 ||
        sequence(prior.sequenceNumber) >= next
      )
        return { kind: 'REVIEW_ONLY', reason: 'INVALID_PREDECESSOR' };
      if (prior.state === 'REJECTED')
        return { kind: 'REVIEW_ONLY', reason: 'PREDECESSOR_REJECTED' };
      if (
        prior.state === 'PENDING' &&
        (!head ||
          (head.sequenceNumber !== null &&
            sequence(prior.sequenceNumber) > sequence(head.sequenceNumber)))
      )
        return { kind: 'PENDING_PREDECESSOR', reason: 'MISSING_PREDECESSOR' };
      return { kind: 'REVIEW_ONLY', reason: head ? 'PREDECESSOR_FORK' : 'HEAD_UNAVAILABLE' };
    }
    if (
      !head ||
      head.sequenceNumber === null ||
      head.capturedAtNs === null ||
      typeof head.capturedAtNs !== 'bigint'
    )
      return { kind: 'REVIEW_ONLY', reason: 'HEAD_UNAVAILABLE' };
    if (sequence(head.sequenceNumber) >= next)
      return { kind: 'REVIEW_ONLY', reason: 'LATE_SOURCE_SEQUENCE' };
    if (capturedAtNs < head.capturedAtNs) return { kind: 'REVIEW_ONLY', reason: 'CAPTURE_REWIND' };
    if (capturedAtNs - head.capturedAtNs > BigInt(policy.maxCaptureGapMs) * 1_000_000n)
      return { kind: 'REVIEW_ONLY', reason: 'CAPTURE_GAP_EXCEEDED' };
    subjects.push({ kind: 'CONTINUE', subject });
  }
  const retirements: Extract<TrackedHeadPlan, { kind: 'READY' }>['retirements'] = [];
  for (const retired of frame.retiredSegments) {
    const head = heads.get(retired.segmentId);
    if (head && head.scopeSha256 !== scopeSha256)
      return { kind: 'REVIEW_ONLY', reason: 'SEGMENT_SCOPE_CONFLICT' };
    if (head?.state === 'RETIRED') continue;
    if (head && (head.capturedAtNs === null || typeof head.capturedAtNs !== 'bigint'))
      return { kind: 'REVIEW_ONLY', reason: 'HEAD_UNAVAILABLE' };
    if (head && capturedAtNs < head.capturedAtNs!)
      return { kind: 'REVIEW_ONLY', reason: 'CAPTURE_REWIND' };
    retirements.push({ ...retired, tombstone: !head });
  }
  return { kind: 'READY', subjects, retirements };
}
