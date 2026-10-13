import type { MigrationInterface, QueryRunner } from 'typeorm';

const oldEvents =
  "'CHANGE_REQUESTED', 'SWAP_REQUESTED', 'SWAP_CONFIRMED', 'SWAP_DECLINED', 'REQUEST_APPLIED', 'REQUEST_REJECTED', 'REQUEST_CONFLICTED','SAFETY_HANDOVER','EARLY_EXIT','MISSING_CHECKOUT','UNSCHEDULED_ENTRY','TIME_REQUESTED','TIME_APPROVED','TIME_REJECTED'";
export class GateScheduleDenial1791849600000 implements MigrationInterface {
  name = 'GateScheduleDenial1791849600000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE user_notification DROP CONSTRAINT chk_notification_event,
      ADD CONSTRAINT chk_notification_event CHECK (event IN ('CHANGE_REQUESTED', 'SWAP_REQUESTED', 'SWAP_CONFIRMED', 'SWAP_DECLINED', 'REQUEST_APPLIED', 'REQUEST_REJECTED', 'REQUEST_CONFLICTED','SAFETY_HANDOVER','EARLY_EXIT','MISSING_CHECKOUT','UNSCHEDULED_ENTRY','ENTRY_DENIED_NO_SCHEDULE','TIME_REQUESTED','TIME_APPROVED','TIME_REJECTED'))`);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(
      `DO $$ BEGIN IF EXISTS (SELECT 1 FROM user_notification WHERE event='ENTRY_DENIED_NO_SCHEDULE') THEN RAISE EXCEPTION 'Gate denial notification history must be preserved'; END IF; END $$`,
    );
    await runner.query(
      `ALTER TABLE user_notification DROP CONSTRAINT chk_notification_event, ADD CONSTRAINT chk_notification_event CHECK (event IN (${oldEvents}))`,
    );
  }
}
