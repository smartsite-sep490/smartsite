import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Candidate for retained main. No implicit consent, template copies or live adapter activation. */
export class CanonicalSafetyFaceProvenance1794268800000 implements MigrationInterface {
  name = 'CanonicalSafetyFaceProvenance1794268800000';
  async up(runner: QueryRunner): Promise<void> {
    const { target, trustedPath } = await this.scope(runner, 'up');
    const prerequisites = await runner.query(`SELECT a.attname FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid=a.attrelid WHERE c.relnamespace=current_schema()::regnamespace
      AND c.relname='face_profile' AND a.attname IN ('consent_method','deleted_at') AND NOT a.attisdropped`);
    if (prerequisites.length !== 2)
      throw new Error('Canonical main Face consent/deletion migration is required');
    await runner.query(`
      ALTER TABLE ${target}.face_profile ADD COLUMN safety_revision UUID NOT NULL DEFAULT pg_catalog.gen_random_uuid();
      CREATE FUNCTION ${target}.mf06_face_revision_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO ${trustedPath} AS $$
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
      CREATE TRIGGER trg_mf06_face_revision BEFORE INSERT OR UPDATE ON ${target}.face_profile
        FOR EACH ROW EXECUTE FUNCTION ${target}.mf06_face_revision_guard();

      CREATE TABLE ${target}.safety_face_consent (
        id UUID PRIMARY KEY,
        profile_id UUID NOT NULL REFERENCES ${target}.face_profile(id) ON DELETE RESTRICT,
        profile_revision UUID NOT NULL,
        purpose VARCHAR(32) NOT NULL CHECK (purpose = 'SAFETY_MF06'),
        consent_version VARCHAR(64) NOT NULL CHECK (char_length(btrim(consent_version)) BETWEEN 1 AND 64),
        consent_method VARCHAR(50) NOT NULL CHECK (consent_method = 'SUPERVISED_WORKER_CONFIRMATION'),
        consented_at TIMESTAMPTZ NOT NULL CHECK (isfinite(consented_at)),
        source_record_id UUID NOT NULL UNIQUE,
        source_record_hash CHAR(64) NOT NULL CHECK (source_record_hash ~ '^[0-9a-f]{64}$'),
        recorded_by_user_id UUID NOT NULL REFERENCES ${target}.app_user(id) ON DELETE RESTRICT,
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp() CHECK (isfinite(recorded_at))
      );
      CREATE INDEX idx_safety_face_consent_profile ON ${target}.safety_face_consent(profile_id,profile_revision);
      CREATE TABLE ${target}.safety_face_consent_revocation (
        consent_id UUID PRIMARY KEY REFERENCES ${target}.safety_face_consent(id) ON DELETE RESTRICT,
        revoked_at TIMESTAMPTZ NOT NULL CHECK (isfinite(revoked_at)),
        source_record_id UUID NOT NULL UNIQUE,
        source_record_hash CHAR(64) NOT NULL CHECK (source_record_hash ~ '^[0-9a-f]{64}$'),
        recorded_by_user_id UUID NOT NULL REFERENCES ${target}.app_user(id) ON DELETE RESTRICT,
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT statement_timestamp() CHECK (isfinite(recorded_at))
      );
      CREATE FUNCTION ${target}.mf06_face_consent_insert_guard() RETURNS trigger LANGUAGE plpgsql
        SET search_path TO ${trustedPath} AS $$
      DECLARE p face_profile%ROWTYPE;
      BEGIN
        -- Tuple write fences stale SERIALIZABLE snapshots without changing revision or enrollment bytes.
        UPDATE face_profile SET safety_revision=safety_revision WHERE id=NEW.profile_id RETURNING * INTO p;
        IF NOT FOUND OR p.status <> 'ACTIVE' OR p.revoked_at IS NOT NULL OR p.deleted_at IS NOT NULL
          OR p.consent_method <> 'SUPERVISED_WORKER_CONFIRMATION'
          OR p.safety_revision <> NEW.profile_revision OR NEW.consented_at < p.consented_at
          OR NEW.consented_at > statement_timestamp() THEN
          RAISE EXCEPTION 'Safety consent profile provenance unavailable' USING ERRCODE = '23514';
        END IF;
        NEW.recorded_at := statement_timestamp();
        RETURN NEW;
      END $$;
      CREATE FUNCTION ${target}.mf06_face_revocation_insert_guard() RETURNS trigger LANGUAGE plpgsql
        SET search_path TO ${trustedPath} AS $$
      DECLARE consent_time TIMESTAMPTZ;
      BEGIN
        -- Finalizers lock this same profile; an older snapshot must retry after a winning revocation.
        UPDATE face_profile SET safety_revision=safety_revision
          WHERE id=(SELECT profile_id FROM safety_face_consent WHERE id=NEW.consent_id);
        SELECT consented_at INTO consent_time FROM safety_face_consent WHERE id = NEW.consent_id FOR UPDATE;
        IF NOT FOUND OR NEW.revoked_at < consent_time OR NEW.revoked_at > statement_timestamp() THEN
          RAISE EXCEPTION 'Safety consent revocation provenance invalid' USING ERRCODE = '23514';
        END IF;
        NEW.recorded_at := statement_timestamp();
        RETURN NEW;
      END $$;
      CREATE FUNCTION ${target}.mf06_face_consent_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path TO ${trustedPath} AS $$
      BEGIN
        RAISE EXCEPTION 'Safety Face consent provenance is immutable' USING ERRCODE = '23514';
      END $$;
      CREATE TRIGGER trg_safety_face_consent_insert BEFORE INSERT ON ${target}.safety_face_consent
        FOR EACH ROW EXECUTE FUNCTION ${target}.mf06_face_consent_insert_guard();
      CREATE TRIGGER trg_safety_face_revocation_insert BEFORE INSERT ON ${target}.safety_face_consent_revocation
        FOR EACH ROW EXECUTE FUNCTION ${target}.mf06_face_revocation_insert_guard();
      CREATE TRIGGER trg_safety_face_consent_immutable BEFORE UPDATE OR DELETE ON ${target}.safety_face_consent
        FOR EACH ROW EXECUTE FUNCTION ${target}.mf06_face_consent_immutable();
      CREATE TRIGGER trg_safety_face_revocation_immutable BEFORE UPDATE OR DELETE ON ${target}.safety_face_consent_revocation
        FOR EACH ROW EXECUTE FUNCTION ${target}.mf06_face_consent_immutable();
      CREATE TRIGGER trg_safety_face_consent_truncate BEFORE TRUNCATE ON ${target}.safety_face_consent
        FOR EACH STATEMENT EXECUTE FUNCTION ${target}.mf06_face_consent_immutable();
      CREATE TRIGGER trg_safety_face_revocation_truncate BEFORE TRUNCATE ON ${target}.safety_face_consent_revocation
        FOR EACH STATEMENT EXECUTE FUNCTION ${target}.mf06_face_consent_immutable();
    `);
  }
  async down(runner: QueryRunner): Promise<void> {
    const { target } = await this.scope(runner, 'down');
    await runner.query(`
      LOCK TABLE ${target}.face_profile,${target}.safety_face_consent,${target}.safety_face_consent_revocation IN ACCESS EXCLUSIVE MODE;
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM ${target}.safety_face_consent) OR EXISTS (SELECT 1 FROM ${target}.safety_face_consent_revocation) THEN
          RAISE EXCEPTION 'Populated Safety Face provenance requires forward recovery' USING ERRCODE = '23514';
        END IF;
      END $$;
      DROP TABLE ${target}.safety_face_consent_revocation;
      DROP TABLE ${target}.safety_face_consent;
      DROP FUNCTION ${target}.mf06_face_consent_insert_guard();
      DROP FUNCTION ${target}.mf06_face_revocation_insert_guard();
      DROP FUNCTION ${target}.mf06_face_consent_immutable();
      DROP TRIGGER trg_mf06_face_revision ON ${target}.face_profile;
      DROP FUNCTION ${target}.mf06_face_revision_guard();
      ALTER TABLE ${target}.face_profile DROP COLUMN safety_revision;
    `);
  }

