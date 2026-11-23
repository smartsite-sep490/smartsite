import { createHash } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import {
  AccessAuditEntity,
  AbsenceRequestEntity,
  AbsenceRequestStatus,
  AttendanceDayEntity,
  AttendanceSessionEntity,
  OvertimeRequestEntity,
  TeamAttendanceEntity,
  WorkerScheduleEntity,
} from '../../../database/entities/index.js';

export const ZONE_HOURS_REVIEW_ACTION = 'ATTENDANCE_ZONE_HOURS_CONFIRMED';
const reviewableIssues = new Set([
  'ZONE_ATTENDANCE_PENDING',
  'ZONE_ATTENDANCE_REVIEW_CONFLICT',
  'EARLY_CHECKOUT',
  'EXIT_DURATION_EXCEEDED',
  'MAX_EXITS_EXCEEDED',
]);

/** A review approves calculated Gate-backed hours, never a fabricated Zone roll call. */
export async function attendanceZoneReviewContext(
  manager: EntityManager,
  day: AttendanceDayEntity,
  now = new Date(),
) {
  const requirement = day.zoneAttendanceRequirement;
  if (!day.scheduleId || !day.startsAt || !day.endsAt || !requirement?.required) return null;
  const record = await manager
    .getRepository(TeamAttendanceEntity)
    .findOneBy({ scheduleId: day.scheduleId });
  if (record && !day.zoneAttendanceReviewAuditId) return null;
  const [schedule, sessions, overtime, leaves, decision] = await Promise.all([
    manager
      .getRepository(WorkerScheduleEntity)
      .findOneBy({ id: day.scheduleId, siteId: day.siteId, workerId: day.workerId }),
    manager
      .getRepository(AttendanceSessionEntity)
      .find({ where: { dayId: day.id }, order: { id: 'ASC' } }),
    manager
      .getRepository(OvertimeRequestEntity)
      .find({ where: { scheduleId: day.scheduleId, status: 'APPROVED' }, order: { id: 'ASC' } }),
    manager.getRepository(AbsenceRequestEntity).find({
      where: { workerScheduleId: day.scheduleId, status: AbsenceRequestStatus.APPROVED },
      order: { id: 'ASC' },
    }),
    day.zoneAttendanceReviewAuditId
      ? manager.getRepository(AccessAuditEntity).findOneBy({ id: day.zoneAttendanceReviewAuditId })
      : Promise.resolve(null),
  ]);
  if (
    day.zoneAttendanceReviewAuditId &&
    (!decision ||
      decision.action !== ZONE_HOURS_REVIEW_ACTION ||
      decision.entityType !== 'attendance_zone_review' ||
      decision.siteId !== day.siteId ||
      decision.changes?.dayId !== day.id ||
      !decision.actorAccountId ||
      !decision.reason)
  )
    throw new Error('Attendance review history unavailable');
  const requiredEnd = new Date(Math.max(+day.endsAt, ...overtime.map((value) => +value.endsAt)));
  if (!Number.isFinite(+requiredEnd)) throw new Error('Attendance schedule unavailable');
  const bounds = [
    day.siteId,
    day.workerId,
    day.workDate,
    day.timezone,
    day.startsAt,
    requiredEnd,
    day.scheduleId,
  ];
  const [gates, events] = await Promise.all([
    manager.query<{ id: string; direction: string; occurredAt: Date }[]>(
      `SELECT g.id,g.direction,g.occurred_at AS "occurredAt" FROM gate_event g
       WHERE g.site_id=$1 AND g.worker_id=$2 AND (
         EXISTS(SELECT 1 FROM attendance_event e WHERE e.gate_event_id=g.id AND e.site_id=g.site_id AND e.worker_id=g.worker_id AND e.shift_assignment_id=$7)
         OR (((g.occurred_at AT TIME ZONE $4)::date=$3::date OR g.occurred_at BETWEEN $5 AND $6)
           AND NOT EXISTS(SELECT 1 FROM attendance_event e WHERE e.gate_event_id=g.id AND e.site_id=g.site_id AND e.worker_id=g.worker_id AND e.shift_assignment_id IS NOT NULL AND e.shift_assignment_id<>$7))
       ) ORDER BY g.id`,
      bounds,
    ),
    manager.query<
      {
        id: string;
        kind: string;
        gateEventId: string | null;
        occurredAt: Date;
        scheduleId: string | null;
      }[]
    >(
      `SELECT id,kind,gate_event_id AS "gateEventId",occurred_at AS "occurredAt",shift_assignment_id AS "scheduleId" FROM attendance_event WHERE site_id=$1 AND worker_id=$2 AND (shift_assignment_id=$7 OR (shift_assignment_id IS NULL AND ((occurred_at AT TIME ZONE $4)::date=$3::date OR occurred_at BETWEEN $5 AND $6))) ORDER BY id`,
      bounds,
    ),
  ]);
  const gateMap = new Map(gates.map((value) => [value.id, value]));
  const eventMap = new Map(events.map((value) => [value.id, value]));
  const usedEvents = new Set(
    sessions.flatMap((value) => [value.checkInEventId, value.checkOutEventId]).filter(Boolean),
  );
  const working = sessions.filter((value) => value.status !== 'IGNORED');
  const gateInCount = gates.filter((value) => value.direction === 'IN').length;
  const gateOutCount = gates.filter((value) => value.direction === 'OUT').length;
  const complete =
    gateInCount > 0 &&
    gateOutCount > 0 &&
    working.length > 0 &&
    gates.every((value) => events.some((event) => event.gateEventId === value.id)) &&
    events.every((value) => {
      const gate = value.gateEventId ? gateMap.get(value.gateEventId) : null;
      return (
        gate &&
        value.scheduleId === day.scheduleId &&
        usedEvents.has(value.id) &&
        +gate.occurredAt === +value.occurredAt &&
        +gate.occurredAt <= +now &&
        gate.direction === (value.kind === 'CHECK_IN' ? 'IN' : 'OUT')
      );
    }) &&
    working.every((value) => {
      const entry = value.checkInEventId ? eventMap.get(value.checkInEventId) : null;
      const exit = value.checkOutEventId ? eventMap.get(value.checkOutEventId) : null;
      return (
        (value.status === 'MATCHED' ||
          (value.status === 'CORRECTED' && !!value.appliedCorrectionId)) &&
        value.siteId === day.siteId &&
        value.workerId === day.workerId &&
        value.shiftAssignmentId === day.scheduleId &&
        entry?.kind === 'CHECK_IN' &&
        exit?.kind === 'CHECK_OUT' &&
        +exit.occurredAt >= +entry.occurredAt &&
        value.effectiveInAt &&
        value.effectiveOutAt &&
        +value.effectiveOutAt >= +value.effectiveInAt &&
        +value.effectiveOutAt <= +now
      );
    });
  const evidence = {
    dayId: day.id,
    siteId: day.siteId,
    workerId: day.workerId,
    workDate: day.workDate,
    timezone: day.timezone,
    requirement: {
      version: requirement.version,
      required: requirement.required,
      teamId: requirement.teamId,
      membershipId: requirement.membershipId,
      zoneId: requirement.zoneId,
    },
    startsAt: day.startsAt,
    endsAt: day.endsAt,
    breakStartsAt: day.breakStartsAt,
    breakEndsAt: day.breakEndsAt,
    allowedExitMinutes: day.allowedExitMinutes,
    maxExitCount: day.maxExitCount,
    regularMinutes: day.regularMinutes,
    overtimeMinutes: day.overtimeMinutes,
    schedule: schedule
      ? {
          id: schedule.id,
          shiftId: schedule.shiftId,
          versionId: schedule.scheduleVersionId,
          workDate: schedule.workDate,
          isActive: schedule.isActive,
        }
      : null,
    gates,
    events,
    sessions: sessions.map((value) => ({
      id: value.id,
      version: value.version,
      status: value.status,
      checkInEventId: value.checkInEventId,
      checkOutEventId: value.checkOutEventId,
      effectiveInAt: value.effectiveInAt,
      effectiveOutAt: value.effectiveOutAt,
      appliedCorrectionId: value.appliedCorrectionId,
    })),
    overtime: overtime.map((value) => ({
      id: value.id,
      startsAt: value.startsAt,
      endsAt: value.endsAt,
    })),
    leaves: leaves.map((value) => ({
      id: value.id,
      startsAt: value.startsAt,
      endsAt: value.endsAt,
    })),
  };
  const evidenceHash = createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
  const matches =
    !!schedule?.isActive &&
    schedule.workDate === day.workDate &&
    !!requirement.teamId &&
    !!requirement.zoneId &&
    !!requirement.membershipId;
  const validDecision =
    !!decision &&
    decision.changes?.evidenceHash === evidenceHash &&
    decision.changes.teamId === requirement.teamId &&
    decision.changes.membershipId === requirement.membershipId &&
    decision.changes.zoneId === requirement.zoneId;
  return {
    record,
    decision,
    evidence,
    evidenceHash,
    requiredEnd,
    matches,
    complete,
    gateInCount,
    gateOutCount,
    sessionCount: working.length,
    resolved: !record && matches && complete && validDecision,
    conflicted:
      !!decision &&
      record?.status !== 'PRESENT' &&
      (!validDecision || !complete || record?.status === 'ABSENT'),
  };
}

export function canConfirmZoneHours(
  day: AttendanceDayEntity,
  context: Awaited<ReturnType<typeof attendanceZoneReviewContext>>,
  now: Date,
) {
  return (
    !!context &&
    !context.record &&
    context.matches &&
    context.complete &&
    !context.resolved &&
    now >= context.requiredEnd &&
    day.status === 'NEEDS_REVIEW' &&
    day.anomalies.includes('ZONE_ATTENDANCE_PENDING') &&
    day.anomalies.every((issue) => reviewableIssues.has(issue))
  );
}
