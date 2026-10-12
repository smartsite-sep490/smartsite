import type { MigrationInterface, QueryRunner } from 'typeorm';
export class Mf03AttendanceDuplicateReview1791676800003 implements MigrationInterface {
  name = 'Mf03AttendanceDuplicateReview1791676800003';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE attendance_session
      ADD COLUMN ignored_by uuid CONSTRAINT fk_attendance_session_ignored_by REFERENCES app_user(id) ON DELETE RESTRICT,
      ADD COLUMN ignored_at timestamptz, ADD COLUMN ignore_reason text,
      DROP CONSTRAINT ck_attendance_session_status,
      ADD CONSTRAINT ck_attendance_session_status CHECK(status IN ('MATCHED','MISSING_IN','MISSING_OUT','NEEDS_REVIEW','CORRECTED','IGNORED')),
      ADD CONSTRAINT ck_attendance_session_ignore CHECK (
        (status = 'IGNORED' AND ignored_by IS NOT NULL AND ignored_at IS NOT NULL AND ignore_reason IS NOT NULL
         AND length(trim(ignore_reason)) >= 5 AND effective_in_at IS NULL AND check_out_event_id IS NULL AND check_in_event_id IS NOT NULL)
        OR (status <> 'IGNORED' AND ignored_by IS NULL AND ignored_at IS NULL AND ignore_reason IS NULL));`);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DO $$ BEGIN IF EXISTS(SELECT 1 FROM attendance_session WHERE status='IGNORED') THEN
      RAISE EXCEPTION 'Downgrade refused: duplicate review history must be preserved'; END IF; END $$;
      ALTER TABLE attendance_session DROP CONSTRAINT ck_attendance_session_ignore,
      DROP COLUMN ignored_by, DROP COLUMN ignored_at, DROP COLUMN ignore_reason,
      DROP CONSTRAINT ck_attendance_session_status,
      ADD CONSTRAINT ck_attendance_session_status CHECK(status IN ('MATCHED','MISSING_IN','MISSING_OUT','NEEDS_REVIEW','CORRECTED'));`);
  }
}
