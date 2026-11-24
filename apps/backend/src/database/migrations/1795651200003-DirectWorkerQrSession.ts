import type { MigrationInterface, QueryRunner } from 'typeorm';

export class DirectWorkerQrSession1795651200003 implements MigrationInterface {
  name = 'DirectWorkerQrSession1795651200003';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE qr_fallback_session DROP CONSTRAINT chk_fallback_reason,
      ADD CONSTRAINT chk_fallback_reason CHECK(reason IN ('CAMERA_UNAVAILABLE','UNKNOWN','LOW_CONFIDENCE','QUALITY_FAILED','AI_UNAVAILABLE','OPERATOR_QR_SELECTED'))`);
  }
  async down(q: QueryRunner): Promise<void> {
    const [row] = await q.query(
      `SELECT EXISTS(SELECT 1 FROM qr_fallback_session WHERE reason='OPERATOR_QR_SELECTED') AS populated`,
    );
    if (row.populated) throw new Error('Preserve direct QR verification history before rollback');
    await q.query(`ALTER TABLE qr_fallback_session DROP CONSTRAINT chk_fallback_reason,
      ADD CONSTRAINT chk_fallback_reason CHECK(reason IN ('CAMERA_UNAVAILABLE','UNKNOWN','LOW_CONFIDENCE','QUALITY_FAILED','AI_UNAVAILABLE'))`);
  }
}
