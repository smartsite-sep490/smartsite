import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SafetyAlertReadIndex1790467200000 implements MigrationInterface {
  name = 'SafetyAlertReadIndex1790467200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX idx_alert_site_last_detected
      ON safety_alert (site_id, last_detected_at DESC, id ASC)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX idx_alert_site_last_detected');
  }
}
