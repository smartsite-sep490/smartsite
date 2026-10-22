import type { MigrationInterface, QueryRunner } from 'typeorm';
import { ZONE_ALERT_NOTIFICATION_TARGET_V1 } from '../constraints/zone-alert-notification-v1.js';
import { ExpandedPpeNotificationKinds1793145600000 } from './1793145600000-ExpandedPpeNotificationKinds.js';

export class ZoneAlertNotifications1793318400000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive)
      throw new Error('Zone notification migration requires a transaction');
    const constraints: { name: string; expression: string }[] = await runner.query(
      `SELECT conname AS name,pg_get_expr(conbin,conrelid) AS expression FROM pg_constraint
       WHERE conrelid='user_notification'::regclass
       AND conname IN ('chk_notification_event','chk_notification_ppe_target')`,
    );
    const event = constraints.find((c) => c.name === 'chk_notification_event')?.expression;
    const target = constraints.find((c) => c.name === 'chk_notification_ppe_target')?.expression;
    if (
      !event?.includes('PPE_ALERT_CREATED') ||
      !target?.includes('PPE_GOGGLES_MISSING') ||
      event.includes('ZONE_ALERT_CREATED') ||
      target.includes('ZONE_ALERT_CREATED')
    )
      throw new Error('Unexpected notification predecessor constraints');
    await runner.query(`SET LOCAL lock_timeout='5s'`);
    await runner.query(`ALTER TABLE user_notification
      DROP CONSTRAINT chk_notification_event,
      DROP CONSTRAINT chk_notification_ppe_target,
      ADD CONSTRAINT chk_notification_event CHECK((${event}) OR event='ZONE_ALERT_CREATED'),
      ADD CONSTRAINT chk_notification_ppe_target CHECK(
        ((event<>'ZONE_ALERT_CREATED' AND (${target})) OR (${ZONE_ALERT_NOTIFICATION_TARGET_V1})) IS TRUE)`);
  }

  async down(runner: QueryRunner): Promise<void> {
    if (!runner.isTransactionActive)
      throw new Error('Zone notification migration requires a transaction');
    const [used] = await runner.query(
      `SELECT EXISTS(SELECT 1 FROM user_notification WHERE event='ZONE_ALERT_CREATED') AS present`,
    );
    if (used.present) throw new Error('Zone notification history must be retained before rollback');
    await runner.query(`SET LOCAL lock_timeout='5s'`);
    await new ExpandedPpeNotificationKinds1793145600000().up(runner);
    await runner.query(`ALTER TABLE user_notification DROP CONSTRAINT chk_notification_event,
      ADD CONSTRAINT chk_notification_event CHECK(event IN
      ('CHANGE_REQUESTED','SWAP_REQUESTED','SWAP_CONFIRMED','SWAP_DECLINED','REQUEST_APPLIED','REQUEST_REJECTED',
       'REQUEST_CONFLICTED','SAFETY_HANDOVER','EARLY_EXIT','MISSING_CHECKOUT','ABSENT','UNSCHEDULED_ENTRY',
       'ENTRY_DENIED_NO_SCHEDULE','TIME_REQUESTED','TIME_APPROVED','TIME_REJECTED','SCHEDULE_CHANGED','SCHEDULE_CANCELLED',
       'CHECKLIST_ASSIGNED','CHECKLIST_SUBMITTED','CHECKLIST_RETURNED','CHECKLIST_RECORDED','EXIT_DURATION_EXCEEDED',
       'MAX_EXITS_EXCEEDED','DOCUMENT_SUBMITTED','DOCUMENT_APPROVED','DOCUMENT_REJECTED','DOCUMENT_EXPIRING',
       'DOCUMENT_EXPIRED','PPE_ALERT_CREATED'))`);
  }
}
