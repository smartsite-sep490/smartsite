/** Recorded batch attribution takes priority; legacy membership must be unambiguous at shift start. */
export const CONTRACTOR_TEAM_ATTENDANCE_QUERY = `
WITH roster AS (
  SELECT s.id AS "scheduleId", w.id AS "workerId", w.display_name AS "displayName",
    COALESCE(a.status, 'NOT_YET') AS status, z.name AS "zoneName", a.updated_at AS "updatedAt", d.id AS "dayId",
    EXISTS(SELECT 1 FROM attendance_event e WHERE e.shift_assignment_id=s.id AND e.site_id=$1 AND e.worker_id=w.id AND e.kind='CHECK_IN' AND e.gate_event_id IS NOT NULL) AS entered
  FROM worker_schedule s JOIN worker w ON w.id=s.worker_id AND w.site_id=s.site_id AND w.contractor_id=$2
  LEFT JOIN LATERAL (
    SELECT b.input->>'teamId' AS "teamId" FROM schedule_assignment_batch b
    WHERE b.site_id=$1 AND b.contractor_id=$2 AND b.input->>'target'='TEAM' AND b.schedule_ids ? s.id::text
    ORDER BY b.created_at DESC,b.id DESC LIMIT 1
  ) recorded ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS count,(array_agg(tm.team_id ORDER BY tm.id))[1] AS "teamId"
    FROM contractor_team_membership tm JOIN contractor_team t ON t.id=tm.team_id AND t.site_id=tm.site_id AND t.contractor_id=tm.contractor_id
    WHERE tm.worker_id=w.id AND tm.site_id=$1 AND tm.contractor_id=$2 AND tm.joined_at<=$7 AND (tm.left_at IS NULL OR tm.left_at>$7)
  ) historical ON true
  LEFT JOIN team_attendance a ON a.schedule_id=s.id AND a.team_id=$3
  LEFT JOIN zone z ON z.id=a.zone_id AND z.site_id=$1
  LEFT JOIN attendance_day d ON d.schedule_id=s.id AND d.site_id=$1 AND d.worker_id=w.id
  WHERE s.site_id=$1 AND s.work_date=$4::date AND s.shift_id=$5 AND s.schedule_version_id=$6 AND s.is_active
    AND COALESCE(recorded."teamId",CASE WHEN historical.count=1 THEN historical."teamId"::text END)=$3::text
), compared AS (
  SELECT *, CASE WHEN status='PRESENT' THEN CASE WHEN entered THEN 'MATCHED' ELSE 'NO_GATE_ENTRY' END
    ELSE CASE WHEN entered THEN 'GATE_ONLY' ELSE 'NOT_YET' END END AS "gateCheck" FROM roster
)
SELECT count(*)::int AS total,
  count(*) FILTER(WHERE status='PRESENT')::int AS present,
  count(*) FILTER(WHERE status='ABSENT')::int AS absent,
  count(*) FILTER(WHERE status='NOT_YET')::int AS pending,
  count(*) FILTER(WHERE "gateCheck"='MATCHED')::int AS matched,
  COALESCE((SELECT jsonb_agg(page) FROM (
    SELECT "scheduleId","workerId","displayName",status,"zoneName","updatedAt","dayId","gateCheck"
    FROM compared ORDER BY "displayName","workerId","scheduleId" OFFSET $8 LIMIT $9
  ) page),'[]'::jsonb) AS items FROM compared`;
