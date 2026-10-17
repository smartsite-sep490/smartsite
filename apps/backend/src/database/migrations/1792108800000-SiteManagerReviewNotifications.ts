import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SiteManagerReviewNotifications1792108800000 implements MigrationInterface {
  name = 'SiteManagerReviewNotifications1792108800000';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE user_notification DROP CONSTRAINT chk_notification_role`);
    await queryRunner.query(`ALTER TABLE user_notification ADD CONSTRAINT chk_notification_role CHECK (
      (recipient_role = 'WORKER' AND worker_id IS NOT NULL) OR
      (recipient_role IN ('CONTRACTOR_REPRESENTATIVE', 'SAFETY_OFFICER', 'SITE_MANAGER') AND worker_id IS NULL))`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    // Refuse rollback while Manager notifications exist, preserving delivery history.
    await queryRunner.query(`ALTER TABLE user_notification DROP CONSTRAINT chk_notification_role`);
    await queryRunner.query(`ALTER TABLE user_notification ADD CONSTRAINT chk_notification_role CHECK (
      (recipient_role = 'WORKER' AND worker_id IS NOT NULL) OR
      (recipient_role IN ('CONTRACTOR_REPRESENTATIVE','SAFETY_OFFICER') AND worker_id IS NULL))`);
  }
}
