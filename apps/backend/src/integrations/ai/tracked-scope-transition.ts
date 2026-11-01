import type { DataSource } from 'typeorm';
import { TrackedPartAuthenticator } from './tracked-part-authentication.js';
import { sealRetiredTrackedEpisodes } from '../../modules/safety/alerts/tracked-ppe-episode-projection.js';

interface TransitionCommand {
  /** Server correlation only; this is not a public worker command or a durable command receipt. */
  commandId: string;
  targetEventId: string;
  expectedOldScopes: readonly string[];
}
interface RawTarget {
  routeMode: string | null;
  routeEpoch: string | null;
  cameraId: string;
  siteId: string;
  scopeSha256: string;
  payloadHash: string;
  rawPayload: unknown;
  context: { context: unknown; bindingHash: string };
  pendingUntil: Date;
  state: string;
}
const uuid = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
function unavailable(): never {
  throw new Error('TRACKED_SCOPE_TRANSITION_UNAVAILABLE');
}

/** Unregistered, trusted Backend control only. Never expose through worker-token HTTP intake.
 * A currently LIVE, stored original coordinator selects the issued target scope. The control
 * plane must explicitly name the old scopes; worker START/bundle claims cannot invoke this.
 * No observed EXIT, episode, notification, watermark reset or credential is manufactured.
 */
export class TrackedScopeTransition {
  private readonly policy: Readonly<{ maxPendingRows: number; maxActiveSegments: number }>;
  constructor(
    private readonly authenticator: TrackedPartAuthenticator,
    policy: { maxPendingRows: number; maxActiveSegments: number },
  ) {
    if (
      [policy.maxPendingRows, policy.maxActiveSegments].some(
        (n) => !Number.isSafeInteger(n) || n < 1 || n > 4096,
      )
    )
      unavailable();
    this.policy = Object.freeze({ ...policy });
  }

