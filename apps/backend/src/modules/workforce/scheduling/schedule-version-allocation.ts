import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { ScheduleVersionEntity } from '../../../database/entities/schedule-version.entity.js';

export const automaticScheduleVersionStart = '1970-01-01T00:00:00.000Z';

export async function allocateScheduleVersion(
  manager: EntityManager,
  siteId: string,
  effectiveFrom: Date,
  effectiveUntil: Date | null,
  isAutomatic: boolean,
): Promise<ScheduleVersionEntity> {
  // Both the legacy and automatic paths allocate from the same per-site sequence.
  await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
    'schedule-version:' + siteId.toLowerCase(),
  ]);
  const versions = manager.getRepository(ScheduleVersionEntity);
  if (isAutomatic) {
    const existing = await versions.findOneBy({ siteId, isAutomatic: true });
    if (existing) return existing;
  }
  const latest = await versions.findOne({ where: { siteId }, order: { version: 'DESC' } });
  return versions.save({
    id: randomUUID(),
    siteId,
    version: (latest?.version ?? 0) + 1,
    effectiveFrom,
    effectiveUntil,
    isAutomatic,
  });
}
