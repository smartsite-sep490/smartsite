import type { EntityManager } from 'typeorm';
import { PublicHttpException } from '../../common/http/public-http-exception.js';

const mainJournalRelations = [
  'mf06_authority_source',
  'mf06_authority_command',
  'mf06_authority_epoch',
  'mf06_authority_control',
  'mf06_authority_head',
  'mf06_authority_fact',
  'mf06_authority_gap',
  'mf06_authority_commit_witness',
  'mf06_authority_baseline',
  'mf06_assignment_command_result',
  'mf06_participation_command_result',
  'mf06_zone_permission_command_result',
  'mf06_zone_deny_command_result',
];

/** Old branch writers cannot supply the original bearer command used by MAIN.
 * Refuse them inside their transaction, including partially installed journals.
 * Current public routes use the retained-main commands instead. This check is
 * schema compatibility, not complete writer coverage or a cutover certificate.
 */
export async function requireLegacyAuthoritySchema(manager: EntityManager): Promise<void> {
  const rows: unknown[] = await manager.query(
    `SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=current_schema() AND c.relname=ANY($1::text[]) LIMIT 1`,
    [mainJournalRelations],
  );
  if (rows.length)
    throw new PublicHttpException(503, {
      code: 'SERVICE_UNAVAILABLE',
      message: 'Legacy authority operations are unavailable',
    });
}
