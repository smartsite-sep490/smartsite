import type { MigrationInterface, QueryRunner } from 'typeorm';
export class ErdAttendanceFlow1791504000005 implements MigrationInterface {
  async up(runner: QueryRunner) {
    await runner.query(`CREATE TABLE attendance_event (
      id uuid CONSTRAINT pk_attendance_event_id PRIMARY KEY,
      site_id uuid NOT NULL CONSTRAINT fk_attendance_event_site REFERENCES site(id) ON DELETE RESTRICT,
      worker_id uuid NOT NULL CONSTRAINT fk_attendance_event_worker REFERENCES worker(id) ON DELETE RESTRICT,
      worker_assignment_id uuid CONSTRAINT fk_attendance_event_assignment REFERENCES worker_site_zone_assignment(id) ON DELETE RESTRICT,
      shift_assignment_id uuid CONSTRAINT fk_attendance_event_schedule REFERENCES worker_schedule(id) ON DELETE RESTRICT,
      kind varchar(16) NOT NULL,method varchar(10) NOT NULL,
      gate_event_id uuid CONSTRAINT fk_attendance_event_gate REFERENCES gate_event(id) ON DELETE RESTRICT,
      occurred_at timestamptz NOT NULL,recorded_by uuid CONSTRAINT fk_attendance_event_recorder REFERENCES app_user(id) ON DELETE RESTRICT,
      reason_code varchar(100) NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ck_attendance_event_kind CHECK(kind IN ('CHECK_IN','CHECK_OUT') AND method IN ('FACE','QR','MANUAL')));
      CREATE UNIQUE INDEX uq_attendance_event_gate ON attendance_event(gate_event_id);
      CREATE TABLE attendance_session (
      id uuid CONSTRAINT pk_attendance_session_id PRIMARY KEY,
      site_id uuid NOT NULL CONSTRAINT fk_attendance_session_site REFERENCES site(id) ON DELETE RESTRICT,
      worker_id uuid NOT NULL CONSTRAINT fk_attendance_session_worker REFERENCES worker(id) ON DELETE RESTRICT,
      shift_assignment_id uuid CONSTRAINT fk_attendance_session_schedule REFERENCES worker_schedule(id) ON DELETE RESTRICT,
      check_in_event_id uuid CONSTRAINT fk_attendance_session_in REFERENCES attendance_event(id) ON DELETE RESTRICT,
      check_out_event_id uuid CONSTRAINT fk_attendance_session_out REFERENCES attendance_event(id) ON DELETE RESTRICT,
      effective_in_at timestamptz,effective_out_at timestamptz,status varchar(16) NOT NULL,applied_correction_id uuid,
      version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ck_attendance_session_events CHECK(check_in_event_id IS NOT NULL OR check_out_event_id IS NOT NULL),
      CONSTRAINT ck_attendance_session_distinct CHECK(check_in_event_id IS NULL OR check_out_event_id IS NULL OR check_in_event_id <> check_out_event_id),
      CONSTRAINT ck_attendance_session_interval CHECK(effective_in_at IS NULL OR effective_out_at IS NULL OR effective_out_at>=effective_in_at),
      CONSTRAINT ck_attendance_session_status CHECK(status IN ('MATCHED','MISSING_IN','MISSING_OUT','NEEDS_REVIEW','CORRECTED')));
      CREATE UNIQUE INDEX uq_attendance_session_in ON attendance_session(check_in_event_id);
      CREATE UNIQUE INDEX uq_attendance_session_out ON attendance_session(check_out_event_id);
      CREATE UNIQUE INDEX uq_attendance_session_correction ON attendance_session(applied_correction_id);
      CREATE UNIQUE INDEX uq_attendance_session_open ON attendance_session(site_id,worker_id) WHERE check_out_event_id IS NULL AND effective_out_at IS NULL;
      CREATE TABLE attendance_correction (
      id uuid CONSTRAINT pk_attendance_correction_id PRIMARY KEY,
      attendance_session_id uuid NOT NULL CONSTRAINT fk_attendance_correction_session REFERENCES attendance_session(id) ON DELETE RESTRICT,
      requested_by uuid NOT NULL CONSTRAINT fk_attendance_correction_requester REFERENCES app_user(id) ON DELETE RESTRICT,
      expected_session_version integer NOT NULL,proposed_in_at timestamptz NOT NULL,proposed_out_at timestamptz NOT NULL,reason text NOT NULL,status varchar(16) NOT NULL,
      reviewed_by uuid CONSTRAINT fk_attendance_correction_reviewer REFERENCES app_user(id) ON DELETE RESTRICT,
      reviewed_at timestamptz,review_note text,created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ck_attendance_correction_interval CHECK(proposed_out_at>=proposed_in_at),
      CONSTRAINT ck_attendance_correction_self_review CHECK(reviewed_by IS NULL OR reviewed_by<>requested_by),
      CONSTRAINT ck_attendance_correction_status CHECK(status IN ('PENDING','APPROVED','REJECTED','CANCELLED')));
      ALTER TABLE attendance_session ADD CONSTRAINT fk_attendance_session_correction FOREIGN KEY(applied_correction_id) REFERENCES attendance_correction(id) ON DELETE RESTRICT;`);
  }
  async down(runner: QueryRunner) {
    await runner.query(`DO $$ BEGIN IF EXISTS(SELECT 1 FROM attendance_event) OR EXISTS(SELECT 1 FROM attendance_session) OR EXISTS(SELECT 1 FROM attendance_correction) THEN RAISE EXCEPTION 'Attendance history cannot be discarded'; END IF; END $$;
      ALTER TABLE attendance_session DROP CONSTRAINT fk_attendance_session_correction; DROP TABLE attendance_correction; DROP TABLE attendance_session; DROP TABLE attendance_event;`);
  }
}
