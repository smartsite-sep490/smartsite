import type { MigrationInterface, QueryRunner } from 'typeorm';
export class MobilePushDelivery1795478400000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE mobile_push_device(
      id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
      session_id uuid NOT NULL REFERENCES auth_session(id) ON DELETE CASCADE,
      installation_secret_hash varchar(64) NOT NULL, token_hash varchar(64) NOT NULL CONSTRAINT uq_mobile_push_token UNIQUE,
      token_ciphertext text NOT NULL, platform varchar(8) NOT NULL CHECK(platform IN ('ios','android')),
      language varchar(2) NOT NULL CHECK(language IN ('vi','en')), registered_at timestamptz NOT NULL DEFAULT now(),
      revoked_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now())`);
    await q.query(`CREATE INDEX idx_mobile_push_owner ON mobile_push_device(user_id,session_id)`);
    await q.query(`CREATE TABLE mobile_push_delivery(
      device_id uuid NOT NULL REFERENCES mobile_push_device(id) ON DELETE CASCADE,
      notification_id uuid NOT NULL REFERENCES user_notification(id) ON DELETE CASCADE,
      status varchar(12) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SENDING','ACCEPTED','SENT','FAILED','CANCELLED')),
      attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0), ticket_id varchar(255),
      attempted_at timestamptz, next_attempt_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(device_id,notification_id))`);
    await q.query(
      `CREATE INDEX idx_mobile_push_due ON mobile_push_delivery(status,next_attempt_at)`,
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE mobile_push_delivery');
    await q.query('DROP TABLE mobile_push_device');
  }
}
