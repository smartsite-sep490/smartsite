import type { MigrationInterface, QueryRunner } from 'typeorm';

export class LeaveNotice1795046400000 implements MigrationInterface {
  name = 'LeaveNotice1795046400000';
  async up(runner: QueryRunner): Promise<void> {
    // Historical requests keep unknown notice classification, without invented metadata.
    await runner.query(`ALTER TABLE absence_request
      ADD COLUMN notice_type varchar(16), ADD COLUMN short_notice boolean,
      ADD CONSTRAINT ck_absence_notice_type CHECK
        (notice_type IS NULL OR notice_type IN ('PLANNED','EMERGENCY'))`);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM absence_request WHERE notice_type IS NOT NULL OR short_notice IS NOT NULL)
      THEN RAISE EXCEPTION 'Leave notice rollback refused: request history must be preserved'; END IF;
    END $$`);
    await runner.query(`ALTER TABLE absence_request DROP CONSTRAINT ck_absence_notice_type,
      DROP COLUMN short_notice, DROP COLUMN notice_type`);
  }
}
