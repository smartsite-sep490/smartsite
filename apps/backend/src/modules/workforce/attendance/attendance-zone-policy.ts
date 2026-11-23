import type { EntityManager } from 'typeorm';
import type {
  AttendanceDayEntity,
  AttendanceZoneRequirement,
} from '../../../database/entities/attendance-day.entity.js';

export function zoneAttendanceIssue(
  requirement: AttendanceZoneRequirement | null,
  record: {
    teamId: string;
    zoneId: string;
    membershipId: string;
    status: string;
  } | null,
  entered: boolean,
): string | null {
  if (!requirement?.required) return null;
  if (!requirement.zoneId || !requirement.teamId || !requirement.membershipId)
    return 'ZONE_ATTENDANCE_PENDING';
  if (!record) return 'ZONE_ATTENDANCE_PENDING';
  if (
    record.teamId !== requirement.teamId ||
    record.zoneId !== requirement.zoneId ||
    record.membershipId !== requirement.membershipId
  )
    return 'ZONE_ATTENDANCE_MISMATCH';
  if (record.status !== 'PRESENT') return 'ZONE_ATTENDANCE_ABSENT';
  return entered ? null : 'ZONE_GATE_MISSING';
}

/** Resolve incomplete attendance context from current membership; preserve complete historical snapshots. */
export async function attendanceZoneIssue(
  manager: EntityManager,
  day: AttendanceDayEntity,
  now: Date,
): Promise<string | null> {
  if (!day.scheduleId || !day.startsAt || now < day.startsAt) return null;
  if (!day.zoneAttendanceRequirement && day.status === 'CONFIRMED') return null;
  if (
    !day.zoneAttendanceRequirement ||
    (day.zoneAttendanceRequirement.required &&
      (!day.zoneAttendanceRequirement.zoneId ||
        !day.zoneAttendanceRequirement.membershipId ||
        !day.zoneAttendanceRequirement.teamId))
  ) {
    const [policy] = await manager.query<{ enforced: boolean }[]>(
      `SELECT EXISTS(SELECT 1 FROM team_attendance_policy WHERE id=true AND effective_from<=$1) AS enforced`,
      [day.startsAt],
    );
    if (!policy?.enforced) return null;
    const [assignment] = await manager.query<
      {
        teamId: string | null;
        membershipId: string | null;
        zoneId: string | null;
        required: boolean;
      }[]
    >(
      `
      WITH recorded AS (
        SELECT b.input->>'teamId' AS team_id FROM schedule_assignment_batch b JOIN worker w ON w.id=$3 AND w.site_id=$2 AND w.contractor_id=b.contractor_id
        WHERE b.site_id=$2 AND b.input->>'target'='TEAM' AND b.schedule_ids ? $1::text ORDER BY b.created_at DESC,b.id DESC LIMIT 1
      ), membership AS (
        SELECT tm.id,tm.team_id FROM contractor_team_membership tm JOIN worker w ON w.id=tm.worker_id AND w.site_id=tm.site_id AND w.contractor_id=tm.contractor_id
        WHERE tm.worker_id=$3 AND tm.site_id=$2 AND tm.joined_at<=$5 AND (tm.left_at IS NULL OR tm.left_at>$5)
      ), expected AS (
        SELECT COALESCE((SELECT team_id FROM recorded),CASE WHEN (SELECT count(*) FROM membership)=1 THEN (SELECT team_id::text FROM membership LIMIT 1) END) AS team_id,
        (EXISTS(SELECT 1 FROM recorded) OR EXISTS(SELECT 1 FROM membership)) AS required
      ), zones AS (
        SELECT DISTINCT z.id FROM expected e JOIN contractor_team t ON t.id::text=e.team_id AND t.site_id=$2
        JOIN team_zone_permission tp ON tp.team_id=t.id JOIN contractor_zone_permission cp ON cp.id=tp.contractor_zone_permission_id
        JOIN contractor_site_participation p ON p.id=cp.site_contractor_id AND p.site_id=$2 AND p.contractor_id=t.contractor_id
        JOIN zone z ON z.id=cp.zone_id AND z.site_id=$2
        WHERE tp.valid_from<=$4 AND tp.valid_until>$4 AND (tp.revoked_at IS NULL OR tp.revoked_at>$4)
          AND cp.valid_from<=$4 AND cp.valid_until>$4 AND (cp.revoked_at IS NULL OR cp.revoked_at>$4)
          AND p.valid_from<=$4 AND (p.valid_until IS NULL OR p.valid_until>$4) AND p.is_active
      ) SELECT team_id AS "teamId",required,
        (SELECT id FROM membership WHERE team_id::text=expected.team_id ORDER BY id LIMIT 1) AS "membershipId",
        CASE WHEN (SELECT count(*) FROM zones)=1 THEN (SELECT id FROM zones LIMIT 1) END AS "zoneId" FROM expected`,
      [day.scheduleId, day.siteId, day.workerId, day.startsAt, now],
    );
    if (
      assignment &&
      (!day.zoneAttendanceRequirement ||
        (assignment.teamId === day.zoneAttendanceRequirement.teamId &&
          (!day.zoneAttendanceRequirement.membershipId ||
            assignment.membershipId === day.zoneAttendanceRequirement.membershipId)))
    ) {
      day.zoneAttendanceRequirement = { version: 1, ...assignment };
    }
  }
  if (!day.zoneAttendanceRequirement?.required) return null;
  const [evidence] = await manager.query<
    {
      teamId: string | null;
      membershipId: string | null;
      zoneId: string | null;
      status: string | null;
      entered: boolean;
    }[]
  >(
    `
    SELECT a.team_id AS "teamId",a.membership_id AS "membershipId",a.zone_id AS "zoneId",a.status,
      (EXISTS(SELECT 1 FROM attendance_event e WHERE e.shift_assignment_id=$1 AND e.site_id=$2 AND e.worker_id=$3 AND e.kind='CHECK_IN' AND e.gate_event_id IS NOT NULL)
       OR EXISTS(SELECT 1 FROM attendance_session s JOIN attendance_correction c ON c.id=s.applied_correction_id AND c.attendance_session_id=s.id
         WHERE s.day_id=$4 AND s.shift_assignment_id=$1 AND s.site_id=$2 AND s.worker_id=$3
           AND s.status='CORRECTED' AND c.status='APPROVED' AND c.reviewed_by IS NOT NULL AND c.reviewed_by<>c.requested_by
           AND s.effective_in_at=c.proposed_in_at AND s.effective_out_at=c.proposed_out_at
           AND s.effective_out_at>s.effective_in_at AND s.effective_out_at<=$5)) AS entered
    FROM worker_schedule s LEFT JOIN team_attendance a ON a.schedule_id=s.id WHERE s.id=$1 AND s.site_id=$2 AND s.worker_id=$3`,
    [day.scheduleId, day.siteId, day.workerId, day.id, now],
  );
  return zoneAttendanceIssue(
    day.zoneAttendanceRequirement,
    evidence?.teamId && evidence.zoneId && evidence.membershipId && evidence.status
      ? {
          teamId: evidence.teamId,
          zoneId: evidence.zoneId,
          membershipId: evidence.membershipId,
          status: evidence.status,
        }
      : null,
    !!evidence?.entered,
  );
}
