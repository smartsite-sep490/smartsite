import type { EntityManager } from 'typeorm';
import type { GateAuthorizationDecision } from './gate-authorization-policy.js';
import { IsNull } from 'typeorm';
import {
  ContractorEntity,
  ContractorSiteParticipationEntity,
  WorkerSiteZoneAssignmentEntity,
  WorkerSiteZoneAssignmentStatus,
  WorkerEntity,
  WorkerGatePermissionEntity,
  WorkerScheduleEntity,
  ShiftEntity,
  OvertimeRequestEntity,
} from '../../../database/entities/index.js';
import { scheduledShiftWindow, workDateAt } from '../attendance/attendance-calculation.js';

/** QR and Face establish identity; both use the same persisted Site authorization. */
export async function evaluateWorkerAccess(
  manager: EntityManager,
  worker: WorkerEntity,
  siteId: string,
  gateId: string,
  direction: 'IN' | 'OUT',
  at = new Date(),
  lock = false,
) {
  const assignments = await manager.getRepository(WorkerSiteZoneAssignmentEntity).find({
    where: { workerId: worker.id, siteId },
    order: { validFrom: 'DESC', id: 'ASC' },
    ...(lock ? { lock: { mode: 'pessimistic_read' as const } } : {}),
  });
  const assignment =
    assignments.find(
      (a) =>
        a.status === WorkerSiteZoneAssignmentStatus.APPROVED &&
        a.validFrom <= at &&
        a.validUntil &&
        a.validUntil > at,
    ) ?? null;
  const schedules = await manager.getRepository(WorkerScheduleEntity).find({
    where: { workerId: worker.id, siteId, isActive: true },
    ...(lock ? { lock: { mode: 'pessimistic_read' as const } } : {}),
  });
  const shifts = await Promise.all(
    schedules.map((s) =>
      manager.getRepository(ShiftEntity).findOne({
        where: { id: s.shiftId, siteId },
        ...(lock ? { lock: { mode: 'pessimistic_read' as const } } : {}),
      }),
    ),
  );
  let scheduleDataUnavailable = false;
  const assignedToday = shifts.some((shift, index) => {
    if (!shift || !schedules[index]) {
      scheduleDataUnavailable = true;
      return false;
    }
    try {
      scheduledShiftWindow(shift, schedules[index].workDate);
      return schedules[index].workDate === workDateAt(at, shift.timezone);
    } catch {
      scheduleDataUnavailable = true;
      return false;
    }
  });
  const scheduled =
    shifts.some((shift, index) => {
      if (!shift || !schedules[index]) return false;
      try {
        const window = scheduledShiftWindow(shift, schedules[index].workDate);
        return window.startsAt <= at && window.endsAt > at;
      } catch {
        return false;
      }
    }) ||
    (direction === 'IN' &&
      (await manager
        .getRepository(OvertimeRequestEntity)
        .createQueryBuilder('r')
        .innerJoin(
          WorkerScheduleEntity,
          's',
          's.id=r.schedule_id AND s.is_active=true AND s.shift_id=r.expected_shift_id',
        )
        .where(
          "r.site_id=:siteId AND r.worker_id=:workerId AND r.status='APPROVED' AND r.starts_at<=:at AND r.ends_at>:at",
          { siteId, workerId: worker.id, at },
        )
        .getExists()));
  const scheduleStatus =
    direction === 'OUT'
      ? ('NOT_APPLICABLE' as const)
      : scheduled
        ? ('SCHEDULED' as const)
        : assignedToday
          ? ('OUTSIDE_SHIFT' as const)
          : ('NO_SCHEDULE' as const);
  // A trusted identity may always record departure, including after revocation or expiry.
  if (direction === 'OUT')
    return {
      assignment,
      scheduleStatus,
      decision: {
        authorization: 'ALLOWED',
        reasonCode: 'EXIT_RECORD_ONLY',
      } as GateAuthorizationDecision,
    };
  let reason: GateAuthorizationDecision['reasonCode'] | null = null;
  if (!worker.isActive) reason = 'WORKER_INACTIVE';
  else if (worker.siteId !== siteId) reason = 'SITE_MISMATCH';
  else if (!assignment) reason = 'ASSIGNMENT_MISSING';
  else if (!assignment.siteContractorId) reason = 'CONTRACTOR_SITE_PARTICIPATION_INVALID';
  else {
    const participation = await manager.getRepository(ContractorSiteParticipationEntity).findOne({
      where: { id: assignment.siteContractorId, siteId },
      ...(lock ? { lock: { mode: 'pessimistic_read' as const } } : {}),
    });
    const contractor = worker.contractorId
      ? await manager.getRepository(ContractorEntity).findOne({
          where: { id: worker.contractorId },
          ...(lock ? { lock: { mode: 'pessimistic_read' as const } } : {}),
        })
      : null;
    if (!contractor?.isActive) reason = 'CONTRACTOR_INACTIVE';
    else if (
      !participation?.isActive ||
      participation.contractorId !== worker.contractorId ||
      participation.validFrom > at ||
      (participation.validUntil && participation.validUntil <= at) ||
      participation.validFrom > assignment.validFrom ||
      (participation.validUntil && participation.validUntil < assignment.validUntil!)
    )
      reason = 'CONTRACTOR_SITE_PARTICIPATION_INVALID';
    else if (assignment.gateId && assignment.gateId !== gateId) reason = 'GATE_MISMATCH';
    else {
      const gates = await manager
        .getRepository(WorkerGatePermissionEntity)
        .findBy({ workerId: worker.id, siteId, gateId, revokedAt: IsNull() });
      if (
        !gates.some(
          (g) =>
            g.workerAssignmentId === assignment.id &&
            g.validFrom <= at &&
            (!g.validUntil || g.validUntil > at),
        )
      )
        reason = 'GATE_MISMATCH';
    }
  }
  if (!reason && scheduleStatus === 'NO_SCHEDULE')
    reason = scheduleDataUnavailable ? 'AUTHORIZATION_DATA_UNAVAILABLE' : 'NO_SCHEDULE';
  return {
    assignment,
    scheduleStatus,
    decision: {
      authorization:
        reason === 'AUTHORIZATION_DATA_UNAVAILABLE'
          ? 'MANUAL_REVIEW'
          : reason
            ? 'DENIED'
            : 'ALLOWED',
      reasonCode: reason ?? 'VALID_ASSIGNMENT',
    } as GateAuthorizationDecision,
  };
}
