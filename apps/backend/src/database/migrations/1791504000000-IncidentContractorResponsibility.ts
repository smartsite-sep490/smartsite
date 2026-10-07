import type { MigrationInterface, QueryRunner } from 'typeorm';
export class IncidentContractorResponsibility1791504000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE incident
      ADD contractor_id uuid REFERENCES contractor(id),
      ADD responsibility_reason text,
      ADD responsibility_confirmed_by uuid REFERENCES app_user(id),
      ADD responsibility_confirmed_at timestamptz,
      ADD CONSTRAINT incident_responsibility_check CHECK (
        (contractor_id IS NULL AND responsibility_reason IS NULL AND responsibility_confirmed_by IS NULL AND responsibility_confirmed_at IS NULL)
        OR (contractor_id IS NOT NULL AND responsibility_reason IS NOT NULL AND length(trim(responsibility_reason))>0 AND responsibility_confirmed_by IS NOT NULL AND responsibility_confirmed_at IS NOT NULL))`);
    await q.query(`CREATE TABLE incident_worker (
      incident_id uuid NOT NULL REFERENCES incident(id),
      worker_id uuid NOT NULL REFERENCES worker(id), PRIMARY KEY (incident_id,worker_id))`);
    await q.query(`ALTER TABLE safety_evidence ADD storage_provider varchar(8) NOT NULL DEFAULT 'LOCAL',
      ADD CONSTRAINT safety_evidence_provider_check CHECK(storage_provider IN ('LOCAL','R2')),
      ALTER storage_key TYPE varchar(512)`);
    await q.query(`ALTER TABLE safety_evidence DROP CONSTRAINT safety_evidence_storage_key_key`);
    await q.query(
      `ALTER TABLE safety_evidence ADD CONSTRAINT safety_evidence_provider_key_unique UNIQUE(storage_provider,storage_key)`,
    );
  }
  async down(q: QueryRunner): Promise<void> {
    // Refuse a downgrade that would discard responsibility or R2 references.
    await q.query(`DO $$ BEGIN IF EXISTS(SELECT 1 FROM incident WHERE contractor_id IS NOT NULL)
      OR EXISTS(SELECT 1 FROM safety_evidence WHERE storage_provider<>'LOCAL') THEN
      RAISE EXCEPTION 'Responsibility/storage data must be explicitly migrated before downgrade'; END IF; END $$`);
    await q.query(`DROP TABLE incident_worker`);
    await q.query(`ALTER TABLE incident DROP CONSTRAINT incident_responsibility_check,
      DROP contractor_id, DROP responsibility_reason, DROP responsibility_confirmed_by, DROP responsibility_confirmed_at`);
    await q.query(`ALTER TABLE safety_evidence DROP CONSTRAINT safety_evidence_provider_key_unique,
      DROP CONSTRAINT safety_evidence_provider_check, DROP storage_provider,
      ALTER storage_key TYPE varchar(64), ADD CONSTRAINT safety_evidence_storage_key_key UNIQUE(storage_key)`);
  }
}
