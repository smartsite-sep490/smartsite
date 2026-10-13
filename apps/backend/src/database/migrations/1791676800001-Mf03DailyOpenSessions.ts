import type { MigrationInterface, QueryRunner } from 'typeorm';
export class Mf03DailyOpenSessions1791676800001 implements MigrationInterface {
  name = 'Mf03DailyOpenSessions1791676800001';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP INDEX uq_attendance_session_open;
      CREATE UNIQUE INDEX uq_attendance_session_open ON attendance_session(site_id,worker_id,day_id) WHERE check_out_event_id IS NULL AND effective_out_at IS NULL AND day_id IS NOT NULL;
      CREATE UNIQUE INDEX uq_attendance_session_legacy_open ON attendance_session(site_id,worker_id) WHERE check_out_event_id IS NULL AND effective_out_at IS NULL AND day_id IS NULL;`);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DO $$ BEGIN IF EXISTS(SELECT 1 FROM attendance_session WHERE check_out_event_id IS NULL AND effective_out_at IS NULL GROUP BY site_id,worker_id HAVING count(*)>1) THEN RAISE EXCEPTION 'MF03 downgrade refused: unresolved daily sessions must be preserved'; END IF; END $$;
      DROP INDEX uq_attendance_session_open;DROP INDEX uq_attendance_session_legacy_open;
      CREATE UNIQUE INDEX uq_attendance_session_open ON attendance_session(site_id,worker_id) WHERE check_out_event_id IS NULL AND effective_out_at IS NULL;`);
  }
}
