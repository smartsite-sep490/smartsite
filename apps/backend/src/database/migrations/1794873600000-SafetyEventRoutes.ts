import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SafetyEventRoutes1794873600000 implements MigrationInterface {
  private async scope(runner: QueryRunner): Promise<string> {
    if (!runner.isTransactionActive)
      throw new Error('Safety route migration requires a transaction');
    const [row]: { schema: string }[] = await runner.query('SELECT current_schema() AS schema');
    if (
      !row?.schema ||
      row.schema !== runner.connection.driver.schema ||
      row.schema.includes('\0') ||
      Buffer.byteLength(row.schema) > 63 ||
      /^(pg_|information_schema$)/i.test(row.schema)
    )
      throw new Error('Invalid safety route schema');
    return '"' + row.schema.replaceAll('"', '""') + '"';
  }

  async up(runner: QueryRunner): Promise<void> {
    const scope = await this.scope(runner);
    await runner.query("SET LOCAL lock_timeout='5s'");
    await runner.query(`ALTER TABLE ${scope}.ai_observation_event
      ADD COLUMN safety_route_mode varchar(24) NULL,
      ADD COLUMN safety_route_epoch uuid NULL,
      ADD CONSTRAINT chk_ai_event_safety_route_pair CHECK ((safety_route_mode IS NULL) = (safety_route_epoch IS NULL)),
      ADD CONSTRAINT chk_ai_event_safety_route_mode CHECK (safety_route_mode IS NULL OR safety_route_mode IN ('LEGACY','EPISODE_EVENT_LOCAL'))`);
    await runner.query(`CREATE FUNCTION ${scope}.guard_ai_event_safety_route() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.safety_route_mode IS DISTINCT FROM NEW.safety_route_mode
          OR OLD.safety_route_epoch IS DISTINCT FROM NEW.safety_route_epoch THEN
          RAISE EXCEPTION 'Safety event route is immutable' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END $$`);
    await runner.query(`CREATE TRIGGER trg_ai_event_safety_route BEFORE UPDATE ON ${scope}.ai_observation_event
      FOR EACH ROW EXECUTE FUNCTION ${scope}.guard_ai_event_safety_route()`);
  }

  async down(runner: QueryRunner): Promise<void> {
    const scope = await this.scope(runner);
    await runner.query("SET LOCAL lock_timeout='5s'");
    await runner.query(`LOCK TABLE ${scope}.ai_observation_event IN ACCESS EXCLUSIVE MODE`);
    const [used]: { present: boolean }[] = await runner.query(`SELECT EXISTS(
      SELECT 1 FROM ${scope}.ai_observation_event WHERE safety_route_mode IS NOT NULL OR safety_route_epoch IS NOT NULL) AS present`);
    if (used?.present) throw new Error('Safety route history must be preserved before rollback');
    await runner.query(`DROP TRIGGER trg_ai_event_safety_route ON ${scope}.ai_observation_event`);
    await runner.query(`DROP FUNCTION ${scope}.guard_ai_event_safety_route()`);
    await runner.query(`ALTER TABLE ${scope}.ai_observation_event
      DROP CONSTRAINT chk_ai_event_safety_route_pair, DROP CONSTRAINT chk_ai_event_safety_route_mode,
      DROP COLUMN safety_route_mode, DROP COLUMN safety_route_epoch`);
  }
}
