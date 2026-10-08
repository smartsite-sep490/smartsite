import type { MigrationInterface, QueryRunner } from 'typeorm';
export class ErdZonePermissions1791504000003 implements MigrationInterface {
  async up(runner: QueryRunner) {
    await runner.query(`CREATE TABLE contractor_zone_permission(
      id uuid CONSTRAINT pk_contractor_zone_permission_id PRIMARY KEY,
      site_contractor_id uuid NOT NULL CONSTRAINT fk_contractor_zone_participation REFERENCES contractor_site_participation(id) ON DELETE RESTRICT,
      zone_id uuid NOT NULL CONSTRAINT fk_contractor_zone_zone REFERENCES zone(id) ON DELETE RESTRICT,
      valid_from timestamptz NOT NULL,valid_until timestamptz NOT NULL,
      granted_by uuid NOT NULL CONSTRAINT fk_contractor_zone_granter REFERENCES app_user(id) ON DELETE RESTRICT,
      revoked_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),CONSTRAINT ck_contractor_zone_interval CHECK(valid_until>valid_from));
      CREATE UNIQUE INDEX uq_contractor_zone_interval ON contractor_zone_permission(site_contractor_id,zone_id,valid_from);
      CREATE TABLE worker_zone_permission(
      id uuid CONSTRAINT pk_worker_zone_permission_id PRIMARY KEY,
      worker_assignment_id uuid NOT NULL CONSTRAINT fk_worker_zone_assignment REFERENCES worker_site_zone_assignment(id) ON DELETE RESTRICT,
      contractor_zone_permission_id uuid NOT NULL CONSTRAINT fk_worker_zone_contractor_permission REFERENCES contractor_zone_permission(id) ON DELETE RESTRICT,
      valid_from timestamptz NOT NULL,valid_until timestamptz NOT NULL,
      granted_by uuid NOT NULL CONSTRAINT fk_worker_zone_granter REFERENCES app_user(id) ON DELETE RESTRICT,
      revoked_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),CONSTRAINT ck_worker_zone_interval CHECK(valid_until>valid_from));
      CREATE UNIQUE INDEX uq_worker_zone_interval ON worker_zone_permission(worker_assignment_id,contractor_zone_permission_id,valid_from);
      ALTER TABLE worker_gate_permission ADD COLUMN worker_assignment_id uuid CONSTRAINT fk_gate_permission_assignment REFERENCES worker_site_zone_assignment(id) ON DELETE RESTRICT;
      UPDATE worker_gate_permission g SET worker_assignment_id=(SELECT a.id FROM worker_site_zone_assignment a WHERE a.worker_id=g.worker_id AND a.site_id=g.site_id AND a.status='APPROVED' AND a.valid_until IS NOT NULL AND a.valid_until>now() ORDER BY a.valid_from DESC,a.id LIMIT 1);`);
  }
  async down(runner: QueryRunner) {
    await runner.query(`DO $$ BEGIN IF EXISTS(SELECT 1 FROM worker_zone_permission) OR EXISTS(SELECT 1 FROM contractor_zone_permission) THEN RAISE EXCEPTION 'Zone permission history cannot be discarded'; END IF; END $$;
      ALTER TABLE worker_gate_permission DROP COLUMN worker_assignment_id;
      DROP TABLE worker_zone_permission; DROP TABLE contractor_zone_permission;`);
  }
}
