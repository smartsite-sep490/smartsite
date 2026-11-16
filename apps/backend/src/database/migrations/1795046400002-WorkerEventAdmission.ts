import type { MigrationInterface, QueryRunner } from 'typeorm';

export class WorkerEventAdmission1795046400002 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive)
      throw new Error('Event admission migration requires transaction');
    await runner.query("SET LOCAL lock_timeout='5s'");
    await runner.query(`ALTER TABLE ai_observation_event ADD COLUMN admission_context jsonb NULL
      CONSTRAINT chk_ai_event_admission_object CHECK(admission_context IS NULL OR jsonb_typeof(admission_context)='object')`);
    await runner.query(`CREATE FUNCTION guard_ai_event_admission_context() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.admission_context IS DISTINCT FROM NEW.admission_context THEN
          RAISE EXCEPTION 'Event admission context is immutable' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END $$`);
    await runner.query(`CREATE TRIGGER trg_ai_event_admission_context BEFORE UPDATE ON ai_observation_event
      FOR EACH ROW EXECUTE FUNCTION guard_ai_event_admission_context()`);
  }
  async down(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive)
      throw new Error('Event admission migration requires transaction');
    await runner.query("SET LOCAL lock_timeout='5s'");
    await runner.query('LOCK TABLE ai_observation_event IN ACCESS EXCLUSIVE MODE');
    const [{ n }] = await runner.query(
      'SELECT count(*)::int AS n FROM ai_observation_event WHERE admission_context IS NOT NULL',
    );
    if (n !== 0) throw new Error('Event admission history must be retained');
    await runner.query('DROP TRIGGER trg_ai_event_admission_context ON ai_observation_event');
    await runner.query('DROP FUNCTION guard_ai_event_admission_context()');
    await runner.query('ALTER TABLE ai_observation_event DROP COLUMN admission_context');
  }
}
