import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SingleSiteManager1791936000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    // Existing conflicts must be resolved explicitly; never choose or remove an owner silently.
    await runner.query(
      `CREATE UNIQUE INDEX uq_site_single_manager ON user_role_assignment(site_id) WHERE role = 'SITE_MANAGER'`,
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP INDEX uq_site_single_manager');
  }
}
