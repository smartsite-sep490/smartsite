import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AccountFaceTemplates1790899200000 implements MigrationInterface {
  name = 'AccountFaceTemplates1790899200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('worker', 'user_id'))) {
      await queryRunner.query(`
        ALTER TABLE worker ADD COLUMN user_id UUID,
          ADD CONSTRAINT fk_worker_user FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE RESTRICT;
        CREATE UNIQUE INDEX uq_worker_site_user ON worker (site_id, user_id) WHERE user_id IS NOT NULL;
      `);
    }
    await queryRunner.query(`
      ALTER TABLE face_profile ADD COLUMN user_id UUID,
        ADD COLUMN encrypted_template TEXT,
        ADD CONSTRAINT fk_face_profile_user FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE RESTRICT;
      UPDATE face_profile SET status = 'NEEDS_REENROLL' WHERE status = 'ACTIVE';
      ALTER TABLE face_profile ADD CONSTRAINT chk_face_profile_database_template CHECK (
        status <> 'ACTIVE' OR (user_id IS NOT NULL AND encrypted_template IS NOT NULL
          AND length(encrypted_template) BETWEEN 100 AND 32768)
      );
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE face_profile DROP CONSTRAINT chk_face_profile_database_template,
        DROP CONSTRAINT fk_face_profile_user, DROP COLUMN encrypted_template, DROP COLUMN user_id;
    `);
  }
}
