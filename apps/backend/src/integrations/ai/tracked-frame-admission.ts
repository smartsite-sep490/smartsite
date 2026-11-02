import { computeCanonicalPayloadHash, validateTrackedObservationEvent } from '@smartsite/contracts';
import type { DataSource, EntityManager } from 'typeorm';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { parseAuthorityInstantNanoseconds } from '../../modules/zones/main-authority-capture-time.js';
import { inspectTrackedFrameParts } from './tracked-frame-parts.js';
import { lockTrackedFrameAfterCamera } from './tracked-frame-storage.js';
import { TrackedPartAuthenticator } from './tracked-part-authentication.js';
import {
  planTrackedHeads,
  type TrackedHeadPlan,
  type TrackedHeadPolicy,
  type TrackedHeadSnapshot,
  type TrackedPredecessorSnapshot,
} from './tracked-head-plan.js';

export interface TrackedFrameKey {
  cameraId: string;
  generationId: string;
  streamSessionId: string;
  frameId: string;
}
type Bound = Awaited<ReturnType<TrackedPartAuthenticator['authenticate']>>;
type Ready = Extract<TrackedHeadPlan, { kind: 'READY' }>;
export interface TrackedProjectionFrame {
  scope: Bound;
  parts: readonly Bound[];
  plan: Ready;
  coordinatorEventId: string;
}
const activeProjections = new WeakMap<TrackedProjectionFrame, EntityManager>();

/** Only the actual admission callback owns this transaction-bound projection capability. */
export function isTrackedProjectionTransaction(
  manager: EntityManager,
  frame: TrackedProjectionFrame,
) {
  return activeProjections.get(frame) === manager;
}
export interface TrackedProjectionPort {
  /** Must use this transaction manager. Required even for a healthy/empty frame; never defaults to legacy delivery. */
  project(manager: EntityManager, frame: TrackedProjectionFrame): Promise<void>;
}
interface RawRow {
  routeMode: string | null;
  routeEpoch: string | null;
  eventId: string;
  payloadHash: string;
  rawPayload: unknown;
  scopeSha256: string;
  frameState: string;
  partIndex: number;
  pendingUntil: Date;
  frameResult: Record<string, unknown> | null;
  admissionContext: { context: unknown; bindingHash: string; classification: string } | null;
}
interface Payload {
  capturedAt: string;
  observations: Array<{ type: string }>;
  continuity: {
    profileSha256: string;
    subjects: Array<{ personObservationIndex: number; segmentId: string }>;
    retiredSegments: Array<{ segmentId: string; reason: string }>;
  };
}
const uuid = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
function unavailable(): never {
  throw new PublicHttpException(503, {
    code: 'AI_INGESTION_UNAVAILABLE',
    message: 'Tracked frame admission is unavailable',
  });
}
function instant(raw: string): bigint | null {
  return parseAuthorityInstantNanoseconds(raw.replace('t', 'T').replace('z', 'Z'));
}

/** Unregistered prototype. No public intake/scheduler/profile qualification is installed by this class. */
export class TrackedFrameAdmission {
  private readonly policy: TrackedHeadPolicy & { readonly maxSegmentRows: number };
  constructor(
    private readonly authenticator: TrackedPartAuthenticator,
    policy: TrackedHeadPolicy & { readonly maxSegmentRows: number },
    private readonly projector: TrackedProjectionPort,
  ) {
    if (
      !projector ||
      typeof projector.project !== 'function' ||
      !Number.isSafeInteger(policy.maxSegmentRows) ||
      policy.maxSegmentRows < 1 ||
      policy.firstFramePolicy !== 'FIRST_COMMITTED_CAPTURE' ||
      !Number.isSafeInteger(policy.maxCaptureGapMs) ||
      policy.maxCaptureGapMs < 0 ||
      !/^[1-9][0-9]{0,19}$/.test(policy.maxSourceSequenceGap) ||
      BigInt(policy.maxSourceSequenceGap) > 18446744073709551615n
    )
      throw new Error('Explicit server projection and tracking policy required');
    this.policy = Object.freeze({ ...policy });
  }

