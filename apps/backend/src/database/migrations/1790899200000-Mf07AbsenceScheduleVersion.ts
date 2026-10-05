import type { MigrationInterface, QueryRunner } from 'typeorm';

export class Mf07AbsenceScheduleVersion1790899200000 implements MigrationInterface {
  name = 'Mf07AbsenceScheduleVersion1790899200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE absence_request
      ADD COLUMN expected_schedule_version_id uuid
    `);
    await queryRunner.query(`
      UPDATE absence_request
      SET expected_schedule_version_id = worker_schedule.schedule_version_id
      FROM worker_schedule
      WHERE worker_schedule.id = absence_request.worker_schedule_id
    `);
    await queryRunner.query(`
      ALTER TABLE absence_request
      ALTER COLUMN expected_schedule_version_id SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE absence_request
      ADD CONSTRAINT fk_absence_request_expected_version
      FOREIGN KEY (expected_schedule_version_id) REFERENCES schedule_version(id) ON DELETE RESTRICT
    `);
    await queryRunner.query('ALTER TABLE absence_request DROP CONSTRAINT chk_absence_request_status');
    await queryRunner.query(`
      ALTER TABLE absence_request
      ADD CONSTRAINT chk_absence_request_status
      CHECK (status IN ('PENDING_MANAGER', 'APPROVED', 'REJECTED', 'CANCELLED', 'CONFLICTED'))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE absence_request DROP CONSTRAINT IF EXISTS chk_absence_request_status');
    await queryRunner.query(`
      ALTER TABLE absence_request
      ADD CONSTRAINT chk_absence_request_status
      CHECK (status IN ('PENDING_MANAGER', 'APPROVED', 'REJECTED', 'CANCELLED'))
    `);
    await queryRunner.query(
      'ALTER TABLE absence_request DROP CONSTRAINT IF EXISTS fk_absence_request_expected_version',
    );
    await queryRunner.query(
      'ALTER TABLE absence_request DROP COLUMN IF EXISTS expected_schedule_version_id',
    );
  }
}
