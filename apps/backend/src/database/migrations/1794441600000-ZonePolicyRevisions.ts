import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ZonePolicyRevisions1794441600000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive) throw new Error('Zone policy history requires a transaction');
    await runner.query("SET LOCAL lock_timeout='5s'");
    await runner.query('LOCK TABLE zone IN ACCESS EXCLUSIVE MODE');
    await runner.query(`CREATE TABLE zone_policy_revision (
      zone_id uuid NOT NULL, policy_revision bigint NOT NULL, site_id uuid NOT NULL,
      zone_type varchar(32) NOT NULL, restriction_policy varchar(32) NOT NULL,
      required_ppe text[] NOT NULL, is_cutover_baseline boolean NOT NULL DEFAULT false,
      recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT pk_zone_policy_revision PRIMARY KEY(zone_id,policy_revision),
      CONSTRAINT fk_zone_policy_revision_scope FOREIGN KEY(zone_id,site_id) REFERENCES zone(id,site_id) ON DELETE RESTRICT,
      CONSTRAINT chk_zone_policy_revision_version CHECK(policy_revision BETWEEN 1 AND 9007199254740991),
      CONSTRAINT chk_zone_policy_revision_type CHECK(zone_type IN ('STANDARD','RESTRICTED','HAZARDOUS')),
      CONSTRAINT chk_zone_policy_revision_restriction CHECK(restriction_policy IN ('NONE','PROHIBITED_FOR_ALL','AUTHORIZATION_REQUIRED')),
      CONSTRAINT chk_zone_policy_revision_time CHECK(isfinite(recorded_at)),
      CONSTRAINT chk_zone_policy_revision_ppe CHECK(
        required_ppe <@ ARRAY['HARD_HAT','SAFETY_VEST','GLOVES','BOOTS','GOGGLES']::text[]
        AND array_position(required_ppe,NULL) IS NULL
        AND cardinality(array_positions(required_ppe,'HARD_HAT'))<=1
        AND cardinality(array_positions(required_ppe,'SAFETY_VEST'))<=1
        AND cardinality(array_positions(required_ppe,'GLOVES'))<=1
        AND cardinality(array_positions(required_ppe,'BOOTS'))<=1
        AND cardinality(array_positions(required_ppe,'GOGGLES'))<=1))`);
    await runner.query(
      'CREATE INDEX idx_zone_policy_revision_site_time ON zone_policy_revision(site_id,recorded_at)',
    );
    await runner.query(`INSERT INTO zone_policy_revision
      (zone_id,policy_revision,site_id,zone_type,restriction_policy,required_ppe,is_cutover_baseline)
      SELECT id,1,site_id,type::text,restriction_policy::text,required_ppe,true FROM zone`);
    await runner.query(`CREATE FUNCTION protect_zone_policy_history() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE populated boolean;
      BEGIN
        IF TG_OP='TRUNCATE' THEN
          EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I)',TG_TABLE_SCHEMA,TG_TABLE_NAME) INTO populated;
          IF NOT populated THEN RETURN NULL; END IF;
        END IF;
        RAISE EXCEPTION 'Zone policy history is immutable' USING ERRCODE='23514';
      END $$`);
    await runner.query(`CREATE TRIGGER zone_policy_revision_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
      ON zone_policy_revision FOR EACH STATEMENT EXECUTE FUNCTION protect_zone_policy_history()`);
  }

  async down(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive) throw new Error('Zone policy history requires a transaction');
    await runner.query("SET LOCAL lock_timeout='5s'");
    await runner.query('LOCK TABLE zone, zone_policy_revision IN ACCESS EXCLUSIVE MODE');
    const [used] = await runner.query(
      'SELECT EXISTS(SELECT 1 FROM zone_policy_revision) AS present',
    );
    if (used.present) throw new Error('Zone policy history must be retained before rollback');
    await runner.query('DROP TABLE zone_policy_revision');
    await runner.query('DROP FUNCTION protect_zone_policy_history()');
  }
}
