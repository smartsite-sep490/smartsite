import type { MigrationInterface, QueryRunner } from 'typeorm';

export class Mf07SharedContractorCompatibility1791331200000 implements MigrationInterface {
  name = 'Mf07SharedContractorCompatibility1791331200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE contractor_representative_assignment
        DROP CONSTRAINT uq_contractor_representative_assignment;
      ALTER TABLE contractor_representative_assignment
        ADD CONSTRAINT uq_contractor_representative_assignment
        UNIQUE (site_id, contractor_id, user_id);
      INSERT INTO contractor_representative_grant (id, user_id, contractor_id, created_at)
      SELECT gen_random_uuid(), user_id, contractor_id, MIN(created_at)
      FROM contractor_representative_assignment
      GROUP BY user_id, contractor_id
      ON CONFLICT (user_id, contractor_id) DO NOTHING;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL refuses the old constraint if a representative now serves multiple Sites.
    await queryRunner.query(`
      ALTER TABLE contractor_representative_assignment
        DROP CONSTRAINT uq_contractor_representative_assignment;
      ALTER TABLE contractor_representative_assignment
        ADD CONSTRAINT uq_contractor_representative_assignment
        UNIQUE (contractor_id, user_id);
    `);
  }
}
