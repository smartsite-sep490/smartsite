import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AlertDetectionSubject1793404800000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive)
      throw new Error('Alert subject migration requires a transaction');
    await runner.query(`SET LOCAL lock_timeout='5s'`);
    await runner.query(`ALTER TABLE alert_detection_mapping
      ADD COLUMN person_observation_index smallint NULL,
      ADD CONSTRAINT chk_mapping_person_observation_index
        CHECK(person_observation_index BETWEEN 0 AND 255)`);
  }

  async down(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive)
      throw new Error('Alert subject migration requires a transaction');
    await runner.query(`SET LOCAL lock_timeout='5s'`);
    // Lock before inspecting data so a concurrent ingestion cannot lose new provenance.
    await runner.query('LOCK TABLE alert_detection_mapping IN ACCESS EXCLUSIVE MODE');
    const [used] = await runner.query(`SELECT EXISTS(SELECT 1 FROM alert_detection_mapping
      WHERE person_observation_index IS NOT NULL) AS present`);
    if (used.present) throw new Error('Alert subject provenance must be retained before rollback');
    await runner.query(`ALTER TABLE alert_detection_mapping
      DROP CONSTRAINT chk_mapping_person_observation_index,
      DROP COLUMN person_observation_index`);
  }
}
