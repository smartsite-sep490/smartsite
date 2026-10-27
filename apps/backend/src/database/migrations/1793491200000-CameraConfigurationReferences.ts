import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CameraConfigurationReferences1793491200000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive)
      throw new Error('Camera reference migration requires a transaction');
    await runner.query("SET LOCAL lock_timeout='5s'");
    await runner.query(`CREATE TABLE camera_view_revision (
      camera_id uuid NOT NULL, revision bigint NOT NULL, site_id uuid NOT NULL,
      session_id uuid NOT NULL, source_kind varchar(8) NOT NULL, width integer NOT NULL, height integer NOT NULL,
      view_validity varchar(16) NOT NULL, is_current boolean NOT NULL, created_at timestamptz NOT NULL, retired_at timestamptz NULL,
      CONSTRAINT pk_camera_view_revision PRIMARY KEY(camera_id,revision),
      CONSTRAINT uq_camera_view_revision_site UNIQUE(camera_id,revision,site_id),
      CONSTRAINT fk_camera_view_camera FOREIGN KEY(camera_id) REFERENCES camera(id) ON DELETE RESTRICT,
      CONSTRAINT fk_camera_view_site FOREIGN KEY(site_id) REFERENCES site(id) ON DELETE RESTRICT,
      CONSTRAINT chk_camera_view_revision CHECK(revision BETWEEN 1 AND 9007199254740991),
      CONSTRAINT chk_camera_view_source CHECK(source_kind IN ('LIVE','REPLAY')),
      CONSTRAINT chk_camera_view_dimensions CHECK(width BETWEEN 64 AND 1280 AND height BETWEEN 64 AND 1280),
      CONSTRAINT chk_camera_view_unconfirmed CHECK(view_validity='UNCONFIRMED'),
      CONSTRAINT chk_camera_view_times CHECK(isfinite(created_at) AND (retired_at IS NULL OR (isfinite(retired_at) AND retired_at>=created_at))),
      CONSTRAINT chk_camera_view_current CHECK(is_current=(retired_at IS NULL)))`);
    await runner.query(
      'CREATE UNIQUE INDEX uq_camera_view_current ON camera_view_revision(camera_id) WHERE is_current',
    );
    await runner.query('CREATE INDEX idx_camera_view_site ON camera_view_revision(site_id)');
    await runner.query(`CREATE TABLE camera_configuration_reference (
      id uuid NOT NULL, camera_id uuid NOT NULL, view_revision bigint NOT NULL, site_id uuid NOT NULL,
      session_id uuid NOT NULL, source_kind varchar(8) NOT NULL, width integer NOT NULL, height integer NOT NULL,
      image_sha256 char(64) NOT NULL, configuration_version bigint NOT NULL,
      captured_at timestamptz NOT NULL, issued_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, issued_by_user_id uuid NOT NULL,
      CONSTRAINT pk_camera_configuration_reference PRIMARY KEY(id),
      CONSTRAINT fk_camera_reference_view_site FOREIGN KEY(camera_id,view_revision,site_id) REFERENCES camera_view_revision(camera_id,revision,site_id) ON DELETE RESTRICT,
      CONSTRAINT fk_camera_reference_issuer FOREIGN KEY(issued_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT,
      CONSTRAINT chk_camera_reference_revision CHECK(configuration_version BETWEEN 1 AND 9007199254740991),
      CONSTRAINT chk_camera_reference_hash CHECK(image_sha256 ~ '^[a-f0-9]{64}$'),
      CONSTRAINT chk_camera_reference_source CHECK(source_kind IN ('LIVE','REPLAY')),
      CONSTRAINT chk_camera_reference_dimensions CHECK(width BETWEEN 64 AND 1280 AND height BETWEEN 64 AND 1280),
      CONSTRAINT chk_camera_reference_times CHECK(isfinite(captured_at) AND isfinite(issued_at) AND isfinite(expires_at)
        AND issued_at-captured_at BETWEEN INTERVAL '-1 second' AND INTERVAL '2 seconds'
        AND expires_at>issued_at AND expires_at<=LEAST(captured_at,issued_at)+INTERVAL '5 minutes'))`);
    await runner.query(
      'CREATE INDEX idx_camera_reference_view_site ON camera_configuration_reference(camera_id,view_revision,site_id)',
    );
    await runner.query(
      'CREATE INDEX idx_camera_reference_site_expiry ON camera_configuration_reference(site_id,expires_at)',
    );
    await runner.query(
      'CREATE INDEX idx_camera_reference_issuer ON camera_configuration_reference(issued_by_user_id)',
    );
    await runner.query(`CREATE FUNCTION protect_camera_reference_provenance() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Camera reference provenance is immutable' USING ERRCODE='23514'; END $$`);
    await runner.query(`CREATE TRIGGER camera_reference_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON camera_configuration_reference
      FOR EACH STATEMENT EXECUTE FUNCTION protect_camera_reference_provenance()`);
    await runner.query(`CREATE TRIGGER camera_view_retained BEFORE DELETE OR TRUNCATE ON camera_view_revision
      FOR EACH STATEMENT EXECUTE FUNCTION protect_camera_reference_provenance()`);
    await runner.query(`CREATE FUNCTION retire_camera_view_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NOT (OLD.is_current AND OLD.retired_at IS NULL AND NOT NEW.is_current AND NEW.retired_at IS NOT NULL)
        OR (to_jsonb(NEW)-'is_current'-'retired_at') IS DISTINCT FROM (to_jsonb(OLD)-'is_current'-'retired_at')
      THEN RAISE EXCEPTION 'Camera view provenance permits retirement only' USING ERRCODE='23514'; END IF;
      RETURN NEW; END $$`);
    await runner.query(`CREATE TRIGGER camera_view_retirement BEFORE UPDATE ON camera_view_revision
      FOR EACH ROW EXECUTE FUNCTION retire_camera_view_revision()`);
  }

  async down(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive)
      throw new Error('Camera reference migration requires a transaction');
    await runner.query("SET LOCAL lock_timeout='5s'");
    await runner.query(
      'LOCK TABLE camera, camera_view_revision, camera_configuration_reference IN ACCESS EXCLUSIVE MODE',
    );
    const [used] = await runner.query(
      `SELECT EXISTS(SELECT 1 FROM camera_view_revision) OR EXISTS(SELECT 1 FROM camera_configuration_reference) AS present`,
    );
    if (used.present)
      throw new Error('Camera reference provenance must be retained before rollback');
    await runner.query('DROP TABLE camera_configuration_reference, camera_view_revision');
    await runner.query(
      'DROP FUNCTION protect_camera_reference_provenance(), retire_camera_view_revision()',
    );
  }
}
