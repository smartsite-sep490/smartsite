import type { MigrationInterface, QueryRunner } from 'typeorm';

export class Mf03AttendanceReconciliation1791676800000 implements MigrationInterface {
  name = 'Mf03AttendanceReconciliation1791676800000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      CREATE TABLE attendance_day (
        id uuid PRIMARY KEY, site_id uuid NOT NULL REFERENCES site(id) ON DELETE RESTRICT,
        worker_id uuid NOT NULL REFERENCES worker(id) ON DELETE RESTRICT, work_date date NOT NULL,
        timezone varchar(64) NOT NULL, schedule_id uuid REFERENCES worker_schedule(id) ON DELETE RESTRICT,
        shift_name varchar(160), starts_at timestamptz, ends_at timestamptz,
        status varchar(16) NOT NULL CHECK (status IN ('IN_PROGRESS','NEEDS_REVIEW','CONFIRMED')),
        regular_minutes integer NOT NULL DEFAULT 0 CHECK(regular_minutes>=0),
        overtime_minutes integer NOT NULL DEFAULT 0 CHECK(overtime_minutes>=0),
        provisional_minutes integer NOT NULL DEFAULT 0 CHECK(provisional_minutes>=0),
        confirmed_minutes integer CHECK(confirmed_minutes>=0), anomalies jsonb NOT NULL DEFAULT '[]',
        version integer NOT NULL DEFAULT 1 CHECK(version>0), review_note text,
        reviewed_by uuid REFERENCES app_user(id) ON DELETE RESTRICT, reviewed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_attendance_day_worker_date UNIQUE(site_id,worker_id,work_date),
        CHECK((starts_at IS NULL AND ends_at IS NULL) OR ends_at>starts_at)
      );
      CREATE INDEX idx_attendance_day_due ON attendance_day(status,ends_at);
      ALTER TABLE attendance_session ADD COLUMN day_id uuid REFERENCES attendance_day(id) ON DELETE RESTRICT;
      CREATE INDEX idx_attendance_session_day ON attendance_session(day_id);
      CREATE TABLE overtime_request (
        id uuid PRIMARY KEY, site_id uuid NOT NULL REFERENCES site(id) ON DELETE RESTRICT,
        worker_id uuid NOT NULL REFERENCES worker(id) ON DELETE RESTRICT,
        schedule_id uuid NOT NULL REFERENCES worker_schedule(id) ON DELETE RESTRICT,
        expected_shift_id uuid NOT NULL REFERENCES shift(id) ON DELETE RESTRICT,
        starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL CHECK(ends_at>starts_at),
        requested_by uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT, reason text NOT NULL,
        status varchar(16) NOT NULL CHECK(status IN ('PENDING','APPROVED','REJECTED')),
        reviewed_by uuid REFERENCES app_user(id) ON DELETE RESTRICT, reviewed_at timestamptz, review_note text,
        created_at timestamptz NOT NULL DEFAULT now(), CHECK(reviewed_by IS NULL OR reviewed_by<>requested_by)
      );
      CREATE INDEX idx_overtime_schedule ON overtime_request(schedule_id,status);
      ALTER TABLE absence_request ADD COLUMN starts_at timestamptz, ADD COLUMN ends_at timestamptz, ADD COLUMN review_note text;
      ALTER TABLE absence_request ADD CONSTRAINT ck_absence_interval CHECK((starts_at IS NULL AND ends_at IS NULL) OR (starts_at IS NOT NULL AND ends_at>starts_at));
      ALTER TABLE timesheet ADD COLUMN attendance_day_id uuid UNIQUE REFERENCES attendance_day(id) ON DELETE RESTRICT;
      ALTER TABLE user_notification DROP CONSTRAINT chk_notification_request_type;
      ALTER TABLE user_notification ALTER COLUMN request_type TYPE varchar(16);
      ALTER TABLE user_notification ADD CONSTRAINT chk_notification_request_type CHECK(request_type IN ('CHANGE','SWAP','SAFETY','ATTENDANCE'));
      ALTER TABLE user_notification DROP CONSTRAINT chk_notification_event;
      ALTER TABLE user_notification ADD CONSTRAINT chk_notification_event CHECK(event IN ('CHANGE_REQUESTED','SWAP_REQUESTED','SWAP_CONFIRMED','SWAP_DECLINED','REQUEST_APPLIED','REQUEST_REJECTED','REQUEST_CONFLICTED','SAFETY_HANDOVER','EARLY_EXIT','MISSING_CHECKOUT','UNSCHEDULED_ENTRY','TIME_REQUESTED','TIME_APPROVED','TIME_REJECTED'));
      CREATE TABLE attendance_schedule_conflict (schedule_id uuid PRIMARY KEY REFERENCES worker_schedule(id) ON DELETE RESTRICT);
      INSERT INTO attendance_schedule_conflict SELECT id FROM (SELECT id,count(*) OVER(PARTITION BY site_id,worker_id,work_date) AS n FROM worker_schedule WHERE is_active) s WHERE n>1;
      CREATE FUNCTION mf03_one_shift_per_day() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.is_active THEN
          PERFORM pg_advisory_xact_lock(hashtext(NEW.site_id::text||NEW.worker_id::text||NEW.work_date::text));
          IF EXISTS(SELECT 1 FROM worker_schedule WHERE site_id=NEW.site_id AND worker_id=NEW.worker_id AND work_date=NEW.work_date AND is_active AND id<>NEW.id) THEN
            IF TG_OP='UPDATE' AND OLD.is_active AND OLD.site_id=NEW.site_id AND OLD.worker_id=NEW.worker_id AND OLD.work_date=NEW.work_date AND OLD.shift_id=NEW.shift_id THEN RETURN NEW; END IF;
            RAISE EXCEPTION 'Worker already has an active shift on this date' USING ERRCODE='23505',CONSTRAINT='uq_worker_schedule_one_day';
          END IF;
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER mf03_one_shift_per_day BEFORE INSERT OR UPDATE ON worker_schedule FOR EACH ROW EXECUTE FUNCTION mf03_one_shift_per_day();
    `);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DO $$ BEGIN IF EXISTS(SELECT 1 FROM attendance_day) OR EXISTS(SELECT 1 FROM overtime_request) OR EXISTS(SELECT 1 FROM user_notification WHERE request_type='ATTENDANCE') OR EXISTS(SELECT 1 FROM absence_request WHERE starts_at IS NOT NULL OR ends_at IS NOT NULL) THEN RAISE EXCEPTION 'MF03 downgrade refused: attendance data must be preserved'; END IF; END $$;
      DROP TRIGGER mf03_one_shift_per_day ON worker_schedule; DROP FUNCTION mf03_one_shift_per_day(); DROP TABLE attendance_schedule_conflict;
      ALTER TABLE user_notification DROP CONSTRAINT chk_notification_event;
      ALTER TABLE user_notification DROP CONSTRAINT chk_notification_request_type;
      ALTER TABLE user_notification ALTER COLUMN request_type TYPE varchar(6);
      ALTER TABLE user_notification ADD CONSTRAINT chk_notification_request_type CHECK(request_type IN ('CHANGE','SWAP','SAFETY'));
      ALTER TABLE user_notification ADD CONSTRAINT chk_notification_event CHECK(event IN ('CHANGE_REQUESTED','SWAP_REQUESTED','SWAP_CONFIRMED','SWAP_DECLINED','REQUEST_APPLIED','REQUEST_REJECTED','REQUEST_CONFLICTED','SAFETY_HANDOVER'));
      ALTER TABLE absence_request DROP CONSTRAINT ck_absence_interval, DROP COLUMN starts_at, DROP COLUMN ends_at, DROP COLUMN review_note;
      ALTER TABLE timesheet DROP COLUMN attendance_day_id;
      ALTER TABLE attendance_session DROP COLUMN day_id;
      DROP TABLE overtime_request; DROP TABLE attendance_day;`);
  }
}
