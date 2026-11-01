import {
  computeCanonicalPayloadHash,
  validateTrackedObservationEvent,
  type TrackedFrameContinuity,
  type TrackedFrameSubject,
  type ObservationFramePartition,
} from '@smartsite/contracts';

export interface StoredTrackedPart {
  eventId: string;
  payloadHash: string;
  rawPayload: unknown;
  scopeSha256: string;
}
interface Part {
  eventId: string;
  cameraExternalId: string;
  streamSessionId: string;
  capturedAt: string;
  frameDimensions: { width: number; height: number };
  framePartition: ObservationFramePartition;
  continuity: TrackedFrameContinuity;
  observations: Array<Record<string, unknown> & { type: string; trackId: number }>;
  evidence: Array<{ kind: string; sha256: string }>;
}
interface OriginalPerson {
  eventId: string;
  personObservationIndex: number;
  partIndex: number;
}
interface AssembledSubject extends OriginalPerson {
  segmentId: string;
  link: TrackedFrameSubject['link'];
  contributors: OriginalPerson[];
}
type Inspection =
  | { kind: 'PENDING_PARTS'; missingPartCount: number }
  | { kind: 'REVIEW_ONLY'; reason: 'INCOMPLETE_COVERAGE' }
  | {
      kind: 'COMPLETE';
      sequenceNumber: string;
      subjects: AssembledSubject[];
      retiredSegments: TrackedFrameContinuity['retiredSegments'];
    };

function conflict(): never {
  throw new Error('Stored tracked frame parts are inconsistent');
}
function invariant(part: Part): string {
  return computeCanonicalPayloadHash({
    cameraExternalId: part.cameraExternalId,
    streamSessionId: part.streamSessionId.toLowerCase(),
    capturedAt: part.capturedAt,
    frameDimensions: part.frameDimensions,
    frameId: part.framePartition.frameId.toLowerCase(),
    sequenceNumber: part.framePartition.sequenceNumber,
    partCount: part.framePartition.partCount,
    profileSha256: part.continuity.profileSha256,
    coverage: part.continuity.coverage,
    retiredSegments: part.continuity.retiredSegments
      .map((item) => ({ ...item }))
      .sort((a, b) => a.segmentId.localeCompare(b.segmentId)),
  });
}

/** Pure inspection only: no authentication, qualification, DB sealing, head advance or delivery.
 * The transaction owner must authenticate EVERY original receipt before supplying its stable scope.
 */
export function inspectTrackedFrameParts(rows: readonly StoredTrackedPart[]): Inspection {
  // Canonical v1.5 partCount bound; not an operational pending-capacity policy.
  if (!rows.length || rows.length > 1024) conflict();
  const scope = rows[0]!.scopeSha256;
  if (!/^[a-f0-9]{64}$/.test(scope)) conflict();
  const parts: Part[] = [];
  for (const row of rows) {
    if (
      row.scopeSha256 !== scope ||
      !validateTrackedObservationEvent(row.rawPayload).isValid ||
      computeCanonicalPayloadHash(row.rawPayload) !== row.payloadHash
    )
      conflict();
    const part = row.rawPayload as Part;
    if (part.eventId.toLowerCase() !== row.eventId.toLowerCase()) conflict();
    parts.push(part);
  }
  parts.sort((a, b) => a.framePartition.partIndex - b.framePartition.partIndex);
  const first = parts[0]!,
    expected = invariant(first);
  const frameEvents = new Set(parts.map((part) => part.eventId.toLowerCase()));
  const indices = new Set<number>(),
    events = new Set<string>(),
    regions = new Set<string>();
  const byTrack = new Map<number, string>(),
    subjectContext = new Map<string, string>();
  const subjects = new Map<string, AssembledSubject>(),
    predecessors = new Map<string, string>();
  let frameSha: string | undefined;
  for (const part of parts) {
    const index = part.framePartition.partIndex,
      eventId = part.eventId.toLowerCase();
    if (invariant(part) !== expected || indices.has(index) || events.has(eventId)) conflict();
    indices.add(index);
    events.add(eventId);
    for (const item of part.evidence.filter((item) => item.kind === 'FRAME')) {
      if (frameSha && frameSha !== item.sha256) conflict();
      frameSha = item.sha256;
    }
    const partRegions = new Set<string>();
    for (const item of part.observations) {
      if (item.type !== 'PPE' && item.type !== 'ZONE_ENTRY') continue;
      const key = `${item.trackId}:${String(item.regionId).toLowerCase()}:${item.geometryVersion}`;
      if (regions.has(key)) conflict();
      partRegions.add(key);
    }
    for (const key of partRegions) regions.add(key);
    for (const claim of part.continuity.subjects) {
      const person = part.observations[claim.personObservationIndex]!,
        segmentId = claim.segmentId.toLowerCase();
      const trackContext = part.observations
        .filter(
          (item) =>
            item.trackId === person.trackId &&
            (item.type === 'PERSON' || item.type === 'IDENTITY_CANDIDATE'),
        )
        .map((item) => computeCanonicalPayloadHash(item))
        .sort();
      const context = computeCanonicalPayloadHash({ trackContext, link: claim.link });
      if (
        (byTrack.has(person.trackId) && byTrack.get(person.trackId) !== segmentId) ||
        (subjectContext.has(segmentId) && subjectContext.get(segmentId) !== context)
      )
        conflict();
      byTrack.set(person.trackId, segmentId);
      subjectContext.set(segmentId, context);
      if (claim.link.kind === 'CONTINUE') {
        const previousEventId = claim.link.previousEventId.toLowerCase();
        const key = `${previousEventId}:${claim.link.previousPersonObservationIndex}`;
        if (
          frameEvents.has(previousEventId) ||
          (predecessors.has(key) && predecessors.get(key) !== segmentId)
        )
          conflict();
        predecessors.set(key, segmentId);
      }
      const original = {
        eventId,
        personObservationIndex: claim.personObservationIndex,
        partIndex: index,
      };
      const existing = subjects.get(segmentId);
      if (existing) existing.contributors.push(original);
      else
        subjects.set(segmentId, {
          ...original,
          segmentId,
          link: { ...claim.link },
          contributors: [original],
        });
    }
  }
  for (const item of first.continuity.retiredSegments)
    if (subjects.has(item.segmentId.toLowerCase())) conflict();
  if (indices.size < first.framePartition.partCount)
    return {
      kind: 'PENDING_PARTS',
      missingPartCount: first.framePartition.partCount - indices.size,
    };
  if (first.continuity.coverage.status !== 'COMPLETE')
    return { kind: 'REVIEW_ONLY', reason: 'INCOMPLETE_COVERAGE' };
  return {
    kind: 'COMPLETE',
    sequenceNumber: first.framePartition.sequenceNumber,
    subjects: [...subjects.values()],
    retiredSegments: first.continuity.retiredSegments.map((item) => ({ ...item })),
  };
}
