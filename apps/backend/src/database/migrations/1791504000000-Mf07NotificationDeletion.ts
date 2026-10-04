import type { MigrationInterface, QueryRunner } from 'typeorm';

export class Mf07NotificationDeletion1791504000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE user_notification ADD COLUMN deleted_at timestamptz');
    await queryRunner.query(`ALTER TABLE user_notification
      ADD CONSTRAINT chk_notification_deleted_read CHECK (deleted_at IS NULL OR read_at IS NOT NULL)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE user_notification DROP CONSTRAINT chk_notification_deleted_read',
    );
    await queryRunner.query('ALTER TABLE user_notification DROP COLUMN deleted_at');
  }
}
