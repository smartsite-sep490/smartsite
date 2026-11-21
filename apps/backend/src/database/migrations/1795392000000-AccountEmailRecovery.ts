import type { MigrationInterface, QueryRunner } from 'typeorm';
export class AccountEmailRecovery1795392000000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE app_user ADD COLUMN email varchar(254), ADD COLUMN email_verified_at timestamptz,
      ADD CONSTRAINT ck_user_email_normalized CHECK(email IS NULL OR (email=lower(trim(email)) AND length(email)>3)),
      ADD CONSTRAINT ck_user_email_verified CHECK(email_verified_at IS NULL OR email IS NOT NULL)`);
    await q.query(`CREATE UNIQUE INDEX uq_user_email ON app_user(email) WHERE email IS NOT NULL`);
    await q.query(`CREATE TABLE account_email_challenge(
      id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
      email varchar(254) NOT NULL, purpose varchar(12) NOT NULL CHECK(purpose IN ('VERIFY','RESET')),
      token_hash varchar(64) NOT NULL, attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
      expires_at timestamptz NOT NULL, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now())`);
    await q.query(
      `CREATE INDEX idx_account_email_challenge ON account_email_challenge(user_id,purpose,created_at DESC)`,
    );
    await q.query(`CREATE TABLE account_email_outbox(
      id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
      challenge_id uuid NOT NULL REFERENCES account_email_challenge(id) ON DELETE CASCADE,
      recipient varchar(254) NOT NULL, payload_ciphertext text,
      status varchar(12) NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SENDING','SENT','FAILED','CANCELLED')),
      attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0), next_attempt_at timestamptz NOT NULL DEFAULT now(),
      attempted_at timestamptz, sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now())`);
    await q.query(
      `CREATE INDEX idx_account_email_outbox_due ON account_email_outbox(status,next_attempt_at)`,
    );
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE account_email_outbox');
    await q.query('DROP TABLE account_email_challenge');
    await q.query('DROP INDEX uq_user_email');
    await q.query('ALTER TABLE app_user DROP COLUMN email_verified_at, DROP COLUMN email');
  }
}
