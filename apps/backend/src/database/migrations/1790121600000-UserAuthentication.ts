import type { MigrationInterface, QueryRunner } from 'typeorm';

export class UserAuthentication1790121600000 implements MigrationInterface {
  name = 'UserAuthentication1790121600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE app_user (
        id UUID NOT NULL,
        username VARCHAR(64) NOT NULL,
        display_name VARCHAR(255) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(16) NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_app_user_id PRIMARY KEY (id),
        CONSTRAINT uq_app_user_username UNIQUE (username),
        CONSTRAINT chk_app_user_role CHECK (role IN ('ADMIN', 'WORKER'))
      )
    `);
    await queryRunner.query(`
      CREATE TABLE auth_session (
        token_hash VARCHAR(64) NOT NULL,
        user_id UUID NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL,
        CONSTRAINT pk_auth_session_token_hash PRIMARY KEY (token_hash),
        CONSTRAINT fk_auth_session_user FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query('CREATE INDEX idx_auth_session_user ON auth_session(user_id)');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE auth_session');
    await queryRunner.query('DROP TABLE app_user');
  }
}
