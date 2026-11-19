import type { MigrationInterface, QueryRunner } from 'typeorm';

export class WorkerDocumentAiAnalysis1795132800001 implements MigrationInterface {
  name = 'WorkerDocumentAiAnalysis1795132800001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE worker_document ADD COLUMN ai_analysis jsonb');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE worker_document DROP COLUMN ai_analysis');
  }
}
