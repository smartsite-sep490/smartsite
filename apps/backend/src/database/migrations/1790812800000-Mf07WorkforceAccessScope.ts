import type { MigrationInterface, QueryRunner } from 'typeorm';

export class Mf07WorkforceAccessScope1790812800000 implements MigrationInterface {
  name = 'Mf07WorkforceAccessScope1790812800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE contractor (
        id uuid NOT NULL,
        site_id uuid NOT NULL,
        code varchar(64) NOT NULL,
        name varchar(255) NOT NULL,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_contractor_id PRIMARY KEY (id),
        CONSTRAINT uq_contractor_site_code UNIQUE (site_id, code),
        CONSTRAINT fk_contractor_site FOREIGN KEY (site_id) REFERENCES site(id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query('CREATE INDEX idx_contractor_site_active ON contractor (site_id, is_active)');

    await queryRunner.query(`
      CREATE TABLE contractor_representative_assignment (
        id uuid NOT NULL,
        site_id uuid NOT NULL,
        contractor_id uuid NOT NULL,
        user_id uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_contractor_representative_assignment_id PRIMARY KEY (id),
        CONSTRAINT uq_contractor_representative_assignment UNIQUE (contractor_id, user_id),
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

    await queryRunner.query('ALTER TABLE worker ADD COLUMN contractor_id uuid');
    await queryRunner.query('ALTER TABLE worker ADD COLUMN user_id uuid');
    await queryRunner.query(`
      ALTER TABLE worker
      ADD CONSTRAINT fk_worker_contractor
      FOREIGN KEY (contractor_id) REFERENCES contractor(id) ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      ALTER TABLE worker
      ADD CONSTRAINT fk_worker_user
      FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_worker_site_user
      ON worker (site_id, user_id)
      WHERE user_id IS NOT NULL
    `);
    await queryRunner.query('CREATE INDEX idx_worker_contractor ON worker (contractor_id)');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS idx_worker_contractor');
    await queryRunner.query('DROP INDEX IF EXISTS uq_worker_site_user');
    await queryRunner.query('ALTER TABLE worker DROP CONSTRAINT IF EXISTS fk_worker_user');
    await queryRunner.query('ALTER TABLE worker DROP CONSTRAINT IF EXISTS fk_worker_contractor');
    await queryRunner.query('ALTER TABLE worker DROP COLUMN IF EXISTS user_id');
    await queryRunner.query('ALTER TABLE worker DROP COLUMN IF EXISTS contractor_id');
    await queryRunner.query('DROP INDEX IF EXISTS idx_contractor_representative_user_site');
    await queryRunner.query('DROP TABLE IF EXISTS contractor_representative_assignment');
    await queryRunner.query('DROP INDEX IF EXISTS idx_contractor_site_active');
    await queryRunner.query('DROP TABLE IF EXISTS contractor');
  }
}
