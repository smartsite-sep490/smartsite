import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AutomaticScheduleVersion1795132800000 implements MigrationInterface {
  name = 'AutomaticScheduleVersion1795132800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE schedule_version ADD COLUMN is_automatic boolean NOT NULL DEFAULT false',
    );
    await queryRunner.query(
      'CREATE UNIQUE INDEX uq_schedule_version_automatic_site ON schedule_version (site_id) WHERE is_automatic',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX uq_schedule_version_automatic_site');
    await queryRunner.query('ALTER TABLE schedule_version DROP COLUMN is_automatic');
  }
}
