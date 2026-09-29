import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ScopedJwtAuthentication1790553600000 implements MigrationInterface {
  name = 'ScopedJwtAuthentication1790553600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE auth_session');
    await queryRunner.query(`
      CREATE TABLE user_role_assignment (
        id UUID NOT NULL,
        user_id UUID NOT NULL,
        role VARCHAR(32) NOT NULL,
        site_id UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_user_role_assignment_id PRIMARY KEY (id),
        CONSTRAINT fk_user_role_assignment_user FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE,
        CONSTRAINT fk_user_role_assignment_site FOREIGN KEY (site_id) REFERENCES site(id) ON DELETE RESTRICT,
        CONSTRAINT chk_user_role_assignment_role CHECK (role IN ('ADMIN', 'SITE_MANAGER', 'CONTRACTOR_REPRESENTATIVE', 'SAFETY_OFFICER', 'SECURITY_OFFICER', 'WORKER')),
        CONSTRAINT chk_user_role_assignment_scope CHECK (
          (role = 'ADMIN' AND site_id IS NULL) OR (role <> 'ADMIN' AND site_id IS NOT NULL)
        )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_user_role_assignment_global
      ON user_role_assignment(user_id, role) WHERE site_id IS NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_user_role_assignment_scoped
      ON user_role_assignment(user_id, role, site_id) WHERE site_id IS NOT NULL
    `);
    await queryRunner.query(
      'CREATE INDEX idx_user_role_assignment_user ON user_role_assignment(user_id)',
    );
    await queryRunner.query(
      'CREATE INDEX idx_user_role_assignment_site ON user_role_assignment(site_id) WHERE site_id IS NOT NULL',
    );
    await queryRunner.query(`
      INSERT INTO user_role_assignment (id, user_id, role, site_id)
      SELECT gen_random_uuid(), id, 'ADMIN', NULL FROM app_user WHERE role = 'ADMIN'
    `);
    await queryRunner.query("UPDATE app_user SET is_active = FALSE WHERE role = 'WORKER'");
    await queryRunner.query('ALTER TABLE app_user DROP CONSTRAINT chk_app_user_role');
    await queryRunner.query('ALTER TABLE app_user DROP COLUMN role');
    await queryRunner.query(`
      CREATE TABLE auth_session (
        id UUID NOT NULL,
        user_id UUID NOT NULL,
        client_type VARCHAR(8) NOT NULL,
        refresh_token_hash VARCHAR(64) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_refreshed_at TIMESTAMPTZ NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        CONSTRAINT pk_auth_session_id PRIMARY KEY (id),
        CONSTRAINT fk_auth_session_user FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE,
        CONSTRAINT chk_auth_session_client_type CHECK (client_type IN ('WEB', 'MOBILE'))
      )
    `);
    await queryRunner.query('CREATE INDEX idx_auth_session_user ON auth_session(user_id)');
    await queryRunner.query('CREATE INDEX idx_auth_session_expires ON auth_session(expires_at)');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM user_role_assignment WHERE role <> 'ADMIN') THEN
          RAISE EXCEPTION 'Cannot roll back scoped authentication while scoped assignments exist';
        END IF;
      END $$
    `);
    await queryRunner.query('DROP TABLE auth_session');
    await queryRunner.query('ALTER TABLE app_user ADD COLUMN role VARCHAR(16)');
    await queryRunner.query(`
      UPDATE app_user user_account
      SET role = CASE WHEN EXISTS (
        SELECT 1 FROM user_role_assignment assignment
        WHERE assignment.user_id = user_account.id AND assignment.role = 'ADMIN'
      ) THEN 'ADMIN' ELSE 'WORKER' END
    `);
    await queryRunner.query('ALTER TABLE app_user ALTER COLUMN role SET NOT NULL');
    await queryRunner.query(
      "ALTER TABLE app_user ADD CONSTRAINT chk_app_user_role CHECK (role IN ('ADMIN', 'WORKER'))",
    );
    await queryRunner.query('DROP TABLE user_role_assignment');
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
}