  private async scope(runner: QueryRunner, direction: 'up' | 'down') {
    if (!runner.isTransactionActive)
      throw new Error('Safety Face migration requires a transaction');
    const [scope]: { name: string }[] = await runner.query('SELECT current_schema() AS name');
    if (!scope || typeof scope.name !== 'string') throw new Error('Missing target schema');
    const temporary = await runner.query(`SELECT 1 FROM pg_catalog.pg_class
      WHERE relnamespace=pg_catalog.pg_my_temp_schema() AND relname IN
      ('face_profile','worker','app_user','safety_face_consent','safety_face_consent_revocation')`);
    if (temporary.length) throw new Error('Temporary Safety Face objects refused');
    const parents = await runner.query(`SELECT relname FROM pg_catalog.pg_class
      WHERE relnamespace=current_schema()::regnamespace AND relkind='r'
      AND relname IN ('face_profile','worker','app_user')`);
    if (parents.length !== 3) throw new Error('Safety Face parents must belong to target schema');
    if (direction === 'up') {
      const collisions = await runner.query(`SELECT 1 FROM pg_catalog.pg_class
        WHERE relnamespace=current_schema()::regnamespace AND relname IN ('safety_face_consent','safety_face_consent_revocation')
        UNION ALL SELECT 1 FROM pg_catalog.pg_proc WHERE pronamespace=current_schema()::regnamespace AND proname IN
        ('mf06_face_revision_guard','mf06_face_consent_insert_guard','mf06_face_revocation_insert_guard','mf06_face_consent_immutable')
        UNION ALL SELECT 1 FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
        WHERE c.relnamespace=current_schema()::regnamespace AND c.relname='face_profile' AND a.attname='safety_revision' AND NOT a.attisdropped`);
      if (collisions.length)
        throw new Error('Existing Safety Face objects require reviewed upgrade');
    }
    const target = '"' + scope.name.replaceAll('"', '""') + '"';
    return { target, trustedPath: `pg_catalog, ${target}, pg_temp` };
  }
}
