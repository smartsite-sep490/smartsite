import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ZoneSoftDeletion1794355200000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE zone ADD COLUMN deleted_at timestamptz');
    // Serialize new references against deletion, including callers that validated before deletion.
    await runner.query(`CREATE FUNCTION guard_live_zone_reference() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE zone_uuid uuid; removed_at timestamptz;
      BEGIN
        IF TG_TABLE_NAME='worker_site_zone_assignment' THEN
          FOREACH zone_uuid IN ARRAY NEW.zone_ids LOOP
            SELECT deleted_at INTO removed_at FROM zone WHERE id=zone_uuid FOR SHARE;
            IF removed_at IS NOT NULL THEN RAISE EXCEPTION 'Zone is unavailable' USING ERRCODE='23514'; END IF;
          END LOOP;
        ELSE
          PERFORM id FROM zone WHERE id=NEW.zone_id AND deleted_at IS NULL FOR SHARE;
          IF NOT FOUND THEN RAISE EXCEPTION 'Zone is unavailable' USING ERRCODE='23514'; END IF;
        END IF;
        RETURN NEW;
      END $$`);
    for (const table of [
      'contractor_zone_permission',
      'camera_observation_region',
      'zone_access_grant',
      'visit_zone',
    ]) {
      await runner.query(
        `CREATE TRIGGER guard_live_zone BEFORE INSERT OR UPDATE OF zone_id ON ${table} FOR EACH ROW EXECUTE FUNCTION guard_live_zone_reference()`,
      );
    }
    await runner.query(
      `CREATE TRIGGER guard_live_zone BEFORE INSERT OR UPDATE OF zone_ids ON worker_site_zone_assignment FOR EACH ROW EXECUTE FUNCTION guard_live_zone_reference()`,
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    for (const table of [
      'contractor_zone_permission',
      'camera_observation_region',
      'zone_access_grant',
      'visit_zone',
      'worker_site_zone_assignment',
    ]) {
      await runner.query(`DROP TRIGGER guard_live_zone ON ${table}`);
    }
    await runner.query('DROP FUNCTION guard_live_zone_reference()');
    await runner.query('ALTER TABLE zone DROP COLUMN deleted_at');
  }
}
