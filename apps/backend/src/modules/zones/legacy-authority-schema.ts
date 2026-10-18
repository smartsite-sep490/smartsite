import { AUTHORITY_RELATIONS_WITH_HISTORY } from '../../common/configuration/authority-storage-relations.js';
import type { EntityManager } from 'typeorm';
import { PublicHttpException } from '../../common/http/public-http-exception.js';

/** Old branch writers cannot supply the original bearer command used by MAIN.
 * Refuse them inside their transaction, including partially installed journals.
 * Current public routes use the retained-main commands instead. This check is
 * schema compatibility, not complete writer coverage or a cutover certificate.
 */
export async function requireLegacyAuthoritySchema(manager: EntityManager): Promise<void> {
  const rows: unknown[] = await manager.query(
    `SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=current_schema() AND c.relname=ANY($1::text[]) LIMIT 1`,
    [AUTHORITY_RELATIONS_WITH_HISTORY],
  );
  if (rows.length)
    throw new PublicHttpException(503, {
      code: 'SERVICE_UNAVAILABLE',
      message: 'Legacy authority operations are unavailable',
    });
}
