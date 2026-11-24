import type { EntityManager } from 'typeorm';
import {
  AttendanceAbsenceReviewEntity,
  AttendanceDayEntity,
  TeamAttendanceEntity,
} from '../../../database/entities/index.js';

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
  if (record?.status !== 'PRESENT' && !decision) return null;
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
  const noEvidence =
    counts.gateEventCount === 0 && counts.attendanceEventCount === 0 && counts.sessionCount === 0;
  const requirement = day.zoneAttendanceRequirement;
  const matches =
    !!record &&
    record.status === 'PRESENT' &&
    record.teamId === requirement.teamId &&
    record.membershipId === requirement.membershipId &&
    record.zoneId === requirement.zoneId;
  const resolved =
    noEvidence &&
    matches &&
    !!decision &&
    decision.teamAttendanceVersion === record!.version &&
    decision.teamId === record!.teamId &&
    decision.membershipId === record!.membershipId &&
    decision.zoneId === record!.zoneId;
  return {
    record,
    decision,
    ...counts,
    noEvidence,
    matches,
    resolved,
    conflicted: !!decision && !noEvidence,
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
    day.anomalies.includes('ZONE_GATE_MISSING') &&
    day.anomalies.every((issue) => issue === 'ZONE_GATE_MISSING')
  );
}
