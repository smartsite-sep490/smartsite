import type { MigrationInterface, QueryRunner } from 'typeorm';

export class WorkerDocumentSubmittedExpiry1792713600000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE worker_document ADD COLUMN submitted_expires_on date');
  }
  async down(runner: QueryRunner): Promise<void> {
    // Preserve Representative input rather than silently discarding a pending review suggestion.
    const [row] = await runner.query(
      'SELECT count(*)::int AS count FROM worker_document WHERE submitted_expires_on IS NOT NULL',
    );
    if (row.count) throw new Error('Cannot remove submitted document expiry while values exist');
    await runner.query('ALTER TABLE worker_document DROP COLUMN submitted_expires_on');
  }
}
