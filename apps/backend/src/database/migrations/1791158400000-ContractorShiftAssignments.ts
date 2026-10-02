import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ContractorShiftAssignments1791158400000 implements MigrationInterface {
  name = 'ContractorShiftAssignments1791158400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE contractor_shift_assignment (
        id uuid NOT NULL,
        site_id uuid NOT NULL,
        shift_id uuid NOT NULL,
        contractor_id uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_contractor_shift_assignment_id PRIMARY KEY (id),
        CONSTRAINT fk_contractor_shift_assignment_site
          FOREIGN KEY (site_id) REFERENCES site(id) ON DELETE RESTRICT,
        CONSTRAINT fk_contractor_shift_assignment_shift
          FOREIGN KEY (shift_id) REFERENCES shift(id) ON DELETE RESTRICT,
        CONSTRAINT fk_contractor_shift_assignment_contractor
          FOREIGN KEY (contractor_id) REFERENCES contractor(id) ON DELETE RESTRICT,
        CONSTRAINT uq_contractor_shift_assignment
          UNIQUE (site_id, shift_id, contractor_id)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_contractor_shift_assignment_contractor
      ON contractor_shift_assignment (site_id, contractor_id, shift_id)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_contractor_shift_assignment_shift
      ON contractor_shift_assignment (site_id, shift_id, contractor_id)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS idx_contractor_shift_assignment_shift');
    await queryRunner.query('DROP INDEX IF EXISTS idx_contractor_shift_assignment_contractor');
    await queryRunner.query('DROP TABLE IF EXISTS contractor_shift_assignment');
  }
}
