import type { MigrationInterface, QueryRunner } from 'typeorm';
export class ErdAccessPolicy1791504000006 implements MigrationInterface {
  async up(runner: QueryRunner) {
    await runner.query(
      'ALTER TABLE site ADD COLUMN access_policy_version integer NOT NULL DEFAULT 1',
    );
    await runner.query(
      `ALTER TABLE worker_site_zone_assignment DROP CONSTRAINT chk_worker_site_zone_assignment_status, ADD CONSTRAINT chk_worker_site_zone_assignment_status CHECK (status IN ('PENDING','SAFETY_REVIEWED','APPROVED','REJECTED','CANCELLED','REVOKED','EXPIRED'))`,
    );
  }
  async down(runner: QueryRunner) {
    const rows = await runner.query(
      `SELECT EXISTS(SELECT 1 FROM worker_site_zone_assignment WHERE status IN ('REVOKED','EXPIRED')) AS present`,
    );
    if ((rows as unknown as Array<{ present: boolean }>)[0]?.present)
      throw new Error('Cannot discard ERD assignment lifecycle history');
    await runner.query(
      `ALTER TABLE worker_site_zone_assignment DROP CONSTRAINT chk_worker_site_zone_assignment_status, ADD CONSTRAINT chk_worker_site_zone_assignment_status CHECK (status IN ('PENDING','SAFETY_REVIEWED','APPROVED','REJECTED','CANCELLED'))`,
    );
    await runner.query('ALTER TABLE site DROP COLUMN access_policy_version');
  }
}
