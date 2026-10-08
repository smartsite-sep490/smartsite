import type { MigrationInterface, QueryRunner } from 'typeorm';
export class ErdAccessAudit1791504000004 implements MigrationInterface {
  async up(runner: QueryRunner) {
    await runner.query(`UPDATE qr_credential q SET direction=COALESCE(q.direction,CASE WHEN q.result->>'direction' IN ('IN','OUT') THEN q.result->>'direction' ELSE 'IN' END);
      ALTER TABLE qr_credential ALTER COLUMN site_id SET NOT NULL,ALTER COLUMN direction SET NOT NULL,
        DROP CONSTRAINT chk_qr_direction,ADD CONSTRAINT chk_qr_direction CHECK(direction IN ('IN','OUT')),
        ADD CONSTRAINT ck_qr_expiry CHECK(expires_at>created_at) NOT VALID;
      UPDATE qr_credential SET revoked_at=COALESCE(revoked_at,now()),expires_at=created_at+interval '1 microsecond' WHERE expires_at<=created_at;
      ALTER TABLE qr_credential VALIDATE CONSTRAINT ck_qr_expiry;
      ALTER TABLE access_attempt ADD CONSTRAINT ck_attempt_manual_review CHECK(status NOT IN ('READY','USED') OR method <> 'MANUAL' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)),
        ADD CONSTRAINT ck_attempt_schedule_review CHECK(status NOT IN ('READY','USED') OR direction='OUT' OR schedule_status <> 'NO_SCHEDULE' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL));
      CREATE TABLE audit_log(
      id uuid CONSTRAINT pk_audit_log_id PRIMARY KEY,
      actor_account_id uuid CONSTRAINT fk_audit_actor REFERENCES app_user(id) ON DELETE RESTRICT,
      site_id uuid CONSTRAINT fk_audit_site REFERENCES site(id) ON DELETE RESTRICT,
      action varchar(100) NOT NULL,entity_type varchar(100) NOT NULL,entity_id uuid NOT NULL,reason text,changes jsonb,
      occurred_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now());`);
  }
  async down(runner: QueryRunner) {
    await runner.query(`DO $$ BEGIN IF EXISTS(SELECT 1 FROM audit_log) THEN RAISE EXCEPTION 'Audit history cannot be discarded'; END IF; END $$; DROP TABLE audit_log;
      ALTER TABLE access_attempt DROP CONSTRAINT ck_attempt_manual_review,DROP CONSTRAINT ck_attempt_schedule_review;
      ALTER TABLE qr_credential ALTER COLUMN site_id DROP NOT NULL,ALTER COLUMN direction DROP NOT NULL,DROP CONSTRAINT ck_qr_expiry,DROP CONSTRAINT chk_qr_direction,
        ADD CONSTRAINT chk_qr_direction CHECK(direction IS NULL OR direction IN ('IN','OUT'));`);
  }
}
