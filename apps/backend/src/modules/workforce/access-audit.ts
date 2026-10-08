import { randomUUID } from 'node:crypto';
import type { EntityManager } from 'typeorm';
import { AccessAuditEntity } from '../../database/entities/access-audit.entity.js';
/** Callers supply only explicit business fields; never accept an arbitrary command body. */
export async function auditAccess(
  manager: EntityManager,
  actorId: string | null,
  siteId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  reason: string | null,
  changes: Record<string, unknown>,
) {
  if (
    siteId &&
    [
      'WORKER_ASSIGNMENT_REVIEWED',
      'WORKER_ASSIGNMENT_REVOKED',
      'GATE_PERMISSIONS_CHANGED',
      'CONTRACTOR_ZONE_GRANTED',
      'WORKER_ZONE_GRANTED',
      'ZONE_PERMISSION_REVOKED',
    ].includes(action)
  ) {
    await manager.query(
      'UPDATE site SET access_policy_version = access_policy_version + 1 WHERE id=$1',
      [siteId],
    );
  }
  await manager.getRepository(AccessAuditEntity).save({
    id: randomUUID(),
    actorAccountId: actorId,
    siteId,
    action,
    entityType,
    entityId,
    reason,
    changes,
    occurredAt: new Date(),
  });
}
