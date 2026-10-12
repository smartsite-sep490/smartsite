import { IsNull, type EntityManager } from 'typeorm';
import {
  ContractorTeamEntity,
  ContractorTeamMembershipEntity,
  WorkerEntity,
  ShiftEntity,
  WorkerScheduleEntity,
  ContractorShiftAssignmentEntity,
} from '../../database/entities/index.js';
import { scheduledShiftWindow } from './attendance-calculation.js';
export function oppositeShiftWindows(
  a: { startsAt: Date; endsAt: Date },
  b: { startsAt: Date; endsAt: Date },
) {
  return (
    Number.isFinite(+a.startsAt) &&
    Number.isFinite(+a.endsAt) &&
    Number.isFinite(+b.startsAt) &&
    Number.isFinite(+b.endsAt) &&
    a.endsAt > a.startsAt &&
    b.endsAt > b.startsAt &&
    (+a.endsAt <= +b.startsAt || +b.endsAt <= +a.startsAt)
  );
}
export async function teamSwapEligibility(
  m: EntityManager,
  a: WorkerScheduleEntity,
  b: WorkerScheduleEntity,
  lock = false,
) {
  if (
    !a.isActive ||
    !b.isActive ||
    a.workerId === b.workerId ||
    a.siteId !== b.siteId ||
    a.workDate !== b.workDate ||
    a.scheduleVersionId !== b.scheduleVersionId ||
    a.shiftId === b.shiftId
  )
    return null;
  const workers: WorkerEntity[] = [];
  for (const id of [a.workerId, b.workerId].sort()) {
    const w = lock
      ? await m.getRepository(WorkerEntity).findOne({
          where: { id, siteId: a.siteId, isActive: true },
          lock: { mode: 'pessimistic_write' },
        })
      : await m.getRepository(WorkerEntity).findOneBy({ id, siteId: a.siteId, isActive: true });
    if (!w) return null;
    workers.push(w);
  }
  if (!workers[0]!.contractorId || workers[0]!.contractorId !== workers[1]!.contractorId)
    return null;
  const contractorId = workers[0]!.contractorId;
  const am = await m
    .getRepository(ContractorTeamMembershipEntity)
    .findOneBy({ workerId: a.workerId, siteId: a.siteId, contractorId, leftAt: IsNull() });
  const bm = await m
    .getRepository(ContractorTeamMembershipEntity)
    .findOneBy({ workerId: b.workerId, siteId: b.siteId, contractorId, leftAt: IsNull() });
  if (!am || !bm || am.teamId !== bm.teamId) return null;
  const team = lock
    ? await m.getRepository(ContractorTeamEntity).findOne({
        where: { id: am.teamId, siteId: a.siteId, contractorId, isActive: true },
        lock: { mode: 'pessimistic_read' },
      })
    : await m
        .getRepository(ContractorTeamEntity)
        .findOneBy({ id: am.teamId, siteId: a.siteId, contractorId, isActive: true });
  if (!team) return null;
  if (
    !(await m
      .getRepository(ContractorShiftAssignmentEntity)
      .existsBy({ siteId: a.siteId, contractorId, shiftId: a.shiftId })) ||
    !(await m
      .getRepository(ContractorShiftAssignmentEntity)
      .existsBy({ siteId: b.siteId, contractorId, shiftId: b.shiftId }))
  )
    return null;
  const sa = await m.getRepository(ShiftEntity).findOneBy({ id: a.shiftId, siteId: a.siteId });
  const sb = await m.getRepository(ShiftEntity).findOneBy({ id: b.shiftId, siteId: b.siteId });
  if (!sa || !sb) return null;
  try {
    if (
      !oppositeShiftWindows(
        scheduledShiftWindow(sa, a.workDate),
        scheduledShiftWindow(sb, b.workDate),
      )
    )
      return null;
  } catch {
    return null;
  }
  return { teamId: team.id, requesterMembershipId: am.id, coworkerMembershipId: bm.id };
}
