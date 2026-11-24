import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AttendanceMultipleShifts1795651200002 implements MigrationInterface {
  name = 'AttendanceMultipleShifts1795651200002';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE user_notification DROP CONSTRAINT chk_notification_event,
        ADD CONSTRAINT chk_notification_event CHECK(event IN ('CHANGE_REQUESTED','SWAP_REQUESTED','SWAP_CONFIRMED','SWAP_DECLINED','REQUEST_APPLIED','REQUEST_REJECTED','REQUEST_CONFLICTED','SAFETY_HANDOVER','EARLY_EXIT','MISSING_CHECKOUT','ABSENT','UNSCHEDULED_ENTRY','ENTRY_DENIED_NO_SCHEDULE','TIME_REQUESTED','TIME_APPROVED','TIME_REJECTED','SCHEDULE_CHANGED','SCHEDULE_CANCELLED','CHECKLIST_ASSIGNED','CHECKLIST_SUBMITTED','CHECKLIST_RETURNED','CHECKLIST_RECORDED','EXIT_DURATION_EXCEEDED','MAX_EXITS_EXCEEDED','DOCUMENT_SUBMITTED','DOCUMENT_APPROVED','DOCUMENT_REJECTED','DOCUMENT_EXPIRING','DOCUMENT_EXPIRED','PPE_ALERT_CREATED','ABSENCE_REVIEW_REQUIRED','ZONE_REVIEW_REQUIRED','MISSING_ATTENDANCE','ASSIGNMENT_REVIEW'));
      ALTER TABLE attendance_session DROP CONSTRAINT ck_attendance_session_events,
        ADD CONSTRAINT ck_attendance_session_events CHECK(check_in_event_id IS NOT NULL OR check_out_event_id IS NOT NULL OR
          (day_id IS NOT NULL AND shift_assignment_id IS NOT NULL AND status IN ('MISSING_IN','CORRECTED') AND (status<>'CORRECTED' OR applied_correction_id IS NOT NULL)));
      ALTER TABLE attendance_day DROP CONSTRAINT uq_attendance_day_worker_date;
      CREATE UNIQUE INDEX uq_attendance_day_schedule ON attendance_day(schedule_id) WHERE schedule_id IS NOT NULL;
      CREATE UNIQUE INDEX uq_attendance_day_unscheduled ON attendance_day(site_id,worker_id,work_date) WHERE schedule_id IS NULL;
      CREATE OR REPLACE FUNCTION mf03_one_shift_per_day() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.is_active THEN
          PERFORM pg_advisory_xact_lock(hashtext(NEW.site_id::text||NEW.worker_id::text));
          IF EXISTS (
            SELECT 1 FROM worker_schedule ws JOIN shift s ON s.id=ws.shift_id AND s.site_id=ws.site_id
            JOIN shift n ON n.id=NEW.shift_id AND n.site_id=NEW.site_id
            WHERE ws.site_id=NEW.site_id AND ws.worker_id=NEW.worker_id AND ws.is_active AND ws.id<>NEW.id
              AND tstzrange((ws.work_date+(s.starts_at AT TIME ZONE s.timezone)::time) AT TIME ZONE s.timezone,
                (ws.work_date+(s.ends_at AT TIME ZONE s.timezone)::time+(((s.ends_at AT TIME ZONE s.timezone)::date-(s.starts_at AT TIME ZONE s.timezone)::date)*interval '1 day')) AT TIME ZONE s.timezone,'[)')
              && tstzrange((NEW.work_date+(n.starts_at AT TIME ZONE n.timezone)::time) AT TIME ZONE n.timezone,
                (NEW.work_date+(n.ends_at AT TIME ZONE n.timezone)::time+(((n.ends_at AT TIME ZONE n.timezone)::date-(n.starts_at AT TIME ZONE n.timezone)::date)*interval '1 day')) AT TIME ZONE n.timezone,'[)')
          ) THEN RAISE EXCEPTION 'Worker shifts overlap' USING ERRCODE='23505',CONSTRAINT='uq_worker_schedule_one_day'; END IF;
        END IF;
        RETURN NEW;
      END $$;
    `);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query(`DO $$ BEGIN IF
      EXISTS(SELECT 1 FROM worker_schedule WHERE is_active GROUP BY site_id,worker_id,work_date HAVING count(*)>1)
      OR EXISTS(SELECT 1 FROM attendance_day GROUP BY site_id,worker_id,work_date HAVING count(*)>1)
      OR EXISTS(SELECT 1 FROM attendance_session WHERE check_in_event_id IS NULL AND check_out_event_id IS NULL)
      OR EXISTS(SELECT 1 FROM user_notification WHERE event IN ('MISSING_ATTENDANCE','ASSIGNMENT_REVIEW'))
      THEN RAISE EXCEPTION 'Downgrade requires an explicit reconciliation of multiple shifts; attendance history must be preserved'; END IF; END $$;
      DROP INDEX uq_attendance_day_schedule;
      DROP INDEX uq_attendance_day_unscheduled;
      ALTER TABLE attendance_day ADD CONSTRAINT uq_attendance_day_worker_date UNIQUE(site_id,worker_id,work_date);
      ALTER TABLE attendance_session DROP CONSTRAINT ck_attendance_session_events,
        ADD CONSTRAINT ck_attendance_session_events CHECK(check_in_event_id IS NOT NULL OR check_out_event_id IS NOT NULL);
      CREATE OR REPLACE FUNCTION mf03_one_shift_per_day() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.is_active THEN
          PERFORM pg_advisory_xact_lock(hashtext(NEW.site_id::text||NEW.worker_id::text||NEW.work_date::text));
          IF EXISTS(SELECT 1 FROM worker_schedule WHERE site_id=NEW.site_id AND worker_id=NEW.worker_id AND work_date=NEW.work_date AND is_active AND id<>NEW.id) THEN
            IF TG_OP='UPDATE' AND OLD.is_active AND OLD.site_id=NEW.site_id AND OLD.worker_id=NEW.worker_id AND OLD.work_date=NEW.work_date AND OLD.shift_id=NEW.shift_id THEN RETURN NEW; END IF;
            RAISE EXCEPTION 'Worker already has an active shift on this date' USING ERRCODE='23505',CONSTRAINT='uq_worker_schedule_one_day';
          END IF;
        END IF; RETURN NEW; END $$;
      ALTER TABLE user_notification DROP CONSTRAINT chk_notification_event,
        ADD CONSTRAINT chk_notification_event CHECK(event IN ('CHANGE_REQUESTED','SWAP_REQUESTED','SWAP_CONFIRMED','SWAP_DECLINED','REQUEST_APPLIED','REQUEST_REJECTED','REQUEST_CONFLICTED','SAFETY_HANDOVER','EARLY_EXIT','MISSING_CHECKOUT','ABSENT','UNSCHEDULED_ENTRY','ENTRY_DENIED_NO_SCHEDULE','TIME_REQUESTED','TIME_APPROVED','TIME_REJECTED','SCHEDULE_CHANGED','SCHEDULE_CANCELLED','CHECKLIST_ASSIGNED','CHECKLIST_SUBMITTED','CHECKLIST_RETURNED','CHECKLIST_RECORDED','EXIT_DURATION_EXCEEDED','MAX_EXITS_EXCEEDED','DOCUMENT_SUBMITTED','DOCUMENT_APPROVED','DOCUMENT_REJECTED','DOCUMENT_EXPIRING','DOCUMENT_EXPIRED','PPE_ALERT_CREATED','ABSENCE_REVIEW_REQUIRED','ZONE_REVIEW_REQUIRED'));
    `);
  }
}
