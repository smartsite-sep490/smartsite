import type { MigrationInterface, QueryRunner } from 'typeorm';
export class TeamZonePermissions1791940000000 implements MigrationInterface {
  async up(r: QueryRunner): Promise<void> {
    await r.query(`CREATE TABLE team_zone_permission (
      id uuid CONSTRAINT pk_team_zone_permission PRIMARY KEY,
      team_id uuid NOT NULL CONSTRAINT fk_team_zone_team REFERENCES contractor_team(id) ON DELETE RESTRICT,
      contractor_zone_permission_id uuid NOT NULL CONSTRAINT fk_team_zone_parent REFERENCES contractor_zone_permission(id) ON DELETE RESTRICT,
      valid_from timestamptz NOT NULL, valid_until timestamptz NOT NULL,
      granted_by uuid NOT NULL CONSTRAINT fk_team_zone_granter REFERENCES app_user(id) ON DELETE RESTRICT,
      revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ck_team_zone_interval CHECK(valid_until > valid_from))`);
    await r.query(
      'CREATE INDEX idx_team_zone_lookup ON team_zone_permission(team_id,contractor_zone_permission_id)',
    );
    await r.query(`CREATE FUNCTION validate_team_zone_scope() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM contractor_team t JOIN contractor_site_participation p ON p.site_id=t.site_id AND p.contractor_id=t.contractor_id JOIN contractor_zone_permission cp ON cp.site_contractor_id=p.id JOIN zone z ON z.id=cp.zone_id AND z.site_id=t.site_id WHERE t.id=NEW.team_id AND cp.id=NEW.contractor_zone_permission_id AND NEW.valid_from>=cp.valid_from AND NEW.valid_until<=cp.valid_until AND NEW.valid_from>=p.valid_from AND (p.valid_until IS NULL OR NEW.valid_until<=p.valid_until)) THEN
        RAISE EXCEPTION 'Invalid team Zone scope or interval' USING ERRCODE='23514'; END IF;
      RETURN NEW; END $$`);
    await r.query(
      'CREATE TRIGGER trg_team_zone_scope BEFORE INSERT OR UPDATE OF team_id,contractor_zone_permission_id,valid_from,valid_until ON team_zone_permission FOR EACH ROW EXECUTE FUNCTION validate_team_zone_scope()',
    );
  }
  async down(r: QueryRunner): Promise<void> {
    // Preserve configured permissions rather than silently losing access history.
    const [row] = (await r.query('SELECT count(*)::int AS total FROM team_zone_permission')) as {
      total: number;
    }[];
    if (row!.total)
      throw new Error('Team Zone rollback requires an explicit data preservation plan');
    await r.query('DROP TABLE team_zone_permission');
    await r.query('DROP FUNCTION validate_team_zone_scope()');
  }
}
