import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Candidate for retained main. No implicit consent, template copies or live adapter activation. */
export class SafetyFaceProvenance1791590400003 implements MigrationInterface {
  name = 'SafetyFaceProvenance1791590400003';
  async up(runner: QueryRunner): Promise<void> {
    if (
      !(await runner.hasColumn('face_profile', 'consent_method')) ||
      !(await runner.hasColumn('face_profile', 'deleted_at'))
    )
      throw new Error('Canonical main Face consent/deletion migration is required');
    await runner.query(`
      ALTER TABLE face_profile ADD COLUMN safety_revision UUID NOT NULL DEFAULT gen_random_uuid();
      CREATE FUNCTION mf06_face_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP = 'INSERT' THEN
          NEW.safety_revision := gen_random_uuid();
        ELSIF (to_jsonb(NEW) - 'safety_revision') IS DISTINCT FROM (to_jsonb(OLD) - 'safety_revision') THEN
          NEW.safety_revision := gen_random_uuid();
        ELSIF NEW.safety_revision IS DISTINCT FROM OLD.safety_revision THEN
          RAISE EXCEPTION 'Face revision is database owned' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER trg_mf06_face_revision BEFORE INSERT OR UPDATE ON face_profile
        FOR EACH ROW EXECUTE FUNCTION mf06_face_revision_guard();

      CREATE TABLE safety_face_consent (
        id UUID PRIMARY KEY,
        profile_id UUID NOT NULL REFERENCES face_profile(id) ON DELETE RESTRICT,
        profile_revision UUID NOT NULL,
        purpose VARCHAR(32) NOT NULL CHECK (purpose = 'SAFETY_MF06'),
        consent_version VARCHAR(64) NOT NULL CHECK (char_length(btrim(consent_version)) BETWEEN 1 AND 64),
        consent_method VARCHAR(50) NOT NULL CHECK (consent_method = 'SUPERVISED_WORKER_CONFIRMATION'),
        consented_at TIMESTAMPTZ NOT NULL CHECK (isfinite(consented_at)),
        source_record_id UUID NOT NULL UNIQUE,
        source_record_hash CHAR(64) NOT NULL CHECK (source_record_hash ~ '^[0-9a-f]{64}$'),
        recorded_by_user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp() CHECK (isfinite(recorded_at))
      );
      CREATE INDEX idx_safety_face_consent_profile ON safety_face_consent(profile_id,profile_revision);
      CREATE TABLE safety_face_consent_revocation (
        consent_id UUID PRIMARY KEY REFERENCES safety_face_consent(id) ON DELETE RESTRICT,
        revoked_at TIMESTAMPTZ NOT NULL CHECK (isfinite(revoked_at)),
        source_record_id UUID NOT NULL UNIQUE,
        source_record_hash CHAR(64) NOT NULL CHECK (source_record_hash ~ '^[0-9a-f]{64}$'),
        recorded_by_user_id UUID NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp() CHECK (isfinite(recorded_at))
      );
      CREATE FUNCTION mf06_face_consent_insert_guard() RETURNS trigger LANGUAGE plpgsql
        SET search_path FROM CURRENT AS $$
      DECLARE p face_profile%ROWTYPE;
      BEGIN
        SELECT * INTO p FROM face_profile WHERE id = NEW.profile_id FOR SHARE;
        IF NOT FOUND OR p.status <> 'ACTIVE' OR p.revoked_at IS NOT NULL OR p.deleted_at IS NOT NULL
          OR p.consent_method <> 'SUPERVISED_WORKER_CONFIRMATION'
          OR p.safety_revision <> NEW.profile_revision OR NEW.consented_at < p.consented_at
          OR NEW.consented_at > statement_timestamp() THEN
          RAISE EXCEPTION 'Safety consent profile provenance unavailable' USING ERRCODE = '23514';
        END IF;
        NEW.recorded_at := statement_timestamp();
        RETURN NEW;
      END $$;
      CREATE FUNCTION mf06_face_revocation_insert_guard() RETURNS trigger LANGUAGE plpgsql
        SET search_path FROM CURRENT AS $$
      DECLARE consent_time TIMESTAMPTZ;
      BEGIN
        SELECT consented_at INTO consent_time FROM safety_face_consent WHERE id = NEW.consent_id FOR UPDATE;
        IF NOT FOUND OR NEW.revoked_at < consent_time OR NEW.revoked_at > statement_timestamp() THEN
          RAISE EXCEPTION 'Safety consent revocation provenance invalid' USING ERRCODE = '23514';
        END IF;
        NEW.recorded_at := statement_timestamp();
        RETURN NEW;
      END $$;
      CREATE FUNCTION mf06_face_consent_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'Safety Face consent provenance is immutable' USING ERRCODE = '23514';
      END $$;
      CREATE TRIGGER trg_safety_face_consent_insert BEFORE INSERT ON safety_face_consent
        FOR EACH ROW EXECUTE FUNCTION mf06_face_consent_insert_guard();
      CREATE TRIGGER trg_safety_face_revocation_insert BEFORE INSERT ON safety_face_consent_revocation
        FOR EACH ROW EXECUTE FUNCTION mf06_face_revocation_insert_guard();
      CREATE TRIGGER trg_safety_face_consent_immutable BEFORE UPDATE OR DELETE ON safety_face_consent
        FOR EACH ROW EXECUTE FUNCTION mf06_face_consent_immutable();
      CREATE TRIGGER trg_safety_face_revocation_immutable BEFORE UPDATE OR DELETE ON safety_face_consent_revocation
        FOR EACH ROW EXECUTE FUNCTION mf06_face_consent_immutable();
    `);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      LOCK TABLE face_profile,safety_face_consent,safety_face_consent_revocation IN ACCESS EXCLUSIVE MODE;
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM safety_face_consent) OR EXISTS (SELECT 1 FROM safety_face_consent_revocation) THEN
          RAISE EXCEPTION 'Populated Safety Face provenance requires forward recovery' USING ERRCODE = '23514';
        END IF;
      END $$;
      DROP TABLE safety_face_consent_revocation;
      DROP TABLE safety_face_consent;
      DROP FUNCTION mf06_face_consent_insert_guard();
      DROP FUNCTION mf06_face_revocation_insert_guard();
      DROP FUNCTION mf06_face_consent_immutable();
      DROP TRIGGER trg_mf06_face_revision ON face_profile;
      DROP FUNCTION mf06_face_revision_guard();
      ALTER TABLE face_profile DROP COLUMN safety_revision;
    `);
  }
}
