import { AUTHORITY_RELATIONS_WITH_HISTORY } from './authority-storage-relations.js';
import type { EntityManager } from 'typeorm';
import { PublicHttpException } from '../http/public-http-exception.js';

/** Raw legacy entrypoints have no authenticated command attribution. Never use
 * them once any part of the Main authority journal exists in this schema. */
export async function refuseLegacyMainWriter(manager: EntityManager): Promise<void> {
  const rows = await manager.query(
    `SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname=current_schema() AND c.relkind='r' AND c.relname=ANY($1::text[]) LIMIT 1`,
    [AUTHORITY_RELATIONS_WITH_HISTORY],
  );
  if (rows.length) {
    throw new PublicHttpException(503, {
      code: 'SERVICE_UNAVAILABLE',
      message: 'Use the authenticated Main configuration command',
    });
  }
}
