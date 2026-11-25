import type { EntityManager } from 'typeorm';
import {
  AttendanceAbsenceReviewEntity,
  AttendanceDayEntity,
  TeamAttendanceEntity,
} from '../../../database/entities/index.js';

/** A rejected report's empty placeholder preserves history, but attests to no worked interval. */
export async function rejectedEmptyReportSessionIds(manager: EntityManager, dayId: string) {
  const rows = await manager.query<{ id: string }[]>(
    `
    SELECT s.id FROM attendance_session s
    WHERE s.day_id=$1 AND s.status='MISSING_IN'
      AND s.check_in_event_id IS NULL AND s.check_out_event_id IS NULL
      AND s.effective_in_at IS NULL AND s.effective_out_at IS NULL
      AND s.applied_correction_id IS NULL
      AND EXISTS(SELECT 1 FROM attendance_correction c WHERE c.attendance_session_id=s.id
        AND c.status='REJECTED' AND c.reviewed_by IS NOT NULL AND c.reviewed_at IS NOT NULL AND c.reviewed_by<>c.requested_by)
      AND NOT EXISTS(SELECT 1 FROM attendance_correction c WHERE c.attendance_session_id=s.id
        AND (c.status<>'REJECTED' OR c.reviewed_by IS NULL OR c.reviewed_at IS NULL OR c.reviewed_by=c.requested_by))`,
    [dayId],
  );
  return new Set(rows.map((row) => row.id));
}

/** Read immutable Gate evidence as well as attendance, so a missing projection cannot authorize absence. */
export async function attendanceGateAbsenceContext(
  manager: EntityManager,
  day: AttendanceDayEntity,
) {
  if (!day.scheduleId || !day.startsAt || !day.endsAt || !day.zoneAttendanceRequirement?.required)
    return null;
  const [record, decision] = await Promise.all([
    manager.getRepository(TeamAttendanceEntity).findOneBy({ scheduleId: day.scheduleId }),
    manager
      .getRepository(AttendanceAbsenceReviewEntity)
      .findOne({ where: { dayId: day.id }, order: { reviewedAt: 'DESC', id: 'DESC' } }),
  ]);
  if (record && record.status !== 'PRESENT' && !decision) return null;
  const [counts] = await manager.query<
    {
      gateEventCount: number;
      attendanceEventCount: number;
      sessionCount: number;
      requiredEnd: Date;
    }[]
  >(
    `
    WITH bounds AS (SELECT $3::date AS work_date,$4::text AS timezone,GREATEST($6::timestamptz, COALESCE((SELECT max(o.ends_at) FROM overtime_request o WHERE o.schedule_id=$7 AND o.status='APPROVED'),$6::timestamptz)) AS required_end)
    SELECT
      (SELECT count(*)::int FROM gate_event g WHERE g.site_id=$1 AND g.worker_id=$2
        AND (EXISTS(SELECT 1 FROM attendance_event e WHERE e.gate_event_id=g.id AND e.shift_assignment_id=$7)
          OR (g.occurred_at BETWEEN $5 AND (SELECT required_end FROM bounds)
            AND NOT EXISTS(SELECT 1 FROM attendance_event e WHERE e.gate_event_id=g.id AND e.shift_assignment_id IS NOT NULL AND e.shift_assignment_id<>$7)))) AS "gateEventCount",
      (SELECT count(*)::int FROM attendance_event e WHERE e.site_id=$1 AND e.worker_id=$2
        AND (e.shift_assignment_id=$7 OR (e.shift_assignment_id IS NULL AND e.occurred_at BETWEEN $5 AND (SELECT required_end FROM bounds)))) AS "attendanceEventCount",
      (SELECT count(*)::int FROM attendance_session s WHERE s.day_id=$8) AS "sessionCount",
      (SELECT required_end FROM bounds) AS "requiredEnd"`,
    [
      day.siteId,
      day.workerId,
      day.workDate,
      day.timezone,
      day.startsAt,
      day.endsAt,
      day.scheduleId,
      day.id,
    ],
  );
  if (
    !counts ||
    ![counts.gateEventCount, counts.attendanceEventCount, counts.sessionCount].every(
      (value) => Number.isInteger(value) && value >= 0,
    ) ||
    !(counts.requiredEnd instanceof Date) ||
    !Number.isFinite(+counts.requiredEnd)
  )
    throw new Error('Attendance evidence unavailable');
  const emptyRejectedReportCount =
    counts.sessionCount > 0 ? (await rejectedEmptyReportSessionIds(manager, day.id)).size : 0;
  const noEvidence =
    counts.gateEventCount === 0 &&
    counts.attendanceEventCount === 0 &&
    counts.sessionCount === emptyRejectedReportCount;
  const requirement = day.zoneAttendanceRequirement;
  const matches =
    !!requirement.teamId &&
    !!requirement.membershipId &&
    !!requirement.zoneId &&
    (!record ||
      (record.status === 'PRESENT' &&
        record.teamId === requirement.teamId &&
        record.membershipId === requirement.membershipId &&
        record.zoneId === requirement.zoneId));
  // Version zero explicitly snapshots the absence of leader roll call.
  const teamAttendanceVersion = record?.version ?? 0;
  const resolved =
    noEvidence &&
    matches &&
    !!decision &&
    decision.teamAttendanceVersion === teamAttendanceVersion &&
    decision.teamId === requirement.teamId &&
    decision.membershipId === requirement.membershipId &&
    decision.zoneId === requirement.zoneId;
  return {
    record,
    teamAttendanceVersion,
    decision,
    ...counts,
    emptyRejectedReportCount,
    noEvidence,
    matches,
    resolved,
    conflicted: !!decision && (!noEvidence || !resolved),
  };
}

export function canConfirmGateAbsence(
  day: AttendanceDayEntity,
  context: Awaited<ReturnType<typeof attendanceGateAbsenceContext>>,
  now: Date,
) {
  return (
    !!context?.matches &&
    context.noEvidence &&
    !context.resolved &&
    !context.conflicted &&
    now >= context.requiredEnd &&
    day.status === 'NEEDS_REVIEW' &&
    day.anomalies.includes(context.record ? 'ZONE_GATE_MISSING' : 'ZONE_ATTENDANCE_PENDING') &&
    day.anomalies.every(
      (issue) => issue === (context.record ? 'ZONE_GATE_MISSING' : 'ZONE_ATTENDANCE_PENDING'),
    )
  );
}
