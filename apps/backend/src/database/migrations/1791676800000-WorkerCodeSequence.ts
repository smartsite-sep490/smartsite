import type { MigrationInterface, QueryRunner } from 'typeorm';

export class WorkerCodeSequence1791676800000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query('CREATE SEQUENCE worker_code_seq AS bigint NO CYCLE');
    // Start beyond existing numeric Worker codes; preserve every existing record.
    await q.query(`SELECT setval('worker_code_seq',
      COALESCE(MAX(substring(external_id FROM 2)::bigint), 0) + 1, false)
      FROM worker WHERE external_id ~ '^W[0-9]{1,18}$'`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP SEQUENCE worker_code_seq');
  }
}
