import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CameraWorkerGenerations1794614400000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive) throw new Error('Worker generations require a transaction');
    await runner.query("SET LOCAL lock_timeout='5s'");
    await runner.query('LOCK TABLE camera,camera_configuration_bundle IN ACCESS EXCLUSIVE MODE');
    await runner.query(
      'ALTER TABLE camera ADD CONSTRAINT uq_camera_generation_site UNIQUE(id,site_id)',
    );
    await runner.query(`ALTER TABLE camera_configuration_bundle ADD CONSTRAINT uq_camera_bundle_receipt_scope
      UNIQUE(camera_id,configuration_version,site_id,view_revision,bundle_sha256)`);
    await runner.query(`CREATE TABLE camera_worker_generation (
      id uuid NOT NULL, camera_id uuid NOT NULL, site_id uuid NOT NULL, stream_session_id uuid NOT NULL,
      credential_sha256 char(64) NOT NULL, is_current boolean NOT NULL,
      issued_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
      superseded_at timestamptz NULL, revoked_at timestamptz NULL,
      CONSTRAINT pk_camera_worker_generation PRIMARY KEY(id),
      CONSTRAINT uq_camera_worker_generation_scope UNIQUE(id,camera_id,site_id,stream_session_id),
      CONSTRAINT fk_camera_worker_generation_camera_site FOREIGN KEY(camera_id,site_id) REFERENCES camera(id,site_id) ON DELETE RESTRICT,
      CONSTRAINT chk_camera_worker_generation_hash CHECK(credential_sha256 ~ '^[a-f0-9]{64}$'),
      CONSTRAINT chk_camera_worker_generation_current CHECK(is_current=(superseded_at IS NULL AND revoked_at IS NULL)),
      CONSTRAINT chk_camera_worker_generation_times CHECK(isfinite(issued_at) AND isfinite(expires_at)
        AND expires_at>=issued_at+INTERVAL '1 second' AND expires_at<=issued_at+INTERVAL '24 hours'
        AND (superseded_at IS NULL OR (isfinite(superseded_at) AND superseded_at>=issued_at))
        AND (revoked_at IS NULL OR (isfinite(revoked_at) AND revoked_at>=issued_at))))`);
    await runner.query(
      'CREATE UNIQUE INDEX uq_camera_worker_generation_current ON camera_worker_generation(camera_id) WHERE is_current',
    );
    await runner.query(
      'CREATE INDEX idx_camera_worker_generation_camera_site ON camera_worker_generation(camera_id,site_id)',
    );
    await runner.query(`CREATE TABLE camera_configuration_application_receipt (
      command_id uuid NOT NULL, receipt_order bigint GENERATED ALWAYS AS IDENTITY,
      camera_id uuid NOT NULL, site_id uuid NOT NULL, worker_generation_id uuid NOT NULL, stream_session_id uuid NOT NULL,
      configuration_version bigint NOT NULL, view_revision bigint NOT NULL, bundle_sha256 char(64) NOT NULL,
      outcome varchar(16) NOT NULL, reason_code varchar(64) NULL, payload_sha256 char(64) NOT NULL, received_at timestamptz NOT NULL,
      CONSTRAINT pk_camera_configuration_application_receipt PRIMARY KEY(command_id),
      CONSTRAINT uq_camera_application_receipt_order UNIQUE(receipt_order),
      CONSTRAINT fk_camera_application_receipt_generation FOREIGN KEY(worker_generation_id,camera_id,site_id,stream_session_id)
        REFERENCES camera_worker_generation(id,camera_id,site_id,stream_session_id) ON DELETE RESTRICT,
      CONSTRAINT fk_camera_application_receipt_bundle FOREIGN KEY(camera_id,configuration_version,site_id,view_revision,bundle_sha256)
        REFERENCES camera_configuration_bundle(camera_id,configuration_version,site_id,view_revision,bundle_sha256) ON DELETE RESTRICT,
      CONSTRAINT chk_camera_application_receipt_versions CHECK(configuration_version BETWEEN 1 AND 9007199254740991 AND view_revision BETWEEN 1 AND 9007199254740991),
      CONSTRAINT chk_camera_application_receipt_hashes CHECK(bundle_sha256 ~ '^[a-f0-9]{64}$' AND payload_sha256 ~ '^[a-f0-9]{64}$'),
      CONSTRAINT chk_camera_application_receipt_outcome CHECK((outcome='LOADED' AND reason_code IS NULL)
        OR (outcome='REJECTED' AND (reason_code IS NULL OR reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'))),
      CONSTRAINT chk_camera_application_receipt_time CHECK(isfinite(received_at)))`);
    await runner.query(`CREATE INDEX idx_camera_application_receipt_generation_scope
      ON camera_configuration_application_receipt(worker_generation_id,camera_id,site_id,stream_session_id,receipt_order DESC)`);
    await runner.query(`CREATE INDEX idx_camera_application_receipt_bundle_scope
      ON camera_configuration_application_receipt(camera_id,configuration_version,site_id,view_revision,bundle_sha256)`);
    await runner.query(`CREATE FUNCTION protect_camera_worker_generation() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE populated boolean;
      BEGIN
        IF TG_OP='TRUNCATE' THEN
          EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I)',TG_TABLE_SCHEMA,TG_TABLE_NAME) INTO populated;
          IF NOT populated THEN RETURN NULL; END IF;
        END IF;
        IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'Worker generation history cannot be removed' USING ERRCODE='23514'; END IF;
        IF ROW(NEW.id,NEW.camera_id,NEW.site_id,NEW.stream_session_id,NEW.credential_sha256,NEW.issued_at,NEW.expires_at)
          IS DISTINCT FROM ROW(OLD.id,OLD.camera_id,OLD.site_id,OLD.stream_session_id,OLD.credential_sha256,OLD.issued_at,OLD.expires_at)
          OR (NOT OLD.is_current AND NEW.is_current)
          OR (OLD.superseded_at IS NOT NULL AND NEW.superseded_at IS DISTINCT FROM OLD.superseded_at)
          OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)
        THEN RAISE EXCEPTION 'Worker generation issuance is immutable and terminal' USING ERRCODE='23514'; END IF;
        RETURN NEW;
      END $$`);
    await runner.query(`CREATE TRIGGER camera_worker_generation_lifecycle BEFORE UPDATE OR DELETE ON camera_worker_generation
      FOR EACH ROW EXECUTE FUNCTION protect_camera_worker_generation()`);
    await runner.query(`CREATE TRIGGER camera_worker_generation_no_truncate BEFORE TRUNCATE ON camera_worker_generation
      FOR EACH STATEMENT EXECUTE FUNCTION protect_camera_worker_generation()`);
    await runner.query(`CREATE FUNCTION protect_camera_application_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE populated boolean;
      BEGIN
        IF TG_OP='TRUNCATE' THEN
          EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I)',TG_TABLE_SCHEMA,TG_TABLE_NAME) INTO populated;
          IF NOT populated THEN RETURN NULL; END IF;
        END IF;
        RAISE EXCEPTION 'Camera application receipts are immutable' USING ERRCODE='23514';
      END $$`);
    await runner.query(`CREATE TRIGGER camera_application_receipt_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON camera_configuration_application_receipt
      FOR EACH STATEMENT EXECUTE FUNCTION protect_camera_application_receipt()`);
  }

  async down(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive) throw new Error('Worker generations require a transaction');
    await runner.query("SET LOCAL lock_timeout='5s'");
    await runner.query(`LOCK TABLE camera,camera_configuration_bundle,camera_worker_generation,
      camera_configuration_application_receipt IN ACCESS EXCLUSIVE MODE`);
    await runner.query(`DO $$ BEGIN
      IF EXISTS(SELECT 1 FROM camera_worker_generation) OR EXISTS(SELECT 1 FROM camera_configuration_application_receipt)
      THEN RAISE EXCEPTION 'Cannot remove populated worker generation history' USING ERRCODE='23514'; END IF;
      END $$`);
    await runner.query(
      'DROP TABLE camera_configuration_application_receipt,camera_worker_generation',
    );
    await runner.query(
      'DROP FUNCTION protect_camera_application_receipt(),protect_camera_worker_generation()',
    );
    await runner.query(
      'ALTER TABLE camera_configuration_bundle DROP CONSTRAINT uq_camera_bundle_receipt_scope',
    );
    await runner.query('ALTER TABLE camera DROP CONSTRAINT uq_camera_generation_site');
  }
}
