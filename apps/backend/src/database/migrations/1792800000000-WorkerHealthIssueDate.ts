import type { MigrationInterface, QueryRunner } from 'typeorm';
export class WorkerHealthIssueDate1792800000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    // Prior approvals remain unchanged; a new Safety review applies the one-year policy.
    await runner.query('ALTER TABLE worker_document ADD COLUMN submitted_issued_on date');
  }
  async down(runner: QueryRunner): Promise<void> {
    const [row] = await runner.query(
      'SELECT count(*)::int AS count FROM worker_document WHERE submitted_issued_on IS NOT NULL',
    );
    if (row.count) throw new Error('Cannot remove submitted health issue dates while values exist');
    await runner.query('ALTER TABLE worker_document DROP COLUMN submitted_issued_on');
  }
}
