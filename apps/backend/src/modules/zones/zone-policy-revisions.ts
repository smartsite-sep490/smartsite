import type { EntityManager } from 'typeorm';
import { conflict } from '../../common/configuration/commands.js';
import type { ZoneEntity } from '../../database/entities/zone.entity.js';
import { ZonePolicyRevisionEntity } from '../../database/entities/zone-policy-revision.entity.js';

/** Caller owns the Zone row lock, or the uncommitted new Zone, in this transaction. */
export async function appendZonePolicyRevision(
  manager: EntityManager,
  zone: ZoneEntity,
  isNew = false,
): Promise<void> {
  const repository = manager.getRepository(ZonePolicyRevisionEntity);
  const latest = await repository.findOne({
    where: { zoneId: zone.id, siteId: zone.siteId },
    order: { policyRevision: 'DESC' },
  });
  if (isNew ? latest !== null : latest === null) conflict('Zone policy history is unavailable');
  const next = BigInt(latest?.policyRevision ?? '0') + 1n;
  if (next > BigInt(Number.MAX_SAFE_INTEGER)) conflict('Zone policy revision limit reached');
  await repository.insert({
    zoneId: zone.id,
    siteId: zone.siteId,
    policyRevision: next.toString(),
    zoneType: zone.type,
    restrictionPolicy: zone.restrictionPolicy,
    requiredPpe: [...zone.requiredPpe].sort(),
    isCutoverBaseline: false,
  });
}
