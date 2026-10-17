import type { MigrationInterface, QueryRunner } from 'typeorm';

export class WorkerQrShortCodes1792454400000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    // A Worker obtains a code before Security opens an internal fallback session.
    await runner.query(`ALTER TABLE qr_credential DROP CONSTRAINT chk_qr_subject;
      ALTER TABLE qr_credential ADD CONSTRAINT chk_qr_subject CHECK(
        (visit_id IS NOT NULL AND worker_id IS NULL AND fallback_session_id IS NULL)
        OR (visit_id IS NULL AND worker_id IS NOT NULL));`);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DO $$ BEGIN IF EXISTS(SELECT 1 FROM qr_credential
        WHERE worker_id IS NOT NULL AND fallback_session_id IS NULL) THEN
        RAISE EXCEPTION 'Worker QR history requires the independent-code schema';
      END IF; END $$;
      ALTER TABLE qr_credential DROP CONSTRAINT chk_qr_subject;
      ALTER TABLE qr_credential ADD CONSTRAINT chk_qr_subject CHECK(
        (visit_id IS NOT NULL AND worker_id IS NULL AND fallback_session_id IS NULL)
        OR (visit_id IS NULL AND worker_id IS NOT NULL AND fallback_session_id IS NOT NULL));`);
  }
}