  process(source: DataSource, key: TrackedFrameKey, secret: string) {
    if (!Object.values(key).every((value) => uuid.test(value)))
      throw new Error('Invalid stored frame key');
    return source.transaction((manager) => this.processInTransaction(manager, key, secret));
  }

  private async processInTransaction(manager: EntityManager, key: TrackedFrameKey, secret: string) {
    const cameras = await manager.query('SELECT id FROM camera WHERE id=$1 FOR UPDATE', [
      key.cameraId,
    ]);
    if (!cameras.length) unavailable();
    const sourceKey = [key.cameraId, key.generationId, key.streamSessionId];
    const [header] = await manager.query<Array<{ sequence: string }>>(
      `SELECT tracking_source_sequence::text AS sequence FROM ai_observation_event
      WHERE resolved_camera_id=$1 AND tracking_generation_id=$2 AND stream_session_id=$3 AND tracking_frame_id=$4 ORDER BY tracking_part_index LIMIT 1`,
      [...sourceKey, key.frameId],
    );
    if (!header) return { kind: 'NOT_FOUND' as const };
    await lockTrackedFrameAfterCamera(manager, sourceKey, key.frameId, header.sequence);
    const rows = await manager.query<RawRow[]>(
      `SELECT event_id AS "eventId",payload_hash AS "payloadHash",raw_payload AS "rawPayload",
      admission_context AS "admissionContext",tracking_scope_sha256 AS "scopeSha256",tracking_frame_state AS "frameState",
      tracking_part_index AS "partIndex",tracking_pending_until AS "pendingUntil",tracking_frame_result AS "frameResult",
      safety_route_mode AS "routeMode",safety_route_epoch AS "routeEpoch"
      FROM ai_observation_event WHERE resolved_camera_id=$1 AND tracking_generation_id=$2 AND stream_session_id=$3 AND tracking_frame_id=$4
      ORDER BY tracking_part_index LIMIT 1025 FOR UPDATE`,
      [...sourceKey, key.frameId],
    );
    if (!rows.length || rows.length > 1024) unavailable();
    const parts: Bound[] = [];
    for (const row of rows) {
      if (!row.admissionContext) unavailable();
      const bound = await this.authenticator.authenticate(
        manager,
        row.rawPayload,
        row.admissionContext.context,
        secret,
      );
      if (
        bound.payloadHash !== row.payloadHash ||
        row.routeMode !== 'EPISODE_TRACKED' ||
        row.routeEpoch !== bound.routeEpoch ||
        bound.bindingHash !== row.admissionContext.bindingHash ||
        bound.scopeSha256 !== row.scopeSha256 ||
        bound.cameraId !== key.cameraId ||
        bound.context.workerGenerationId !== key.generationId ||
        bound.context.streamSessionId !== key.streamSessionId
      )
        unavailable();
      parts.push(bound);
    }
    const coordinator = rows.find((row) => row.partIndex === 0);
    if (coordinator?.frameState === 'SEALED') {
      if (coordinator.frameResult?.kind !== 'ADMITTED_TRACKED_FRAME') unavailable();
      return { kind: 'SEALED' as const, result: coordinator.frameResult };
    }
    if (coordinator?.frameState === 'REVIEW_ONLY')
      return {
        kind: 'REVIEW_ONLY' as const,
        reason: String(coordinator.frameResult?.reason ?? 'TERMINAL_REVIEW'),
      };
    const [clock] = await manager.query<Array<{ now: Date }>>('SELECT clock_timestamp() AS now');
    if (!clock || !(clock.now instanceof Date) || !Number.isFinite(clock.now.getTime()))
      unavailable();
    const now = clock.now;
    const review = async (reason: string) => {
      if (coordinator)
        await manager.query(
          `UPDATE ai_observation_event SET tracking_frame_state='REVIEW_ONLY',tracking_frame_result=$2 WHERE event_id=$1`,
          [coordinator.eventId, { reason, terminalizedAt: now.toISOString() }],
        );
      await manager.query(
        `UPDATE ai_observation_event SET tracking_frame_state='PART_EXPIRED' WHERE resolved_camera_id=$1 AND tracking_generation_id=$2
        AND stream_session_id=$3 AND tracking_frame_id=$4 AND tracking_frame_state='PART_STAGED'`,
        [...sourceKey, key.frameId],
      );
      return { kind: 'REVIEW_ONLY' as const, reason };
    };
    if (
      parts.some((part) => part.classification !== 'LIVE') ||
      rows.some((row) => row.admissionContext?.classification !== 'LIVE')
    )
      return review('SOURCE_REVIEW_ONLY');
    if (rows.some((row) => row.frameState === 'PART_EXPIRED' || row.pendingUntil <= now))
      return review(
        coordinator?.frameState === 'PENDING_PREDECESSOR' ? 'PREDECESSOR_EXPIRED' : 'PARTS_EXPIRED',
      );
    const frame = inspectTrackedFrameParts(rows);
    if (frame.kind === 'REVIEW_ONLY') return review(frame.reason);
    if (frame.kind === 'PENDING_PARTS' || !coordinator) return { kind: 'PENDING_PARTS' as const };
    const scope = parts[rows.indexOf(coordinator)]!,
      payload = scope.payload as Payload;
    const capturedAtNs = instant(payload.capturedAt);
    if (capturedAtNs === null) return review('CAPTURE_TIME_UNAVAILABLE');
    const ids = [
      ...new Set([
        ...frame.subjects.map((subject) => subject.segmentId),
        ...frame.retiredSegments.map((retired) => retired.segmentId),
      ]),
    ].sort();
    if (ids.length > this.policy.maxSegmentRows) unavailable();
    for (const id of ids)
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`tracked-segment:${id}`]);
    const heads = ids.length
      ? await manager.query<Array<TrackedHeadSnapshot & { rawCapturedAt: string | null }>>(
          `SELECT s.segment_id AS "segmentId",s.scope_sha256 AS "scopeSha256",s.state,
      s.head_event_id AS "eventId",s.head_person_observation_index AS "personObservationIndex",s.head_source_sequence::text AS "sequenceNumber",
      r.raw_payload->>'capturedAt' AS "rawCapturedAt" FROM ai_subject_segment s LEFT JOIN ai_observation_event r ON r.event_id=s.head_event_id
      WHERE s.segment_id=ANY($1::uuid[]) ORDER BY s.segment_id FOR UPDATE OF s`,
          [ids],
        )
      : [];
    const [watermark] = await manager.query<Array<{ sequence: string }>>(
      `SELECT tracking_source_sequence::text AS sequence FROM ai_observation_event
      WHERE resolved_camera_id=$1 AND tracking_generation_id=$2 AND stream_session_id=$3 AND tracking_part_index=0 AND tracking_frame_state='SEALED'
      ORDER BY tracking_source_sequence DESC,event_id DESC LIMIT 1`,
      sourceKey,
    );
    const pendingSql = `SELECT 1 FROM ai_observation_event p WHERE p.resolved_camera_id=$1
      AND p.tracking_frame_state IN ('PART_STAGED','PENDING_PARTS','PENDING_PREDECESSOR')
      AND NOT EXISTS(SELECT 1 FROM ai_observation_event c WHERE c.resolved_camera_id=p.resolved_camera_id AND c.tracking_generation_id=p.tracking_generation_id
        AND c.stream_session_id=p.stream_session_id AND c.tracking_frame_id=p.tracking_frame_id AND c.tracking_part_index=0 AND c.tracking_frame_state IN ('SEALED','REVIEW_ONLY'))`;
    const earlier = await manager.query(
      `${pendingSql} AND p.tracking_generation_id=$2 AND p.stream_session_id=$3 AND p.tracking_source_sequence<$4 LIMIT 1`,
      [...sourceKey, frame.sequenceNumber],
    );
    const otherPending = await manager.query(
      `${pendingSql} AND p.tracking_scope_sha256<>$2 LIMIT 1`,
      [key.cameraId, scope.scopeSha256],
    );
    const otherHeads = await manager.query(
      "SELECT 1 FROM ai_subject_segment WHERE camera_id=$1 AND state='ACTIVE' AND scope_sha256<>$2 LIMIT 1",
      [key.cameraId, scope.scopeSha256],
    );
    const predecessors = await this.readPredecessors(manager, frame);
    const plan = planTrackedHeads(
      frame,
      scope.scopeSha256,
      capturedAtNs,
      {
        heads: heads.map((head) => ({
          ...head,
          capturedAtNs: head.rawCapturedAt === null ? null : instant(head.rawCapturedAt),
        })),
        predecessors,
        watermark: watermark?.sequence,
        earlierPending: earlier.length > 0,
        scopeTransitionPending: otherPending.length > 0 || otherHeads.length > 0,
      },
      this.policy,
    );
    if (plan.kind === 'REVIEW_ONLY') return review(plan.reason);
    if (plan.kind === 'PENDING_PREDECESSOR') {
      if (coordinator.frameState === 'PENDING_PARTS')
        await manager.query(
          "UPDATE ai_observation_event SET tracking_frame_state='PENDING_PREDECESSOR' WHERE event_id=$1",
          [coordinator.eventId],
        );
      return plan;
    }
    // Immutable outcome is deterministic before writes. It contains no not-yet-created business IDs.
    // Other transactions see this seal only if heads AND the required projection port commit.
    const result = {
      kind: 'ADMITTED_TRACKED_FRAME',
      scopeSha256: scope.scopeSha256,
      sequenceNumber: frame.sequenceNumber,
      subjects: frame.subjects.map(({ segmentId, eventId, personObservationIndex }) => ({
        segmentId,
        eventId,
        personObservationIndex,
      })),
      retiredSegmentIds: plan.retirements.map((item) => item.segmentId),
    };
    await manager.query(
      "UPDATE ai_observation_event SET tracking_frame_state='SEALED',tracking_frame_result=$2 WHERE event_id=$1",
      [coordinator.eventId, result],
    );
    for (const action of plan.subjects) {
      const subject = action.subject;
      if (action.kind === 'START')
        await manager.query(
          `INSERT INTO ai_subject_segment(segment_id,scope_sha256,site_id,camera_id,generation_id,stream_session_id,
        configuration_version,view_revision,bundle_sha256,profile_sha256,source_kind,first_event_id,first_person_observation_index,
        head_event_id,head_person_observation_index,head_source_sequence,head_captured_at,state)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$12,$13,$14,(SELECT captured_at FROM ai_observation_event WHERE event_id=$12),'ACTIVE')`,
          [
            subject.segmentId,
            scope.scopeSha256,
            scope.siteId,
            scope.cameraId,
            scope.context.workerGenerationId,
            scope.context.streamSessionId,
            scope.context.configurationVersion,
            scope.context.viewRevision,
            scope.context.bundleSha256,
            payload.continuity.profileSha256,
            scope.context.sourceKind,
            subject.eventId,
            subject.personObservationIndex,
            frame.sequenceNumber,
          ],
        );
      else
        await manager.query(
          `UPDATE ai_subject_segment SET head_event_id=$2,head_person_observation_index=$3,head_source_sequence=$4,
        head_captured_at=(SELECT captured_at FROM ai_observation_event WHERE event_id=$2) WHERE segment_id=$1`,
          [
            subject.segmentId,
            subject.eventId,
            subject.personObservationIndex,
            frame.sequenceNumber,
          ],
        );
    }
    for (const retired of plan.retirements) {
      const provenance = {
        kind: 'CAPTURED_RETIREMENT',
        eventId: coordinator.eventId,
        payloadHash: scope.payloadHash,
        retirementIndex: payload.continuity.retiredSegments.findIndex(
          (item) => item.segmentId === retired.segmentId,
        ),
        reason: retired.reason,
      };
      if (retired.tombstone)
        await manager.query(
          `INSERT INTO ai_subject_segment(segment_id,scope_sha256,site_id,camera_id,generation_id,stream_session_id,
        configuration_version,view_revision,bundle_sha256,profile_sha256,source_kind,state,retired_at,retirement_reason,retirement_event_id,retirement_provenance)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'RETIRED',(SELECT captured_at FROM ai_observation_event WHERE event_id=$12),$13,$12,$14)`,
          [
            retired.segmentId,
            scope.scopeSha256,
            scope.siteId,
            scope.cameraId,
            scope.context.workerGenerationId,
            scope.context.streamSessionId,
            scope.context.configurationVersion,
            scope.context.viewRevision,
            scope.context.bundleSha256,
            payload.continuity.profileSha256,
            scope.context.sourceKind,
            coordinator.eventId,
            retired.reason,
            provenance,
          ],
        );
      else
        await manager.query(
          `UPDATE ai_subject_segment SET state='RETIRED',retired_at=(SELECT captured_at FROM ai_observation_event WHERE event_id=$2),
        retirement_reason=$3,retirement_event_id=$2,retirement_provenance=$4 WHERE segment_id=$1`,
          [retired.segmentId, coordinator.eventId, retired.reason, provenance],
        );
    }
    const projection = Object.freeze({
      scope,
      parts: Object.freeze(parts),
      plan,
      coordinatorEventId: coordinator.eventId,
    });
    activeProjections.set(projection, manager);
    try {
      await this.projector.project(manager, projection);
    } finally {
      activeProjections.delete(projection);
    }
    return { kind: 'SEALED' as const, result };
  }

  private async readPredecessors(
    manager: EntityManager,
    frame: Parameters<typeof planTrackedHeads>[0],
  ): Promise<TrackedPredecessorSnapshot[]> {
    const links = frame.subjects.flatMap((subject) =>
      subject.link.kind === 'CONTINUE' ? [{ ...subject.link, segmentId: subject.segmentId }] : [],
    );
    if (!links.length) return [];
    const rows = await manager.query<
      Array<{
        eventId: string;
        payloadHash: string;
        rawPayload: unknown;
        scope: string | null;
        sequence: string | null;
        state: string;
        coordinatorState: string | null;
      }>
    >(
      `SELECT p.event_id AS "eventId",p.payload_hash AS "payloadHash",p.raw_payload AS "rawPayload",p.tracking_scope_sha256 AS scope,
        p.tracking_source_sequence::text AS sequence,p.tracking_frame_state AS state,c.tracking_frame_state AS "coordinatorState"
        FROM ai_observation_event p LEFT JOIN ai_observation_event c ON c.resolved_camera_id=p.resolved_camera_id AND c.tracking_generation_id=p.tracking_generation_id
        AND c.stream_session_id=p.stream_session_id AND c.tracking_frame_id=p.tracking_frame_id AND c.tracking_part_index=0 WHERE p.event_id=ANY($1::uuid[])`,
      [[...new Set(links.map((link) => link.previousEventId))]],
    );
    return links.flatMap((link) => {
      const row = rows.find((item) => item.eventId === link.previousEventId);
      if (!row) return [];
      if (
        row.scope &&
        (!validateTrackedObservationEvent(row.rawPayload).isValid ||
          computeCanonicalPayloadHash(row.rawPayload) !== row.payloadHash)
      )
        unavailable();
      const payload = row.rawPayload as Payload;
      const claim = payload.continuity?.subjects.find(
        (item) => item.personObservationIndex === link.previousPersonObservationIndex,
      );
      return [
        {
          eventId: row.eventId,
          personObservationIndex: link.previousPersonObservationIndex,
          segmentId:
            payload.observations?.[link.previousPersonObservationIndex]?.type === 'PERSON'
              ? (claim?.segmentId ?? '')
              : '',
          scopeSha256: row.scope ?? '',
          sequenceNumber: row.sequence ?? '0',
          state:
            row.state === 'PART_EXPIRED' || row.coordinatorState === 'REVIEW_ONLY'
              ? ('REJECTED' as const)
              : row.coordinatorState === 'SEALED'
                ? ('SEALED' as const)
                : ('PENDING' as const),
        },
      ];
    });
  }
}
