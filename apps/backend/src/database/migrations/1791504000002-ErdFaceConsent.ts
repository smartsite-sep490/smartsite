import type { MigrationInterface, QueryRunner } from 'typeorm';
export class ErdFaceConsent1791504000002 implements MigrationInterface {
  async up(runner: QueryRunner) {
    await runner.query(`DROP INDEX uq_face_profile_worker;
      ALTER TABLE face_profile DROP CONSTRAINT chk_face_profile_status,DROP CONSTRAINT chk_face_profile_database_template,
        ADD COLUMN consent_method varchar(50) NOT NULL DEFAULT 'LEGACY_UNVERIFIED',ADD COLUMN deleted_at timestamptz;
      UPDATE face_profile SET status='REVOKED',revoked_at=COALESCE(revoked_at,now()) WHERE status='NEEDS_REENROLL';
      ALTER TABLE face_profile
        ADD CONSTRAINT chk_face_profile_status CHECK(status IN ('ACTIVE','REVOKED','DELETED')),
        ADD CONSTRAINT chk_face_profile_database_template CHECK(status <> 'ACTIVE' OR (encrypted_template IS NOT NULL AND length(encrypted_template) BETWEEN 100 AND 32768)),
        ADD CONSTRAINT ck_face_profile_deleted CHECK(status <> 'DELETED' OR encrypted_template IS NULL);
      CREATE UNIQUE INDEX uq_face_profile_worker_active ON face_profile(worker_id) WHERE status='ACTIVE';
      ALTER TABLE face_enrollment_session ALTER COLUMN consented_at DROP NOT NULL,
        ADD COLUMN consent_method varchar(50),ADD COLUMN consent_token_hash char(64),ADD COLUMN expires_at timestamptz;
      UPDATE face_enrollment_session SET status='CANCELLED',completed_at=now() WHERE status IN ('PENDING','COLLECTING');`);
  }
  async down(runner: QueryRunner) {
    await runner.query(`DO $$ BEGIN IF EXISTS(SELECT 1 FROM face_profile WHERE status='DELETED' OR user_id IS NULL AND status='ACTIVE') OR EXISTS(SELECT worker_id FROM face_profile GROUP BY worker_id HAVING count(*)>1) OR EXISTS(SELECT 1 FROM face_enrollment_session WHERE consented_at IS NULL) THEN RAISE EXCEPTION 'Face history cannot be downgraded'; END IF; END $$;
      ALTER TABLE face_enrollment_session DROP COLUMN consent_method,DROP COLUMN consent_token_hash,DROP COLUMN expires_at,ALTER COLUMN consented_at SET NOT NULL;
      DROP INDEX uq_face_profile_worker_active;
      CREATE UNIQUE INDEX uq_face_profile_worker ON face_profile(worker_id);
      ALTER TABLE face_profile DROP COLUMN consent_method,DROP COLUMN deleted_at,DROP CONSTRAINT ck_face_profile_deleted,DROP CONSTRAINT chk_face_profile_status,DROP CONSTRAINT chk_face_profile_database_template,
        ADD CONSTRAINT chk_face_profile_status CHECK(status IN ('ACTIVE','REVOKED','NEEDS_REENROLL')),
        ADD CONSTRAINT chk_face_profile_database_template CHECK(status <> 'ACTIVE' OR (user_id IS NOT NULL AND encrypted_template IS NOT NULL AND length(encrypted_template) BETWEEN 100 AND 32768));`);
  }
}