  apply(source: DataSource, command: TransitionCommand, secret: string) {
    if (
      !command ||
      !uuid.test(command.commandId) ||
      !uuid.test(command.targetEventId) ||
      !Array.isArray(command.expectedOldScopes) ||
      command.expectedOldScopes.length > 4096 ||
      command.expectedOldScopes.some((hash) => !/^[a-f0-9]{64}$/.test(hash)) ||
      new Set(command.expectedOldScopes).size !== command.expectedOldScopes.length
    )
      unavailable();
    // Snapshot before the first await, including caller-owned arrays.
    const input = { ...command, expectedOldScopes: [...command.expectedOldScopes].sort() };
    return source.transaction(async (manager) => {
      // This discovery read takes no raw-row lock before the shared camera transition fence.
      const [discovery] = await manager.query<Array<{ cameraId: string }>>(
        'SELECT resolved_camera_id AS "cameraId" FROM ai_observation_event WHERE event_id=$1 AND tracking_part_index=0',
        [input.targetEventId],
      );
      if (!discovery) unavailable();
      const cameras = await manager.query('SELECT id FROM camera WHERE id=$1 FOR UPDATE', [
        discovery.cameraId,
      ]);
      if (cameras.length !== 1) unavailable();
      const [target] = await manager.query<RawTarget[]>(
        `SELECT resolved_camera_id AS "cameraId",tracking_site_id AS "siteId",tracking_scope_sha256 AS "scopeSha256",
        payload_hash AS "payloadHash",raw_payload AS "rawPayload",admission_context AS context,
        tracking_pending_until AS "pendingUntil",tracking_frame_state AS state,
        safety_route_mode AS "routeMode",safety_route_epoch AS "routeEpoch"
        FROM ai_observation_event WHERE event_id=$1 AND tracking_part_index=0 FOR UPDATE`,
        [input.targetEventId],
      );
      if (
        !target ||
        target.cameraId !== discovery.cameraId ||
        !target.context ||
        !['PENDING_PARTS', 'PENDING_PREDECESSOR', 'SEALED'].includes(target.state)
      )
        unavailable();
      const bound = await this.authenticator.authenticate(
        manager,
        target.rawPayload,
        target.context.context,
        secret,
      );
      if (
        bound.classification !== 'LIVE' ||
        target.routeMode !== 'EPISODE_TRACKED' ||
        target.routeEpoch !== bound.routeEpoch ||
        bound.eventId !== input.targetEventId ||
        bound.cameraId !== target.cameraId ||
        bound.siteId !== target.siteId ||
        bound.payloadHash !== target.payloadHash ||
        bound.bindingHash !== target.context.bindingHash ||
        bound.scopeSha256 !== target.scopeSha256
      )
        unavailable();
      const [clock] = await manager.query<Array<{ now: Date }>>('SELECT clock_timestamp() AS now');
      if (!clock) unavailable();
      const now = clock.now;
      if (
        !(now instanceof Date) ||
        !Number.isFinite(now.getTime()) ||
        (target.state !== 'SEALED' &&
          (!(target.pendingUntil instanceof Date) || target.pendingUntil <= now))
      )
        unavailable();
      const pending = await manager.query<
        Array<{ eventId: string; scopeSha256: string; partIndex: number }>
      >(
        `SELECT p.event_id AS "eventId",p.tracking_scope_sha256 AS "scopeSha256",p.tracking_part_index AS "partIndex"
        FROM ai_observation_event p WHERE p.resolved_camera_id=$1 AND p.tracking_scope_sha256<>$2
        AND p.tracking_frame_state IN ('PART_STAGED','PENDING_PARTS','PENDING_PREDECESSOR')
        AND NOT EXISTS(SELECT 1 FROM ai_observation_event c WHERE c.resolved_camera_id=p.resolved_camera_id
          AND c.tracking_generation_id=p.tracking_generation_id AND c.stream_session_id=p.stream_session_id
          AND c.tracking_frame_id=p.tracking_frame_id AND c.tracking_part_index=0 AND c.tracking_frame_state='SEALED')
        ORDER BY p.event_id LIMIT $3 FOR UPDATE OF p`,
        [target.cameraId, target.scopeSha256, this.policy.maxPendingRows + 1],
      );
      const heads = await manager.query<Array<{ segmentId: string; scopeSha256: string }>>(
        `SELECT segment_id AS "segmentId",scope_sha256 AS "scopeSha256" FROM ai_subject_segment
        WHERE camera_id=$1 AND scope_sha256<>$2 AND state='ACTIVE' ORDER BY segment_id LIMIT $3`,
        [target.cameraId, target.scopeSha256, this.policy.maxActiveSegments + 1],
      );
      if (
        pending.length > this.policy.maxPendingRows ||
        heads.length > this.policy.maxActiveSegments
      )
        unavailable();
      const oldScopes = [...new Set([...pending, ...heads].map((row) => row.scopeSha256))].sort();
      // Repeated application is state-idempotent, not a persistent command-id ACK protocol.
      if (!oldScopes.length) return { retiredSegments: 0, terminalizedParts: 0 };
      if (JSON.stringify(oldScopes) !== JSON.stringify(input.expectedOldScopes)) unavailable();
      for (const head of heads)
        await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
          `tracked-segment:${head.segmentId}`,
        ]);
      const provenance = {
        kind: 'SERVER_SCOPE_TRANSITION',
        commandId: input.commandId,
        targetEventId: input.targetEventId,
        targetPayloadHash: bound.payloadHash,
        targetBindingHash: bound.bindingHash,
        targetScopeSha256: bound.scopeSha256,
        decidedAt: now.toISOString(),
      };
      // The same camera row serializes all raw intake, expiry, head progression and this control.
      // Raw/context/ACK/deadline and original heads stay untouched; terminal history stays immutable.
      for (const row of pending) {
        await manager.query(
          row.partIndex === 0
            ? `UPDATE ai_observation_event SET tracking_frame_state='REVIEW_ONLY',tracking_frame_result=$2 WHERE event_id=$1`
            : `UPDATE ai_observation_event SET tracking_frame_state='PART_EXPIRED' WHERE event_id=$1`,
          row.partIndex === 0
            ? [row.eventId, { reason: 'SERVER_SCOPE_TRANSITION', ...provenance }]
            : [row.eventId],
        );
      }
      for (const head of heads)
        await manager.query(
          `UPDATE ai_subject_segment SET state='RETIRED',retired_at=$2,
          retirement_reason='SERVER_SCOPE_TRANSITION',retirement_provenance=$3 WHERE segment_id=$1 AND state='ACTIVE'`,
          [head.segmentId, now, provenance],
        );
      await sealRetiredTrackedEpisodes(
        manager,
        target.siteId,
        target.cameraId,
        heads.map((head) => head.segmentId),
      );
      return { retiredSegments: heads.length, terminalizedParts: pending.length };
    });
  }
}
