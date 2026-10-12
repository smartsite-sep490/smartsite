import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';
import {
  ShiftEntity,
  ScheduleVersionEntity,
  WorkerScheduleEntity,
} from '../../src/database/entities/index.js';

/** A real assigned UTC workday for synthetic gate integration fixtures. */
export async function assignTestShift(
  source: DataSource,
  siteId: string,
  workerId: string,
  at = new Date(),
) {
  const workDate = at.toISOString().slice(0, 10);
  const startsAt = new Date(`${workDate}T00:00:00Z`);
  const endsAt = new Date(+startsAt + 86400000);
  const shift = await source.getRepository(ShiftEntity).save({
    id: randomUUID(),
    siteId,
    name: 'Synthetic assigned shift',
    startsAt,
    endsAt,
    timezone: 'UTC',
  });
  const version = await source
    .getRepository(ScheduleVersionEntity)
    .save({ id: randomUUID(), siteId, version: 1, effectiveFrom: startsAt });
  const schedule = await source.getRepository(WorkerScheduleEntity).save({
    id: randomUUID(),
    siteId,
    workerId,
    shiftId: shift.id,
    scheduleVersionId: version.id,
    workDate,
    isActive: true,
  });
  return schedule;
}
