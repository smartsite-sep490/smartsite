import type { MigrationInterface, QueryRunner } from 'typeorm';

export class Mf07WorkforceAccessScope1790812800000 implements MigrationInterface {
  name = 'Mf07WorkforceAccessScope1790812800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE contractor_representative_assignment (
        id uuid NOT NULL,
        site_id uuid NOT NULL,
        contractor_id uuid NOT NULL,
        user_id uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_contractor_representative_assignment_id PRIMARY KEY (id),
        CONSTRAINT uq_contractor_representative_assignment UNIQUE (site_id, contractor_id, user_id),
        CONSTRAINT fk_contractor_representative_assignment_site
          FOREIGN KEY (site_id) REFERENCES site(id) ON DELETE RESTRICT,
        CONSTRAINT fk_contractor_representative_assignment_contractor
          FOREIGN KEY (contractor_id) REFERENCES contractor(id) ON DELETE RESTRICT,
        CONSTRAINT fk_contractor_representative_assignment_user
          FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_contractor_representative_user_site
      ON contractor_representative_assignment (user_id, site_id)
    `);

    // AccountFaceTemplates may already own this column on a main-first database.
    if (!(await queryRunner.hasColumn('worker', 'user_id'))) {
      await queryRunner.query('ALTER TABLE worker ADD COLUMN user_id uuid');
      await queryRunner.query(`
        ALTER TABLE worker ADD CONSTRAINT fk_worker_user
        FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE RESTRICT
      `);
      await queryRunner.query(`
        CREATE UNIQUE INDEX uq_worker_site_user ON worker (site_id, user_id)
        WHERE user_id IS NOT NULL
      `);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Keep the shared account link; the Face/Identity migration also depends on it.
    await queryRunner.query('DROP INDEX IF EXISTS idx_contractor_representative_user_site');
    await queryRunner.query('DROP TABLE IF EXISTS contractor_representative_assignment');
  }
}
