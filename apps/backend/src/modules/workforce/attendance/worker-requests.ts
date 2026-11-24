import type { EntityManager } from 'typeorm';
import type {
  WorkerRequestsQuery,
  WorkerRequestsResponse,
  WorkerRequestResponse,
} from '@smartsite/contracts';
import { conflict } from '../../../common/configuration/commands.js';
import type { WorkerEntity } from '../../../database/entities/index.js';
import { coveredPendingLeaveSql } from '../shared/leave-display.js';

export const LEAVE_COOLDOWN_MESSAGE = 'A leave request can only be submitted once every 24 hours';

export async function workerLeaveAvailability(
  manager: EntityManager,
  worker: WorkerEntity,
  actorId: string,
) {
  const [row]: Array<{ serverTime: Date; leaveAvailableAt: Date | null; locked: boolean }> =
    await manager.query(
      `SELECT clock_timestamp() AS "serverTime", MAX(created_at) + interval '24 hours' AS "leaveAvailableAt",
      COALESCE(MAX(created_at) + interval '24 hours' > clock_timestamp(),false) AS locked
     FROM absence_request WHERE site_id=$1 AND worker_id=$2 AND requested_by_user_id=$3`,
      [worker.siteId, worker.id, actorId],
    );
  return row!;
}

/** Both leave command paths hold the Worker lock before checking this shared policy. */
export async function assertWorkerLeaveAvailable(
  manager: EntityManager,
  worker: WorkerEntity,
  actorId: string,
) {
  const row = await workerLeaveAvailability(manager, worker, actorId);
  if (row.locked) conflict(LEAVE_COOLDOWN_MESSAGE);
}

export async function workerRequests(
  manager: EntityManager,
  worker: WorkerEntity,
  actorId: string,
  query: WorkerRequestsQuery,
): Promise<WorkerRequestsResponse> {
  // Scope every branch before UNION; include inactive schedules so approved leave stays visible.
  const base = `WITH requests AS (
    SELECT a.id,'LEAVE' AS kind,a.status,a.reason,a.created_at,a.review_note,to_char(s.work_date,'YYYY-MM-DD') AS work_date,
      a.starts_at,a.ends_at,NULL::uuid AS day_id
    FROM absence_request a JOIN worker_schedule s ON s.id=a.worker_schedule_id AND s.site_id=a.site_id
    WHERE a.site_id=$1 AND a.worker_id=$2 AND a.requested_by_user_id=$3
      AND ($6::uuid IS NOT NULL OR NOT ${coveredPendingLeaveSql('a')})
    UNION ALL
    SELECT o.id,'OVERTIME',o.status,o.reason,o.created_at,o.review_note,to_char(s.work_date,'YYYY-MM-DD'),
      o.starts_at,o.ends_at,NULL::uuid
    FROM overtime_request o JOIN worker_schedule s ON s.id=o.schedule_id AND s.site_id=o.site_id
    WHERE o.site_id=$1 AND o.worker_id=$2 AND o.requested_by=$3
    UNION ALL
    SELECT c.id,'CHANGE',c.status,c.reason,c.created_at,c.review_reason,to_char(s.work_date,'YYYY-MM-DD'),
      NULL::timestamptz,NULL::timestamptz,NULL::uuid
    FROM shift_change_request c JOIN worker_schedule s ON s.id=c.worker_schedule_id AND s.site_id=c.site_id
    WHERE c.site_id=$1 AND c.worker_id=$2 AND c.requested_by_user_id=$3
    UNION ALL
    SELECT x.id,'SWAP',x.status,x.reason,x.created_at,x.review_reason,to_char(s.work_date,'YYYY-MM-DD'),
      NULL::timestamptz,NULL::timestamptz,NULL::uuid
    FROM shift_swap_request x JOIN worker_schedule s ON s.id=x.requester_worker_schedule_id AND s.site_id=x.site_id
    WHERE x.site_id=$1 AND x.requester_worker_id=$2 AND x.requested_by_user_id=$3
    UNION ALL
    SELECT c.id,'CORRECTION',c.status,c.reason,c.created_at,c.review_note,to_char(d.work_date,'YYYY-MM-DD'),
      c.proposed_in_at,c.proposed_out_at,s.day_id
    FROM attendance_correction c JOIN attendance_session s ON s.id=c.attendance_session_id
    LEFT JOIN attendance_day d ON d.id=s.day_id AND d.site_id=s.site_id
    WHERE s.site_id=$1 AND s.worker_id=$2 AND c.requested_by=$3
  ), filtered AS (SELECT * FROM requests
    WHERE ($4::text IS NULL OR kind=$4) AND ($5::text IS NULL OR
      CASE WHEN $5='PENDING' THEN status IN ('PENDING','PENDING_MANAGER','PENDING_COWORKER')
        WHEN $5='APPROVED' THEN status IN ('APPROVED','APPLIED') ELSE status=$5 END)
      AND ($6::uuid IS NULL OR id=$6))`;
  const params = [
    worker.siteId,
    worker.id,
    actorId,
    query.kind ?? null,
    query.status ?? null,
    query.requestId ?? null,
  ];
  const [count]: Array<{ total: number }> = await manager.query(
    `${base} SELECT count(*)::int AS total FROM filtered`,
    params,
  );
  const rows: Array<{
    id: string;
    kind: WorkerRequestResponse['kind'];
    status: string;
    reason: string;
    created_at: Date;
    review_note: string | null;
    work_date: string | null;
    starts_at: Date | null;
    ends_at: Date | null;
    day_id: string | null;
  }> = await manager.query(
    `${base} SELECT * FROM filtered ORDER BY created_at DESC,kind ASC,id ASC LIMIT $7 OFFSET $8`,
    [...params, query.limit ?? 20, query.offset ?? 0],
  );
  const availability = await workerLeaveAvailability(manager, worker, actorId);
  return {
    items: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      reason: r.reason,
      createdAt: r.created_at.toISOString(),
      reviewNote: r.review_note,
      workDate: r.work_date,
      startsAt: r.starts_at?.toISOString() ?? null,
      endsAt: r.ends_at?.toISOString() ?? null,
      dayId: r.day_id,
    })),
    total: count!.total,
    serverTime: availability.serverTime.toISOString(),
    leaveAvailableAt: availability.leaveAvailableAt?.toISOString() ?? null,
  };
}
