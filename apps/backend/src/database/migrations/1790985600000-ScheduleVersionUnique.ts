import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ScheduleVersionUnique1790985600000 implements MigrationInterface {
  name = 'ScheduleVersionUnique1790985600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE schedule_version
      ADD CONSTRAINT uq_schedule_version_site_version UNIQUE (site_id, version)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE schedule_version DROP CONSTRAINT uq_schedule_version_site_version',
    );
  }
}
