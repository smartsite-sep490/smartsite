import type { EntityManager } from 'typeorm';
import { PublicHttpException } from '../http/public-http-exception.js';

/** Raw legacy entrypoints have no authenticated command attribution. Never use
 * them once any part of the Main authority journal exists in this schema. */
export async function refuseLegacyMainWriter(manager: EntityManager): Promise<void> {
  const rows = await manager.query(
    `SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname=current_schema() AND c.relkind='r' AND c.relname=ANY($1::text[]) LIMIT 1`,
    [
      [
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
      ],
    ],
  );
  if (rows.length) {
    throw new PublicHttpException(503, {
      code: 'SERVICE_UNAVAILABLE',
      message: 'Use the authenticated Main configuration command',
    });
  }
}
