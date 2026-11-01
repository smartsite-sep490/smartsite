import type { DataSource } from 'typeorm';
import { lockTrackedFrameAfterCamera } from './tracked-frame-storage.js';

interface Candidate {
  cameraId: string;
  generationId: string;
  sessionId: string;
  frameId: string;
  sequence: string;
}
interface PendingRow {
  eventId: string;
  partIndex: number;
  frameState: string;
  pendingUntil: Date;
}

/** Bounded prototype invocation, not a registered background timer or projection worker.
 * Expiry is a server technical outcome only; no raw receipt, subject, episode or recipient changes.
 */
export async function expireTrackedPending(
  source: DataSource,
  allowedCameraIds: readonly string[],
  maxCandidateRows: number,
) {
  if (
    !allowedCameraIds.length ||
    allowedCameraIds.some((id) => !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)) ||
    !Number.isSafeInteger(maxCandidateRows) ||
    maxCandidateRows < 1
  )
    throw new Error('Invalid server pending recovery scope');
  // No raw-row locks before the camera fence. Re-read all selected work under the same intake locks.
  const candidates = await source.query<Candidate[]>(
    `SELECT p.resolved_camera_id AS "cameraId",p.tracking_generation_id AS "generationId",
    p.stream_session_id AS "sessionId",p.tracking_frame_id AS "frameId",p.tracking_source_sequence::text AS sequence
    FROM ai_observation_event p WHERE p.resolved_camera_id=ANY($1::uuid[]) AND p.tracking_pending_until<=clock_timestamp()
      AND p.tracking_frame_state IN ('PART_STAGED','PENDING_PARTS','PENDING_PREDECESSOR')
      AND NOT EXISTS(SELECT 1 FROM ai_observation_event c WHERE c.resolved_camera_id=p.resolved_camera_id
        AND c.tracking_generation_id=p.tracking_generation_id AND c.stream_session_id=p.stream_session_id
        AND c.tracking_frame_id=p.tracking_frame_id AND c.tracking_part_index=0 AND c.tracking_frame_state='SEALED')
    ORDER BY p.tracking_pending_until,p.event_id LIMIT $2`,
    [[...allowedCameraIds], maxCandidateRows],
  );
  const seen = new Set<string>();
  let expiredFrames = 0,
    expiredParts = 0;
  for (const candidate of candidates) {
    const sourceKey = [candidate.cameraId, candidate.generationId, candidate.sessionId];
    const key = [...sourceKey, candidate.frameId].join(':');
    if (seen.has(key)) continue;
    seen.add(key);
    const result = await source.transaction(async (manager) => {
      const cameras = await manager.query('SELECT id FROM camera WHERE id=$1 FOR UPDATE', [
        candidate.cameraId,
      ]);
      if (!cameras.length) throw new Error('Pending source camera is unavailable');
      await lockTrackedFrameAfterCamera(manager, sourceKey, candidate.frameId, candidate.sequence);
      const rows = await manager.query<PendingRow[]>(
        `SELECT event_id AS "eventId",tracking_part_index AS "partIndex",
        tracking_frame_state AS "frameState",tracking_pending_until AS "pendingUntil" FROM ai_observation_event
        WHERE resolved_camera_id=$1 AND tracking_generation_id=$2 AND stream_session_id=$3 AND tracking_frame_id=$4
        ORDER BY tracking_part_index LIMIT 1025 FOR UPDATE`,
        [...sourceKey, candidate.frameId],
      );
      if (rows.length > 1024) throw new Error('Pending frame exceeds canonical part bound');
      const coordinator = rows.find((row) => row.partIndex === 0);
      if (coordinator?.frameState === 'SEALED') return { frames: 0, parts: 0 };
      const [clock] = await manager.query<Array<{ now: Date }>>('SELECT clock_timestamp() AS now');
      const now = clock?.now;
      if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
        throw new Error('Pending recovery clock is unavailable');
      const due = rows.some(
        (row) =>
          ['PART_STAGED', 'PENDING_PARTS', 'PENDING_PREDECESSOR'].includes(row.frameState) &&
          row.pendingUntil <= now,
      );
      if (!due) return { frames: 0, parts: 0 };
      if (
        coordinator &&
        ['PENDING_PARTS', 'PENDING_PREDECESSOR'].includes(coordinator.frameState)
      ) {
        const result = {
          reason:
            coordinator.frameState === 'PENDING_PREDECESSOR'
              ? 'PREDECESSOR_EXPIRED'
              : 'PARTS_EXPIRED',
          terminalizedAt: now.toISOString(),
          trigger: 'DEADLINE_RECOVERY',
        };
        await manager.query(
          `UPDATE ai_observation_event SET tracking_frame_state='REVIEW_ONLY',tracking_frame_result=$2 WHERE event_id=$1`,
          [coordinator.eventId, result],
        );
      }
      const [changed] = await manager.query<Array<{ n: number }>>(
        `WITH expired AS (UPDATE ai_observation_event SET tracking_frame_state='PART_EXPIRED'
        WHERE resolved_camera_id=$1 AND tracking_generation_id=$2 AND stream_session_id=$3 AND tracking_frame_id=$4
          AND tracking_frame_state='PART_STAGED' RETURNING event_id) SELECT count(*)::int AS n FROM expired`,
        [...sourceKey, candidate.frameId],
      );
      if (!changed || !Number.isSafeInteger(changed.n) || changed.n < 0)
        throw new Error('Pending recovery row count is unavailable');
      return { frames: 1, parts: changed.n };
    });
    expiredFrames += result.frames;
    expiredParts += result.parts;
  }
  return { candidateRows: candidates.length, expiredFrames, expiredParts };
}
