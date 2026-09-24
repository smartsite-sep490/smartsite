import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CameraRegionConfiguration1790035200000 implements MigrationInterface {
  name = 'CameraRegionConfiguration1790035200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE camera
        ADD COLUMN configuration_version BIGINT NOT NULL DEFAULT 1,
        ADD CONSTRAINT chk_camera_configuration_version
          CHECK (configuration_version BETWEEN 1 AND 9007199254740991)
    `);
    await queryRunner.query(`
      ALTER TABLE zone ADD COLUMN configuration_locked BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await queryRunner.query(`
      UPDATE zone SET configuration_locked = TRUE
      WHERE EXISTS (SELECT 1 FROM camera_observation_region region WHERE region.zone_id = zone.id)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE zone DROP COLUMN configuration_locked');
    await queryRunner.query(
      'ALTER TABLE camera DROP CONSTRAINT chk_camera_configuration_version, DROP COLUMN configuration_version',
    );
  }
}
