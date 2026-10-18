import type { MigrationInterface, QueryRunner } from 'typeorm';

export class WorkerDocumentIdentityChecks1792627200000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE worker_identity_image ADD COLUMN ocr jsonb');
  }
  async down(runner: QueryRunner): Promise<void> {
    // Original images remain intact; only reproducible technical suggestions are removed.
    await runner.query('ALTER TABLE worker_identity_image DROP COLUMN ocr');
  }
}
