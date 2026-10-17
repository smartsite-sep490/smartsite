import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Preserve recipients written before contractor ownership was restored for MF07. */
export class PreserveManagerNotificationHistory1792368000000 implements MigrationInterface {
  name = 'PreserveManagerNotificationHistory1792368000000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE user_notification DROP CONSTRAINT chk_notification_role');
    await runner.query(`ALTER TABLE user_notification ADD CONSTRAINT chk_notification_role CHECK (
      (recipient_role='WORKER' AND worker_id IS NOT NULL) OR
      (recipient_role IN ('CONTRACTOR_REPRESENTATIVE','SAFETY_OFFICER','SITE_MANAGER') AND worker_id IS NULL))`);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE user_notification DROP CONSTRAINT chk_notification_role');
    // PostgreSQL rejects this CHECK if historical Manager recipients still exist.
    await runner.query(`ALTER TABLE user_notification ADD CONSTRAINT chk_notification_role CHECK (
      (recipient_role='WORKER' AND worker_id IS NOT NULL) OR
      (recipient_role IN ('CONTRACTOR_REPRESENTATIVE','SAFETY_OFFICER') AND worker_id IS NULL))`);
  }
}
