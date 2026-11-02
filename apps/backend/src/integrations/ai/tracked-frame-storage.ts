import { computeCanonicalPayloadHash, type ObservationFramePartition } from '@smartsite/contracts';
import type { DataSource, EntityManager } from 'typeorm';
import { PublicHttpException } from '../../common/http/public-http-exception.js';
import { parseNormalizedCapturedAt } from '../../common/parse-normalized-captured-at.js';
import { inspectTrackedFrameParts } from './tracked-frame-parts.js';
import { TrackedPartAuthenticator } from './tracked-part-authentication.js';

export interface TrackedPendingPolicy {
  readonly pendingTtlMs: number;
  readonly maxPendingFrames: number;
  readonly maxPendingParts: number;
  readonly maxPendingPayloadBytes: number;
}
interface Payload {
  eventId: string;
  cameraExternalId: string;
  streamSessionId: string;
  capturedAt: string;
  framePartition: ObservationFramePartition;
  continuity: { coverage: { status: string } };
}
interface Receipt {
  kind: 'RAW_STORED';
  eventId: string;
  payloadHash: string;
  bindingHash: string;
}
interface StoredRow {
  routeMode: string | null;
  routeEpoch: string | null;
  eventId: string;
  payloadHash: string;
  rawPayload: unknown;
  admissionContext: { context: unknown; bindingHash: string } | null;
  scopeSha256: string;
  frameId: string;
  sourceSequence: string;
  partIndex: number;
  partCount: number;
  frameState: string;
  pendingUntil: Date;
  transportAck: Receipt;
}
const columns = `event_id AS "eventId",payload_hash AS "payloadHash",raw_payload AS "rawPayload",
 admission_context AS "admissionContext",tracking_scope_sha256 AS "scopeSha256",tracking_frame_id AS "frameId",
 tracking_source_sequence::text AS "sourceSequence",tracking_part_index AS "partIndex",tracking_part_count AS "partCount",
 tracking_frame_state AS "frameState",tracking_pending_until AS "pendingUntil",tracking_transport_ack AS "transportAck",
 safety_route_mode AS "routeMode",safety_route_epoch AS "routeEpoch"`;
function reject(status: 409 | 503): never {
  throw new PublicHttpException(status, {
    code: status === 409 ? 'CONFLICT' : 'AI_INGESTION_UNAVAILABLE',
    message: 'Tracked raw storage is unavailable',
  });
}

/** Camera row must already be locked by the caller; shared with bounded pending recovery. */
export async function lockTrackedFrameAfterCamera(
  manager: EntityManager,
  sourceKey: readonly string[],
  frameId: string,
  sequenceNumber: string,
) {
  await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    `tracked-source:${sourceKey.join(':')}`,
  ]);
  for (const key of [
    `tracked-frame:${sourceKey.join(':')}:${frameId}`,
    `tracked-sequence:${sourceKey.join(':')}:${sequenceNumber}`,
  ].sort())
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
}

/** Unregistered prototype: immutable raw receipts only. No legacy intake, seal, head or notification call.
 * Pending limits are server-injected; fixture values are not production capacity/TTL qualification.
 */
export class TrackedFramePrototypeStore {
  private readonly policy: TrackedPendingPolicy;
  constructor(
    private readonly authenticator: TrackedPartAuthenticator,
    policy: TrackedPendingPolicy,
  ) {
    const keys = [
      'pendingTtlMs',
      'maxPendingFrames',
      'maxPendingParts',
      'maxPendingPayloadBytes',
    ] as const;
    if (
      Object.keys(policy).length !== keys.length ||
      keys.some(
        (key) =>
          !Number.isSafeInteger(policy[key]) ||
          policy[key] < 1 ||
          policy[key] >= Number.MAX_SAFE_INTEGER,
      )
    )
      throw new Error('Invalid server pending policy');
    this.policy = Object.freeze({ ...policy });
  }

  store(source: DataSource, payload: unknown, context: unknown, secret: string) {
    return source.transaction((manager) =>
      this.storeInTransaction(manager, payload, context, secret),
    );
  }

