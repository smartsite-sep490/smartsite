import type { MigrationInterface, QueryRunner } from 'typeorm';

export class SchedulingRequestReviewReasons1791244800000 implements MigrationInterface {
  name = 'SchedulingRequestReviewReasons1791244800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE shift_change_request
      ADD COLUMN review_reason varchar(1000)
    `);
    await queryRunner.query(`
      ALTER TABLE shift_swap_request
      ADD COLUMN review_reason varchar(1000)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE shift_swap_request DROP COLUMN review_reason');
    await queryRunner.query('ALTER TABLE shift_change_request DROP COLUMN review_reason');
  }
}
