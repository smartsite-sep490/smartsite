import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CameraConfigurationBundles1793750400000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive) throw new Error('Camera bundles require a transaction');
    await runner.query("SET LOCAL lock_timeout='5s'");
    await runner.query('LOCK TABLE camera IN ACCESS EXCLUSIVE MODE');
    await runner.query(
      'ALTER TABLE camera_region_geometry_revision ADD CONSTRAINT uq_region_revision_bundle_scope UNIQUE(region_id,geometry_version,camera_id,zone_id)',
    );
    await runner.query(`CREATE TABLE camera_configuration_bundle (
      camera_id uuid NOT NULL, configuration_version bigint NOT NULL, site_id uuid NOT NULL,
      camera_external_id varchar(128) NOT NULL, view_revision bigint NOT NULL, issued_at timestamptz NOT NULL, bundle_sha256 char(64) NOT NULL,
      CONSTRAINT pk_camera_configuration_bundle PRIMARY KEY(camera_id,configuration_version),
      CONSTRAINT uq_camera_bundle_hash UNIQUE(camera_id,bundle_sha256),
      CONSTRAINT fk_camera_bundle_view_scope FOREIGN KEY(camera_id,view_revision,site_id) REFERENCES camera_view_revision(camera_id,revision,site_id) ON DELETE RESTRICT,
      CONSTRAINT chk_camera_bundle_versions CHECK(configuration_version BETWEEN 1 AND 9007199254740991 AND view_revision BETWEEN 1 AND 9007199254740991),
      CONSTRAINT chk_camera_bundle_time CHECK(isfinite(issued_at)),
      CONSTRAINT chk_camera_bundle_hash CHECK(bundle_sha256 ~ '^[a-f0-9]{64}$'))`);
    await runner.query(
      'CREATE INDEX idx_camera_bundle_view_scope ON camera_configuration_bundle(camera_id,view_revision,site_id)',
    );
    await runner.query(
      'CREATE INDEX idx_camera_bundle_site_time ON camera_configuration_bundle(site_id,issued_at)',
    );
    await runner.query(`CREATE TABLE camera_configuration_bundle_region (
      camera_id uuid NOT NULL, configuration_version bigint NOT NULL, region_id uuid NOT NULL,
      geometry_version integer NOT NULL, zone_id uuid NOT NULL, policy_revision bigint NOT NULL,
      CONSTRAINT pk_camera_configuration_bundle_region PRIMARY KEY(camera_id,configuration_version,region_id),
      CONSTRAINT fk_camera_bundle_region_header FOREIGN KEY(camera_id,configuration_version) REFERENCES camera_configuration_bundle(camera_id,configuration_version) ON DELETE RESTRICT,
      CONSTRAINT fk_camera_bundle_region_geometry FOREIGN KEY(region_id,geometry_version,camera_id,zone_id) REFERENCES camera_region_geometry_revision(region_id,geometry_version,camera_id,zone_id) ON DELETE RESTRICT,
      CONSTRAINT fk_camera_bundle_region_policy FOREIGN KEY(zone_id,policy_revision) REFERENCES zone_policy_revision(zone_id,policy_revision) ON DELETE RESTRICT)`);
    await runner.query(
      'CREATE INDEX idx_camera_bundle_region_geometry ON camera_configuration_bundle_region(region_id,geometry_version,camera_id,zone_id)',
    );
    await runner.query(
      'CREATE INDEX idx_camera_bundle_region_policy ON camera_configuration_bundle_region(zone_id,policy_revision)',
    );
    await runner.query(`CREATE FUNCTION protect_camera_bundle_history() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Camera bundle history is immutable' USING ERRCODE='23514'; END $$`);
    for (const table of ['camera_configuration_bundle', 'camera_configuration_bundle_region'])
      await runner.query(`CREATE TRIGGER ${table}_immutable BEFORE UPDATE OR DELETE OR TRUNCATE ON ${table}
        FOR EACH STATEMENT EXECUTE FUNCTION protect_camera_bundle_history()`);
  }

  async down(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive) throw new Error('Camera bundles require a transaction');
    await runner.query("SET LOCAL lock_timeout='5s'");
    await runner.query(
      'LOCK TABLE camera, camera_configuration_bundle, camera_configuration_bundle_region IN ACCESS EXCLUSIVE MODE',
    );
    const [used] = await runner.query(
      'SELECT EXISTS(SELECT 1 FROM camera_configuration_bundle) OR EXISTS(SELECT 1 FROM camera_configuration_bundle_region) AS present',
    );
    if (used.present) throw new Error('Camera bundle history must be retained before rollback');
    await runner.query(
      'DROP TABLE camera_configuration_bundle_region, camera_configuration_bundle',
    );
    await runner.query('DROP FUNCTION protect_camera_bundle_history()');
    await runner.query(
      'ALTER TABLE camera_region_geometry_revision DROP CONSTRAINT uq_region_revision_bundle_scope',
    );
  }
}
