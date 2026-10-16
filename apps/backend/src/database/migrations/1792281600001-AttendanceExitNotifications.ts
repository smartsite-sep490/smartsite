import type { MigrationInterface, QueryRunner } from 'typeorm';

const previousEvents =
  "'CHANGE_REQUESTED','SWAP_REQUESTED','SWAP_CONFIRMED','SWAP_DECLINED','REQUEST_APPLIED','REQUEST_REJECTED','REQUEST_CONFLICTED','SAFETY_HANDOVER','EARLY_EXIT','MISSING_CHECKOUT','ABSENT','UNSCHEDULED_ENTRY','ENTRY_DENIED_NO_SCHEDULE','TIME_REQUESTED','TIME_APPROVED','TIME_REJECTED','SCHEDULE_CHANGED','SCHEDULE_CANCELLED','CHECKLIST_ASSIGNED','CHECKLIST_SUBMITTED','CHECKLIST_RETURNED','CHECKLIST_RECORDED'";

export class AttendanceExitNotifications1792281600001 implements MigrationInterface {
  name = 'AttendanceExitNotifications1792281600001';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE user_notification DROP CONSTRAINT chk_notification_event,
      ADD CONSTRAINT chk_notification_event CHECK(event IN (${previousEvents},'EXIT_DURATION_EXCEEDED','MAX_EXITS_EXCEEDED'))`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DO $$ BEGIN
      IF EXISTS(SELECT 1 FROM user_notification WHERE event IN ('EXIT_DURATION_EXCEEDED','MAX_EXITS_EXCEEDED')) THEN
        RAISE EXCEPTION 'Exit violation history must be preserved before rollback';
      END IF;
    END $$`);
    await runner.query(`ALTER TABLE user_notification DROP CONSTRAINT chk_notification_event,
      ADD CONSTRAINT chk_notification_event CHECK(event IN (${previousEvents}))`);
  }
}
