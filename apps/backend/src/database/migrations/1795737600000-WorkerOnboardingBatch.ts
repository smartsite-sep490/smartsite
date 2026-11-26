import type { MigrationInterface, QueryRunner } from 'typeorm';

export class WorkerOnboardingBatch1795737600000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE worker_compliance_profile
        ADD COLUMN identity_version integer NOT NULL DEFAULT 0
          CONSTRAINT chk_compliance_identity_version CHECK (identity_version >= 0),
        ADD COLUMN draft_safety_card_required boolean;
      ALTER TABLE worker_document
        ALTER COLUMN ocr DROP NOT NULL,
        DROP CONSTRAINT chk_worker_document_status,
        ADD CONSTRAINT chk_worker_document_status
          CHECK (status IN ('DRAFT','PENDING','APPROVED','REJECTED','SUPERSEDED'));
      CREATE UNIQUE INDEX uq_worker_document_draft ON worker_document(worker_id, kind)
        WHERE status = 'DRAFT';
      CREATE TABLE worker_onboarding_draft (
        id uuid PRIMARY KEY,
        site_id uuid NOT NULL CONSTRAINT fk_worker_intake_site REFERENCES site(id) ON DELETE RESTRICT,
        contractor_id uuid NOT NULL CONSTRAINT fk_worker_intake_contractor REFERENCES contractor(id) ON DELETE RESTRICT,
        worker_id uuid CONSTRAINT fk_worker_intake_worker REFERENCES worker(id) ON DELETE RESTRICT,
        display_name varchar(255) NOT NULL,
        username varchar(64) NOT NULL,
        email varchar(254) NOT NULL,
        language varchar(2) NOT NULL CONSTRAINT chk_worker_intake_language CHECK (language IN ('vi', 'en')),
        safety_card_required boolean,
        documents jsonb NOT NULL,
        version integer NOT NULL CONSTRAINT chk_worker_intake_version CHECK (version >= 1),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_worker_intake_scope ON worker_onboarding_draft(site_id, contractor_id, updated_at, id);
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM worker_onboarding_draft)
          OR EXISTS (SELECT 1 FROM worker_document WHERE status = 'DRAFT' OR ocr IS NULL)
          OR EXISTS (SELECT 1 FROM worker_compliance_profile
                     WHERE identity_version <> 0 OR draft_safety_card_required IS NOT NULL)
        THEN RAISE EXCEPTION 'Worker onboarding and document history must be retained before rollback';
        END IF;
      END $$;
      DROP TABLE worker_onboarding_draft;
      DROP INDEX uq_worker_document_draft;
      ALTER TABLE worker_document
        ALTER COLUMN ocr SET NOT NULL,
        DROP CONSTRAINT chk_worker_document_status,
        ADD CONSTRAINT chk_worker_document_status
          CHECK (status IN ('PENDING','APPROVED','REJECTED','SUPERSEDED'));
      ALTER TABLE worker_compliance_profile
        DROP COLUMN identity_version,
        DROP COLUMN draft_safety_card_required;
    `);
  }
}
