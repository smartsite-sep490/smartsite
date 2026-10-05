import type { MigrationInterface, QueryRunner } from 'typeorm';

export class Mf07Notifications1791417600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE user_notification (
        id uuid CONSTRAINT pk_user_notification PRIMARY KEY,
        recipient_user_id uuid NOT NULL CONSTRAINT fk_notification_user REFERENCES app_user(id) ON DELETE RESTRICT,
        site_id uuid NOT NULL CONSTRAINT fk_notification_site REFERENCES site(id) ON DELETE RESTRICT,
        contractor_id uuid NOT NULL CONSTRAINT fk_notification_contractor REFERENCES contractor(id) ON DELETE RESTRICT,
        worker_id uuid CONSTRAINT fk_notification_worker REFERENCES worker(id) ON DELETE RESTRICT,
        recipient_role varchar(32) NOT NULL,
        request_type varchar(6) NOT NULL,
        request_id uuid NOT NULL,
        event varchar(24) NOT NULL,
        content jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        read_at timestamptz,
        CONSTRAINT uq_notification_event_recipient UNIQUE (recipient_user_id, request_type, request_id, event),
        CONSTRAINT chk_notification_request_type CHECK (request_type IN ('CHANGE', 'SWAP')),
        CONSTRAINT chk_notification_role CHECK (
          (recipient_role = 'WORKER' AND worker_id IS NOT NULL) OR
          (recipient_role = 'CONTRACTOR_REPRESENTATIVE' AND worker_id IS NULL)),
        CONSTRAINT chk_notification_event CHECK (event IN ('CHANGE_REQUESTED', 'SWAP_REQUESTED', 'SWAP_CONFIRMED', 'SWAP_DECLINED', 'REQUEST_APPLIED', 'REQUEST_REJECTED', 'REQUEST_CONFLICTED'))
      )
    `);
    await queryRunner.query(
      'CREATE INDEX idx_notification_recipient_created ON user_notification (recipient_user_id, created_at, id)',
    );
    await queryRunner.query(
      'CREATE INDEX idx_notification_unread ON user_notification (recipient_user_id, created_at) WHERE read_at IS NULL',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE user_notification');
  }
}
