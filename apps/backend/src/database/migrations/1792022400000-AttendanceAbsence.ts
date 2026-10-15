import type { MigrationInterface, QueryRunner } from 'typeorm';

const events =
  "'CHANGE_REQUESTED','SWAP_REQUESTED','SWAP_CONFIRMED','SWAP_DECLINED','REQUEST_APPLIED','REQUEST_REJECTED','REQUEST_CONFLICTED','SAFETY_HANDOVER','EARLY_EXIT','MISSING_CHECKOUT','UNSCHEDULED_ENTRY','ENTRY_DENIED_NO_SCHEDULE','TIME_REQUESTED','TIME_APPROVED','TIME_REJECTED','SCHEDULE_CHANGED','SCHEDULE_CANCELLED'";

export class AttendanceAbsence1792022400000 implements MigrationInterface {
  name = 'AttendanceAbsence1792022400000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE attendance_day DROP CONSTRAINT attendance_day_status_check,
      ADD CONSTRAINT attendance_day_status_check CHECK(status IN ('IN_PROGRESS','NEEDS_REVIEW','CONFIRMED','ABSENT'))`);
    await runner.query(`ALTER TABLE user_notification DROP CONSTRAINT chk_notification_event,
      ADD CONSTRAINT chk_notification_event CHECK(event IN (${events},'ABSENT'))`);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DO $$ BEGIN IF EXISTS(SELECT 1 FROM attendance_day WHERE status='ABSENT')
      OR EXISTS(SELECT 1 FROM user_notification WHERE event='ABSENT') THEN
      RAISE EXCEPTION 'Absence history must be preserved before rollback'; END IF; END $$`);
    await runner.query(`ALTER TABLE attendance_day DROP CONSTRAINT attendance_day_status_check,
      ADD CONSTRAINT attendance_day_status_check CHECK(status IN ('IN_PROGRESS','NEEDS_REVIEW','CONFIRMED'))`);
    await runner.query(`ALTER TABLE user_notification DROP CONSTRAINT chk_notification_event,
      ADD CONSTRAINT chk_notification_event CHECK(event IN (${events}))`);
  }
}
