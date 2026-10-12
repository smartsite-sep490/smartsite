import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ContractorZoneRegrant1791940000001 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query('DROP INDEX uq_contractor_zone_interval');
    await runner.query(
      'CREATE UNIQUE INDEX uq_contractor_zone_interval ON contractor_zone_permission(site_contractor_id,zone_id,valid_from) WHERE revoked_at IS NULL',
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    // Regrants share the original interval. Never erase history to restore the old index.
    await runner.query('LOCK TABLE contractor_zone_permission IN ACCESS EXCLUSIVE MODE');
    const duplicates = (await runner.query(
      'SELECT 1 FROM contractor_zone_permission GROUP BY site_contractor_id,zone_id,valid_from HAVING count(*) > 1 LIMIT 1',
    )) as unknown[];
    if (duplicates.length)
      throw new Error('Contractor Zone rollback requires an explicit data preservation plan');
    await runner.query('DROP INDEX uq_contractor_zone_interval');
    await runner.query(
      'CREATE UNIQUE INDEX uq_contractor_zone_interval ON contractor_zone_permission(site_contractor_id,zone_id,valid_from)',
    );
  }
}