  private async storeInTransaction(
    manager: EntityManager,
    payload: unknown,
    context: unknown,
    secret: string,
  ) {
    // The existing admission gate first locks camera, serializing generation/configuration transitions.
    const bound = await this.authenticator.authenticate(manager, payload, context, secret);
    const event = bound.payload as Payload,
      part = event.framePartition;
    const sourceKey = [
      bound.cameraId,
      bound.context.workerGenerationId,
      bound.context.streamSessionId,
    ];
    await lockTrackedFrameAfterCamera(manager, sourceKey, part.frameId, part.sequenceNumber);
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `bound-event:${bound.eventId}`,
    ]);
    const [existing] = await manager.query<StoredRow[]>(
      `SELECT ${columns} FROM ai_observation_event WHERE event_id=$1 FOR UPDATE`,
      [bound.eventId],
    );
    if (existing) {
      if (
        existing.routeMode !== 'EPISODE_TRACKED' ||
        existing.routeEpoch !== bound.routeEpoch ||
        existing.payloadHash !== bound.payloadHash ||
        computeCanonicalPayloadHash(existing.rawPayload) !== bound.payloadHash ||
        existing.admissionContext?.bindingHash !== bound.bindingHash ||
        computeCanonicalPayloadHash(existing.admissionContext.context) !==
          computeCanonicalPayloadHash(bound.context) ||
        existing.scopeSha256 !== bound.scopeSha256 ||
        existing.frameId !== part.frameId ||
        existing.sourceSequence !== part.sequenceNumber ||
        existing.partIndex !== part.partIndex ||
        existing.partCount !== part.partCount ||
        existing.transportAck?.kind !== 'RAW_STORED' ||
        existing.transportAck.eventId !== bound.eventId ||
        existing.transportAck.payloadHash !== bound.payloadHash ||
        existing.transportAck.bindingHash !== bound.bindingHash
      )
        reject(409);
      return { receipt: existing.transportAck, duplicate: true };
    }
    const sourceRoute = await manager.query(
      `SELECT 1 FROM ai_observation_event WHERE resolved_camera_id=$1 AND tracking_generation_id=$2 AND stream_session_id=$3
      AND (safety_route_mode IS DISTINCT FROM 'EPISODE_TRACKED' OR safety_route_epoch IS DISTINCT FROM $4::uuid) LIMIT 1`,
      [...sourceKey, bound.routeEpoch],
    );
    if (sourceRoute.length) reject(409);
    const rows = await manager.query<StoredRow[]>(
      `SELECT ${columns} FROM ai_observation_event
      WHERE resolved_camera_id=$1 AND tracking_generation_id=$2 AND stream_session_id=$3
        AND (tracking_frame_id=$4 OR tracking_source_sequence=$5) ORDER BY tracking_part_index LIMIT 1025 FOR UPDATE`,
      [...sourceKey, part.frameId, part.sequenceNumber],
    );
    if (rows.length > 1024) reject(503);
    let originalReviewOnly = false;
    for (const row of rows) {
      if (row.frameState === 'SEALED') reject(409);
      if (
        !row.admissionContext ||
        row.routeMode !== 'EPISODE_TRACKED' ||
        row.routeEpoch !== bound.routeEpoch ||
        row.scopeSha256 !== bound.scopeSha256 ||
        row.frameId !== part.frameId ||
        row.sourceSequence !== part.sequenceNumber
      )
        reject(409);
      const original = await this.authenticator.authenticate(
        manager,
        row.rawPayload,
        row.admissionContext.context,
        secret,
      );
      if (
        original.payloadHash !== row.payloadHash ||
        original.bindingHash !== row.admissionContext.bindingHash ||
        original.scopeSha256 !== row.scopeSha256
      )
        reject(503);
      originalReviewOnly ||= original.classification !== 'LIVE';
    }
    try {
      inspectTrackedFrameParts([
        ...rows,
        {
          eventId: bound.eventId,
          payloadHash: bound.payloadHash,
          rawPayload: bound.payload,
          scopeSha256: bound.scopeSha256,
        },
      ]);
    } catch {
      reject(409);
    }
    const [clock] = await manager.query<Array<{ now: Date }>>('SELECT clock_timestamp() AS now');
    const now = clock?.now;
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) reject(503);
    const deadline = rows.length
      ? new Date(Math.min(...rows.map((r) => r.pendingUntil.getTime())))
      : new Date(now.getTime() + this.policy.pendingTtlMs);
    if (!Number.isFinite(deadline.getTime())) reject(503);
    const [watermark] = await manager.query<Array<{ sequence: string }>>(
      `SELECT tracking_source_sequence::text AS sequence FROM ai_observation_event
      WHERE resolved_camera_id=$1 AND tracking_generation_id=$2 AND stream_session_id=$3 AND tracking_part_index=0 AND tracking_frame_state='SEALED'
      ORDER BY tracking_source_sequence DESC,event_id DESC LIMIT 1`,
      sourceKey,
    );
    const reason =
      event.continuity.coverage.status !== 'COMPLETE'
        ? 'INCOMPLETE_COVERAGE'
        : bound.classification !== 'LIVE' || originalReviewOnly
          ? 'SOURCE_REVIEW_ONLY'
          : rows.some((r) => r.frameState === 'REVIEW_ONLY' || r.frameState === 'PART_EXPIRED') ||
              deadline <= now
            ? 'PARTS_EXPIRED'
            : watermark && BigInt(part.sequenceNumber) <= BigInt(watermark.sequence)
              ? 'LATE_SOURCE_SEQUENCE'
              : undefined;
    if (!reason)
      await this.checkCapacity(manager, sourceKey, part.frameId, JSON.stringify(bound.payload));
    const receipt: Receipt = {
      kind: 'RAW_STORED',
      eventId: bound.eventId,
      payloadHash: bound.payloadHash,
      bindingHash: bound.bindingHash,
    };
    const result = reason ? { reason, terminalizedAt: now.toISOString() } : null;
    const capturedAt = parseNormalizedCapturedAt(event.capturedAt);
    if (!capturedAt) reject(503);
    await manager.query(
      `INSERT INTO ai_observation_event(event_id,payload_hash,camera_external_id,resolved_camera_id,stream_session_id,captured_at,raw_payload,
      processing_status,processing_note,admission_context,tracking_scope_sha256,tracking_generation_id,tracking_site_id,tracking_frame_id,
      tracking_source_sequence,tracking_part_index,tracking_part_count,tracking_frame_state,tracking_pending_until,tracking_transport_ack,tracking_frame_result,safety_route_mode,safety_route_epoch)
      VALUES($1,$2,$3,$4,$5,$6,$7,'PROCESSED','TRACKED_RAW_STORED_NO_PROJECTION',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'EPISODE_TRACKED',$20)`,
      [
        bound.eventId,
        bound.payloadHash,
        event.cameraExternalId,
        bound.cameraId,
        bound.context.streamSessionId,
        // Preserve legacy millisecond column semantics; raw payload retains the exact authority instant.
        capturedAt,
        JSON.stringify(bound.payload),
        JSON.stringify({
          schemaVersion: '1.0.0',
          context: bound.context,
          bindingHash: bound.bindingHash,
          classification: bound.classification,
          admittedAt: bound.admittedAt,
        }),
        bound.scopeSha256,
        bound.context.workerGenerationId,
        bound.siteId,
        part.frameId,
        part.sequenceNumber,
        part.partIndex,
        part.partCount,
        part.partIndex
          ? reason
            ? 'PART_EXPIRED'
            : 'PART_STAGED'
          : reason
            ? 'REVIEW_ONLY'
            : 'PENDING_PARTS',
        deadline,
        JSON.stringify(receipt),
        part.partIndex ? null : result,
        bound.routeEpoch,
      ],
    );
    if (reason) {
      const coordinator = rows.find((r) => r.partIndex === 0);
      if (coordinator && ['PENDING_PARTS', 'PENDING_PREDECESSOR'].includes(coordinator.frameState))
        await manager.query(
          `UPDATE ai_observation_event SET tracking_frame_state='REVIEW_ONLY',tracking_frame_result=$2 WHERE event_id=$1`,
          [
            coordinator.eventId,
            {
              reason:
                coordinator.frameState === 'PENDING_PREDECESSOR' && reason === 'PARTS_EXPIRED'
                  ? 'PREDECESSOR_EXPIRED'
                  : reason,
              terminalizedAt: now.toISOString(),
            },
          ],
        );
      await manager.query(
        `UPDATE ai_observation_event SET tracking_frame_state='PART_EXPIRED'
        WHERE resolved_camera_id=$1 AND tracking_generation_id=$2 AND stream_session_id=$3 AND tracking_frame_id=$4 AND tracking_frame_state='PART_STAGED'`,
        [...sourceKey, part.frameId],
      );
    }
    return { receipt, duplicate: false };
  }

  private async checkCapacity(
    manager: EntityManager,
    sourceKey: string[],
    frameId: string,
    payload: string,
  ) {
    const pending = await manager.query<Array<{ frameId: string; bytes: number }>>(
      `SELECT p.tracking_frame_id AS "frameId",octet_length(p.raw_payload::text) AS bytes
      FROM ai_observation_event p WHERE p.resolved_camera_id=$1 AND p.tracking_generation_id=$2 AND p.stream_session_id=$3
        AND p.tracking_frame_state IN ('PART_STAGED','PENDING_PARTS','PENDING_PREDECESSOR')
        AND NOT EXISTS(SELECT 1 FROM ai_observation_event c WHERE c.resolved_camera_id=p.resolved_camera_id
          AND c.tracking_generation_id=p.tracking_generation_id AND c.stream_session_id=p.stream_session_id
          AND c.tracking_frame_id=p.tracking_frame_id AND c.tracking_part_index=0 AND c.tracking_frame_state IN ('SEALED','REVIEW_ONLY'))
      ORDER BY p.event_id LIMIT $4`,
      [...sourceKey, this.policy.maxPendingParts + 1],
    );
    const [sizing] = await manager.query<Array<{ bytes: number }>>(
      'SELECT octet_length($1::jsonb::text) AS bytes',
      [payload],
    );
    if (!sizing || !Number.isSafeInteger(sizing.bytes) || sizing.bytes < 1) reject(503);
    const total = pending.reduce((sum, row) => sum + row.bytes, sizing.bytes);
    const frames = new Set(pending.map((row) => row.frameId));
    frames.add(frameId);
    if (
      pending.length >= this.policy.maxPendingParts ||
      frames.size > this.policy.maxPendingFrames ||
      !Number.isSafeInteger(total) ||
      total > this.policy.maxPendingPayloadBytes
    )
      reject(503);
  }
}
