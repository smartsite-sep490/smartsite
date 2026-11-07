import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CameraRegionGeometryRevisions1793577600000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive)
      throw new Error('Region history migration requires a transaction');
    await runner.query("SET LOCAL lock_timeout='5s'");
    await runner.query('LOCK TABLE camera IN ACCESS EXCLUSIVE MODE');
    await runner.query(
      'ALTER TABLE camera_observation_region ADD CONSTRAINT uq_region_camera_zone UNIQUE(id,camera_id,zone_id)',
    );
    await runner.query(
      'ALTER TABLE camera_configuration_reference ADD CONSTRAINT uq_camera_configuration_reference_camera_view UNIQUE(id,camera_id,view_revision)',
    );
    await runner.query(`CREATE TABLE camera_region_geometry_revision (
      region_id uuid NOT NULL, geometry_version integer NOT NULL, camera_id uuid NOT NULL, zone_id uuid NOT NULL,
      configuration_version bigint NOT NULL, coordinate_space varchar(32) NOT NULL, polygon jsonb NOT NULL,
      is_active boolean NOT NULL, is_cutover_baseline boolean NOT NULL DEFAULT false,
      reference_id uuid NULL, view_revision bigint NULL, confirmed_by_user_id uuid NULL, confirmed_at timestamptz NULL,
      recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT pk_camera_region_geometry_revision PRIMARY KEY(region_id,geometry_version),
      CONSTRAINT uq_region_revision_camera_configuration UNIQUE(camera_id,configuration_version,region_id),
      CONSTRAINT fk_region_revision_region_camera_zone FOREIGN KEY(region_id,camera_id,zone_id)
        REFERENCES camera_observation_region(id,camera_id,zone_id) ON DELETE RESTRICT,
      CONSTRAINT fk_region_revision_reference_camera_view FOREIGN KEY(reference_id,camera_id,view_revision)
        REFERENCES camera_configuration_reference(id,camera_id,view_revision) ON DELETE RESTRICT,
      CONSTRAINT fk_region_revision_confirmer FOREIGN KEY(confirmed_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT,
      CONSTRAINT chk_region_revision_version CHECK(geometry_version>=1 AND configuration_version BETWEEN 1 AND 9007199254740991),
      CONSTRAINT chk_region_revision_coordinates CHECK(coordinate_space='NORMALIZED_0_1'),
      CONSTRAINT chk_region_revision_times CHECK(isfinite(recorded_at) AND (confirmed_at IS NULL OR (isfinite(confirmed_at) AND confirmed_at<=recorded_at))),
      CONSTRAINT chk_region_revision_provenance CHECK(
        (reference_id IS NULL AND view_revision IS NULL AND confirmed_by_user_id IS NULL AND confirmed_at IS NULL)
        OR (reference_id IS NOT NULL AND view_revision IS NOT NULL AND confirmed_by_user_id IS NOT NULL AND confirmed_at IS NOT NULL)),
      CONSTRAINT chk_region_revision_cutover CHECK(NOT is_cutover_baseline OR reference_id IS NULL))`);
    await runner.query(
      'CREATE INDEX idx_region_revision_zone ON camera_region_geometry_revision(zone_id)',
    );
    await runner.query(
      'CREATE INDEX idx_region_revision_reference ON camera_region_geometry_revision(reference_id,camera_id,view_revision)',
    );
    await runner.query(
      'CREATE INDEX idx_region_revision_confirmer ON camera_region_geometry_revision(confirmed_by_user_id)',
    );
    // Existing rows prove only the current state at cutover, not their earlier history.
    await runner.query(`INSERT INTO camera_region_geometry_revision
      (region_id,geometry_version,camera_id,zone_id,configuration_version,coordinate_space,polygon,is_active,is_cutover_baseline)
      SELECT r.id,r.version,r.camera_id,r.zone_id,c.configuration_version,r.coordinate_space,r.polygon,r.is_active,true
      FROM camera_observation_region r JOIN camera c ON c.id=r.camera_id`);
    await runner.query(`CREATE TRIGGER region_geometry_revision_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
      ON camera_region_geometry_revision FOR EACH STATEMENT EXECUTE FUNCTION protect_camera_reference_provenance()`);
  }

  async down(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive)
      throw new Error('Region history migration requires a transaction');
    await runner.query("SET LOCAL lock_timeout='5s'");
    await runner.query(
      'LOCK TABLE camera, camera_observation_region, camera_region_geometry_revision IN ACCESS EXCLUSIVE MODE',
    );
    const [used] = await runner.query(
      'SELECT EXISTS(SELECT 1 FROM camera_region_geometry_revision) AS present',
    );
    if (used.present) throw new Error('Region revision history must be retained before rollback');
    await runner.query('DROP TABLE camera_region_geometry_revision');
    await runner.query(
      'ALTER TABLE camera_configuration_reference DROP CONSTRAINT uq_camera_configuration_reference_camera_view',
    );
    await runner.query(
      'ALTER TABLE camera_observation_region DROP CONSTRAINT uq_region_camera_zone',
    );
  }
}
