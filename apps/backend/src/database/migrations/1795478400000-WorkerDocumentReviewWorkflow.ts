import type { MigrationInterface, QueryRunner } from 'typeorm';
export class WorkerDocumentReviewWorkflow1795478400000 implements MigrationInterface {
  name = 'WorkerDocumentReviewWorkflow1795478400000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE worker_compliance_profile ADD COLUMN safety_card_required boolean NOT NULL DEFAULT true, ADD COLUMN version integer NOT NULL DEFAULT 1',
    );
    await queryRunner.query(
      'ALTER TABLE worker_compliance_profile ADD CONSTRAINT chk_compliance_version CHECK (version >= 1)',
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE worker_compliance_profile DROP CONSTRAINT chk_compliance_version, DROP COLUMN version, DROP COLUMN safety_card_required',
    );
  }
}
