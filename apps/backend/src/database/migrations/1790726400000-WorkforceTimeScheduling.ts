import type { MigrationInterface, QueryRunner } from 'typeorm';

export class WorkforceTimeScheduling1790726400000 implements MigrationInterface {
  name = 'WorkforceTimeScheduling1790726400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE shift (
        id uuid NOT NULL,
        site_id uuid NOT NULL,
        name varchar(160) NOT NULL,
        starts_at timestamptz NOT NULL,
        ends_at timestamptz NOT NULL,
        timezone varchar(64) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_shift_id PRIMARY KEY (id),
        CONSTRAINT fk_shift_site FOREIGN KEY (site_id) REFERENCES site(id) ON DELETE RESTRICT,
        CONSTRAINT chk_shift_interval CHECK (ends_at > starts_at),
        CONSTRAINT chk_shift_name_length CHECK (char_length(name) BETWEEN 1 AND 160)
      )
    `);
    await queryRunner.query('CREATE INDEX idx_shift_site_start ON shift (site_id, starts_at, id)');

    await queryRunner.query(`
      CREATE TABLE schedule_version (
        id uuid NOT NULL,
        site_id uuid NOT NULL,
        version integer NOT NULL,
        effective_from timestamptz NOT NULL,
        effective_until timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_schedule_version_id PRIMARY KEY (id),
        CONSTRAINT fk_schedule_version_site
          FOREIGN KEY (site_id) REFERENCES site(id) ON DELETE RESTRICT,
        CONSTRAINT chk_schedule_version_positive CHECK (version >= 1),
        CONSTRAINT chk_schedule_version_effective_interval
          CHECK (effective_until IS NULL OR effective_until > effective_from)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_schedule_version_site_effective
      ON schedule_version (site_id, effective_from, version)
    `);

    await queryRunner.query(`
      CREATE TABLE worker_schedule (
        id uuid NOT NULL,
        site_id uuid NOT NULL,
        schedule_version_id uuid NOT NULL,
        worker_id uuid NOT NULL,
        shift_id uuid NOT NULL,
        work_date date NOT NULL,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_worker_schedule_id PRIMARY KEY (id),
        CONSTRAINT fk_worker_schedule_site
          FOREIGN KEY (site_id) REFERENCES site(id) ON DELETE RESTRICT,
        CONSTRAINT fk_worker_schedule_version
          FOREIGN KEY (schedule_version_id) REFERENCES schedule_version(id) ON DELETE RESTRICT,
        CONSTRAINT fk_worker_schedule_worker
          FOREIGN KEY (worker_id) REFERENCES worker(id) ON DELETE RESTRICT,
        CONSTRAINT fk_worker_schedule_shift
          FOREIGN KEY (shift_id) REFERENCES shift(id) ON DELETE RESTRICT,
        CONSTRAINT uq_worker_schedule_version_worker_shift_date
          UNIQUE (schedule_version_id, worker_id, shift_id, work_date)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_worker_schedule_site_worker_date
      ON worker_schedule (site_id, worker_id, work_date)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_worker_schedule_active_worker_date
      ON worker_schedule (schedule_version_id, worker_id, work_date)
      WHERE is_active = true
    `);

    await queryRunner.query(`
      CREATE TABLE attendance_pair (
        id uuid NOT NULL,
        site_id uuid NOT NULL,
        worker_id uuid NOT NULL,
        shift_id uuid,
        work_date date NOT NULL,
        check_in_at timestamptz,
        check_out_at timestamptz,
        raw_event_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
        status varchar(16) NOT NULL,
        worked_minutes integer,
        confirmed_minutes integer,
        confirmed_by_user_id uuid,
        confirmed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_attendance_pair_id PRIMARY KEY (id),
        CONSTRAINT fk_attendance_pair_site
          FOREIGN KEY (site_id) REFERENCES site(id) ON DELETE RESTRICT,
        CONSTRAINT fk_attendance_pair_worker
          FOREIGN KEY (worker_id) REFERENCES worker(id) ON DELETE RESTRICT,
        CONSTRAINT fk_attendance_pair_shift
          FOREIGN KEY (shift_id) REFERENCES shift(id) ON DELETE SET NULL,
        CONSTRAINT fk_attendance_pair_confirmed_by
          FOREIGN KEY (confirmed_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT,
        CONSTRAINT chk_attendance_pair_status
          CHECK (status IN ('MATCHED', 'NEEDS_REVIEW', 'CALCULATED', 'CORRECTED', 'APPROVED', 'REJECTED')),
        CONSTRAINT chk_attendance_pair_worked_minutes
          CHECK (worked_minutes IS NULL OR worked_minutes >= 0),
        CONSTRAINT chk_attendance_pair_confirmed_minutes
          CHECK (confirmed_minutes IS NULL OR confirmed_minutes >= 0),
        CONSTRAINT chk_attendance_pair_interval
          CHECK (check_out_at IS NULL OR check_in_at IS NULL OR check_out_at > check_in_at)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_attendance_pair_site_work_date
      ON attendance_pair (site_id, work_date, worker_id)
    `);

    await queryRunner.query(`
      CREATE TABLE attendance_anomaly (
        id uuid NOT NULL,
        site_id uuid NOT NULL,
        attendance_pair_id uuid NOT NULL,
        code varchar(32) NOT NULL,
        detail varchar(500),
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_attendance_anomaly_id PRIMARY KEY (id),
        CONSTRAINT fk_attendance_anomaly_site
          FOREIGN KEY (site_id) REFERENCES site(id) ON DELETE RESTRICT,
        CONSTRAINT fk_attendance_anomaly_pair
          FOREIGN KEY (attendance_pair_id) REFERENCES attendance_pair(id) ON DELETE CASCADE,
        CONSTRAINT chk_attendance_anomaly_code
          CHECK (code IN ('MISSING_IN', 'MISSING_OUT', 'OUT_WITHOUT_IN', 'DUPLICATE_IN', 'DUPLICATE_OUT', 'LATE_CHECKIN', 'EARLY_CHECKOUT', 'CROSS_MIDNIGHT'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_attendance_anomaly_pair
      ON attendance_anomaly (attendance_pair_id, created_at)
    `);

    await queryRunner.query(`
      CREATE TABLE attendance_correction_request (
        id uuid NOT NULL,
        site_id uuid NOT NULL,
        attendance_pair_id uuid NOT NULL,
        requested_minutes integer,
        requested_check_in_at timestamptz,
        requested_check_out_at timestamptz,
        requested_by_user_id uuid NOT NULL,
        reason varchar(1000) NOT NULL,
        status varchar(16) NOT NULL,
        reviewed_by_user_id uuid,
        reviewed_at timestamptz,
        review_reason varchar(1000),
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_attendance_correction_request_id PRIMARY KEY (id),
        CONSTRAINT fk_attendance_correction_site
          FOREIGN KEY (site_id) REFERENCES site(id) ON DELETE RESTRICT,
        CONSTRAINT fk_attendance_correction_pair
          FOREIGN KEY (attendance_pair_id) REFERENCES attendance_pair(id) ON DELETE RESTRICT,
        CONSTRAINT fk_attendance_correction_requested_by
          FOREIGN KEY (requested_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT,
        CONSTRAINT fk_attendance_correction_reviewed_by
          FOREIGN KEY (reviewed_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT,
        CONSTRAINT chk_attendance_correction_status
          CHECK (status IN ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED')),
        CONSTRAINT chk_attendance_correction_reason_length
          CHECK (char_length(reason) BETWEEN 5 AND 1000),
        CONSTRAINT chk_attendance_correction_minutes
          CHECK (requested_minutes IS NULL OR requested_minutes >= 0)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_attendance_correction_pair_status
      ON attendance_correction_request (attendance_pair_id, status)
    `);

    await queryRunner.query(`
      CREATE TABLE timesheet (
        id uuid NOT NULL,
        site_id uuid NOT NULL,
        worker_id uuid NOT NULL,
        period_start date NOT NULL,
        period_end date NOT NULL,
        total_minutes integer NOT NULL DEFAULT 0,
        status varchar(24) NOT NULL,
        approved_by_user_id uuid,
        approved_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_timesheet_id PRIMARY KEY (id),
        CONSTRAINT fk_timesheet_site FOREIGN KEY (site_id) REFERENCES site(id) ON DELETE RESTRICT,
        CONSTRAINT fk_timesheet_worker FOREIGN KEY (worker_id) REFERENCES worker(id) ON DELETE RESTRICT,
        CONSTRAINT fk_timesheet_approved_by
          FOREIGN KEY (approved_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT,
        CONSTRAINT chk_timesheet_period CHECK (period_end >= period_start),
        CONSTRAINT chk_timesheet_status
          CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED')),
        CONSTRAINT chk_timesheet_minutes CHECK (total_minutes >= 0)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_timesheet_site_period
      ON timesheet (site_id, period_start, period_end, worker_id)
    `);

    await queryRunner.query(`
      CREATE TABLE shift_change_request (
        id uuid NOT NULL,
        site_id uuid NOT NULL,
        worker_id uuid NOT NULL,
        worker_schedule_id uuid NOT NULL,
        from_shift_id uuid NOT NULL,
        to_shift_id uuid NOT NULL,
        expected_schedule_version_id uuid NOT NULL,
        status varchar(24) NOT NULL,
        requested_by_user_id uuid NOT NULL,
        reason varchar(1000) NOT NULL,
        reviewed_by_user_id uuid,
        reviewed_at timestamptz,
        applied_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_shift_change_request_id PRIMARY KEY (id),
        CONSTRAINT fk_shift_change_site FOREIGN KEY (site_id) REFERENCES site(id) ON DELETE RESTRICT,
        CONSTRAINT fk_shift_change_worker
          FOREIGN KEY (worker_id) REFERENCES worker(id) ON DELETE RESTRICT,
        CONSTRAINT fk_shift_change_worker_schedule
          FOREIGN KEY (worker_schedule_id) REFERENCES worker_schedule(id) ON DELETE RESTRICT,
        CONSTRAINT fk_shift_change_from_shift
          FOREIGN KEY (from_shift_id) REFERENCES shift(id) ON DELETE RESTRICT,
        CONSTRAINT fk_shift_change_to_shift
          FOREIGN KEY (to_shift_id) REFERENCES shift(id) ON DELETE RESTRICT,
        CONSTRAINT fk_shift_change_expected_version
          FOREIGN KEY (expected_schedule_version_id) REFERENCES schedule_version(id) ON DELETE RESTRICT,
        CONSTRAINT fk_shift_change_requested_by
          FOREIGN KEY (requested_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT,
        CONSTRAINT fk_shift_change_reviewed_by
          FOREIGN KEY (reviewed_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT,
        CONSTRAINT chk_shift_change_status
          CHECK (status IN ('DRAFT', 'PENDING_COWORKER', 'PENDING_MANAGER', 'APPROVED', 'APPLIED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'CONFLICTED')),
        CONSTRAINT chk_shift_change_reason_length
          CHECK (char_length(reason) BETWEEN 5 AND 1000)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_shift_change_site_status
      ON shift_change_request (site_id, status, created_at)
    `);

    await queryRunner.query(`
      CREATE TABLE shift_swap_request (
        id uuid NOT NULL,
        site_id uuid NOT NULL,
        requester_worker_id uuid NOT NULL,
        requester_worker_schedule_id uuid NOT NULL,
        coworker_worker_id uuid NOT NULL,
        coworker_worker_schedule_id uuid NOT NULL,
        requester_shift_id uuid NOT NULL,
        coworker_shift_id uuid NOT NULL,
        expected_schedule_version_id uuid NOT NULL,
        status varchar(24) NOT NULL,
        requested_by_user_id uuid NOT NULL,
        reason varchar(1000) NOT NULL,
        coworker_confirmed_at timestamptz,
        reviewed_by_user_id uuid,
        reviewed_at timestamptz,
        applied_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_shift_swap_request_id PRIMARY KEY (id),
        CONSTRAINT fk_shift_swap_site FOREIGN KEY (site_id) REFERENCES site(id) ON DELETE RESTRICT,
        CONSTRAINT fk_shift_swap_requester_worker
          FOREIGN KEY (requester_worker_id) REFERENCES worker(id) ON DELETE RESTRICT,
        CONSTRAINT fk_shift_swap_requester_schedule
          FOREIGN KEY (requester_worker_schedule_id) REFERENCES worker_schedule(id) ON DELETE RESTRICT,
        CONSTRAINT fk_shift_swap_coworker_worker
          FOREIGN KEY (coworker_worker_id) REFERENCES worker(id) ON DELETE RESTRICT,
        CONSTRAINT fk_shift_swap_coworker_schedule
          FOREIGN KEY (coworker_worker_schedule_id) REFERENCES worker_schedule(id) ON DELETE RESTRICT,
        CONSTRAINT fk_shift_swap_requester_shift
          FOREIGN KEY (requester_shift_id) REFERENCES shift(id) ON DELETE RESTRICT,
        CONSTRAINT fk_shift_swap_coworker_shift
          FOREIGN KEY (coworker_shift_id) REFERENCES shift(id) ON DELETE RESTRICT,
        CONSTRAINT fk_shift_swap_expected_version
          FOREIGN KEY (expected_schedule_version_id) REFERENCES schedule_version(id) ON DELETE RESTRICT,
        CONSTRAINT fk_shift_swap_requested_by
          FOREIGN KEY (requested_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT,
        CONSTRAINT fk_shift_swap_reviewed_by
          FOREIGN KEY (reviewed_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT,
        CONSTRAINT chk_shift_swap_status
          CHECK (status IN ('DRAFT', 'PENDING_COWORKER', 'PENDING_MANAGER', 'APPROVED', 'APPLIED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'CONFLICTED')),
        CONSTRAINT chk_shift_swap_distinct_workers
          CHECK (requester_worker_id <> coworker_worker_id),
        CONSTRAINT chk_shift_swap_reason_length
          CHECK (char_length(reason) BETWEEN 5 AND 1000)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_shift_swap_site_status
      ON shift_swap_request (site_id, status, created_at)
    `);

    await queryRunner.query(`
      CREATE TABLE absence_request (
        id uuid NOT NULL,
        site_id uuid NOT NULL,
        worker_id uuid NOT NULL,
        worker_schedule_id uuid NOT NULL,
        shift_id uuid NOT NULL,
        replacement_worker_id uuid,
        requested_by_user_id uuid NOT NULL,
        reason varchar(1000) NOT NULL,
        status varchar(24) NOT NULL,
        is_understaffed boolean NOT NULL DEFAULT false,
        reviewed_by_user_id uuid,
        reviewed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_absence_request_id PRIMARY KEY (id),
        CONSTRAINT fk_absence_request_site
          FOREIGN KEY (site_id) REFERENCES site(id) ON DELETE RESTRICT,
        CONSTRAINT fk_absence_request_worker
          FOREIGN KEY (worker_id) REFERENCES worker(id) ON DELETE RESTRICT,
        CONSTRAINT fk_absence_request_worker_schedule
          FOREIGN KEY (worker_schedule_id) REFERENCES worker_schedule(id) ON DELETE RESTRICT,
        CONSTRAINT fk_absence_request_shift
          FOREIGN KEY (shift_id) REFERENCES shift(id) ON DELETE RESTRICT,
        CONSTRAINT fk_absence_request_replacement_worker
          FOREIGN KEY (replacement_worker_id) REFERENCES worker(id) ON DELETE RESTRICT,
        CONSTRAINT fk_absence_request_requested_by
          FOREIGN KEY (requested_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT,
        CONSTRAINT fk_absence_request_reviewed_by
          FOREIGN KEY (reviewed_by_user_id) REFERENCES app_user(id) ON DELETE RESTRICT,
        CONSTRAINT chk_absence_request_status
          CHECK (status IN ('PENDING_MANAGER', 'APPROVED', 'REJECTED', 'CANCELLED')),
        CONSTRAINT chk_absence_request_reason_length
          CHECK (char_length(reason) BETWEEN 5 AND 1000),
        CONSTRAINT chk_absence_request_replacement_distinct
          CHECK (replacement_worker_id IS NULL OR replacement_worker_id <> worker_id)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX idx_absence_request_site_status
      ON absence_request (site_id, status, created_at)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS idx_absence_request_site_status');
    await queryRunner.query('DROP TABLE absence_request');
    await queryRunner.query('DROP INDEX IF EXISTS idx_shift_swap_site_status');
    await queryRunner.query('DROP TABLE shift_swap_request');
    await queryRunner.query('DROP INDEX IF EXISTS idx_shift_change_site_status');
    await queryRunner.query('DROP TABLE shift_change_request');
    await queryRunner.query('DROP INDEX IF EXISTS idx_timesheet_site_period');
    await queryRunner.query('DROP TABLE timesheet');
    await queryRunner.query('DROP INDEX IF EXISTS idx_attendance_correction_pair_status');
    await queryRunner.query('DROP TABLE attendance_correction_request');
    await queryRunner.query('DROP INDEX IF EXISTS idx_attendance_anomaly_pair');
    await queryRunner.query('DROP TABLE attendance_anomaly');
    await queryRunner.query('DROP INDEX IF EXISTS idx_attendance_pair_site_work_date');
    await queryRunner.query('DROP TABLE attendance_pair');
    await queryRunner.query('DROP INDEX IF EXISTS uq_worker_schedule_active_worker_date');
    await queryRunner.query('DROP INDEX IF EXISTS idx_worker_schedule_site_worker_date');
    await queryRunner.query('DROP INDEX IF EXISTS idx_worker_schedule_site_worker');
    await queryRunner.query('DROP TABLE worker_schedule');
    await queryRunner.query('DROP INDEX IF EXISTS idx_schedule_version_site_effective');
    await queryRunner.query('DROP TABLE schedule_version');
    await queryRunner.query('DROP INDEX IF EXISTS idx_shift_site_start');
    await queryRunner.query('DROP TABLE shift');
  }
}
