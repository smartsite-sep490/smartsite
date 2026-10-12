import type { MigrationInterface, QueryRunner } from 'typeorm';

const oldEvents =
  "'CHANGE_REQUESTED','SWAP_REQUESTED','SWAP_CONFIRMED','SWAP_DECLINED','REQUEST_APPLIED','REQUEST_REJECTED','REQUEST_CONFLICTED','SAFETY_HANDOVER','EARLY_EXIT','MISSING_CHECKOUT','UNSCHEDULED_ENTRY','ENTRY_DENIED_NO_SCHEDULE','TIME_REQUESTED','TIME_APPROVED','TIME_REJECTED'";
export class ScheduleChangeNotifications1791849600002 implements MigrationInterface {
  name = 'ScheduleChangeNotifications1791849600002';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE user_notification
      DROP CONSTRAINT chk_notification_request_type,
      ADD CONSTRAINT chk_notification_request_type CHECK (request_type IN ('CHANGE','SWAP','SAFETY','ATTENDANCE','SCHEDULE')),
      DROP CONSTRAINT chk_notification_event,
      ADD CONSTRAINT chk_notification_event CHECK (event IN (${oldEvents},'SCHEDULE_CHANGED','SCHEDULE_CANCELLED')),
      ADD CONSTRAINT chk_notification_schedule_target CHECK (
        (request_type <> 'SCHEDULE' AND event NOT IN ('SCHEDULE_CHANGED','SCHEDULE_CANCELLED')) OR
        (request_type = 'SCHEDULE' AND event IN ('SCHEDULE_CHANGED','SCHEDULE_CANCELLED') AND recipient_role = 'WORKER'
          AND COALESCE(content->>'workDate','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'))`);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      `DO $$ BEGIN IF EXISTS (SELECT 1 FROM user_notification WHERE request_type='SCHEDULE') THEN RAISE EXCEPTION 'Schedule notification history must be preserved'; END IF; END $$`,
    );
    await runner.query(`ALTER TABLE user_notification
      DROP CONSTRAINT chk_notification_schedule_target,
      DROP CONSTRAINT chk_notification_event,
      ADD CONSTRAINT chk_notification_event CHECK (event IN (${oldEvents})),
      DROP CONSTRAINT chk_notification_request_type,
      ADD CONSTRAINT chk_notification_request_type CHECK (request_type IN ('CHANGE','SWAP','SAFETY','ATTENDANCE'))`);
  }
}
