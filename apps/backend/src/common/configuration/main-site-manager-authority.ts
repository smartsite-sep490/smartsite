import type { EntityManager } from 'typeorm';
import { uuid } from './commands.js';
import { PublicHttpException } from '../http/public-http-exception.js';

/** Rechecks MAIN's exact-site manager write policy under the command transaction. */
export async function authorizeMainSiteManager(
  manager: EntityManager,
  actorValue: string,
  siteValue: string,
): Promise<void> {
  const actorId = uuid(actorValue).toLowerCase();
  const siteId = uuid(siteValue).toLowerCase();
  const roles = await manager.query(
    "SELECT id FROM user_role_assignment WHERE user_id=$1 AND role='SITE_MANAGER' AND site_id=$2 FOR SHARE",
    [actorId, siteId],
  );
  if (!roles.length)
    throw new PublicHttpException(403, {
      code: 'FORBIDDEN',
      message: 'Site Manager access to this site is required',
    });
}
