import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AllowMultipleWorkerShiftsPerDay1791072000000 implements MigrationInterface {
  name = 'AllowMultipleWorkerShiftsPerDay1791072000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // The previous index allowed only one active shift per worker and day
    // within a schedule version. Workers may work multiple different shifts
    // on the same day, but the same shift must remain unique at site scope.
    await queryRunner.query('DROP INDEX IF EXISTS uq_worker_schedule_active_worker_date');
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_worker_schedule_active_worker_shift_date
      ON worker_schedule (site_id, worker_id, shift_id, work_date)
      WHERE is_active = true
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS uq_worker_schedule_active_worker_shift_date');
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_worker_schedule_active_worker_date
      ON worker_schedule (schedule_version_id, worker_id, work_date)
      WHERE is_active = true
    `);
  }
}
