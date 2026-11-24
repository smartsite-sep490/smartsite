import type { MigrationInterface, QueryRunner } from 'typeorm';

const previousEvents =
  "'CHANGE_REQUESTED','SWAP_REQUESTED','SWAP_CONFIRMED','SWAP_DECLINED','REQUEST_APPLIED','REQUEST_REJECTED','REQUEST_CONFLICTED','SAFETY_HANDOVER','EARLY_EXIT','MISSING_CHECKOUT','ABSENT','UNSCHEDULED_ENTRY','ENTRY_DENIED_NO_SCHEDULE','TIME_REQUESTED','TIME_APPROVED','TIME_REJECTED','SCHEDULE_CHANGED','SCHEDULE_CANCELLED','CHECKLIST_ASSIGNED','CHECKLIST_SUBMITTED','CHECKLIST_RETURNED','CHECKLIST_RECORDED','EXIT_DURATION_EXCEEDED','MAX_EXITS_EXCEEDED','DOCUMENT_SUBMITTED','DOCUMENT_APPROVED','DOCUMENT_REJECTED','DOCUMENT_EXPIRING','DOCUMENT_EXPIRED','PPE_ALERT_CREATED'";
export class AttendanceAbsenceReview1795651200000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE attendance_absence_review (
      id uuid PRIMARY KEY, day_id uuid NOT NULL, expected_day_version integer NOT NULL,
      team_attendance_version integer NOT NULL, team_id uuid NOT NULL,
      membership_id uuid NOT NULL, zone_id uuid NOT NULL, reason text NOT NULL,
      reviewed_by uuid NOT NULL, reviewed_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT fk_absence_review_day FOREIGN KEY(day_id) REFERENCES attendance_day(id) ON DELETE RESTRICT,
      CONSTRAINT fk_absence_review_team FOREIGN KEY(team_id) REFERENCES contractor_team(id) ON DELETE RESTRICT,
      CONSTRAINT fk_absence_review_membership FOREIGN KEY(membership_id) REFERENCES contractor_team_membership(id) ON DELETE RESTRICT,
      CONSTRAINT fk_absence_review_zone FOREIGN KEY(zone_id) REFERENCES zone(id) ON DELETE RESTRICT,
      CONSTRAINT fk_absence_review_actor FOREIGN KEY(reviewed_by) REFERENCES app_user(id) ON DELETE RESTRICT,
      CONSTRAINT uq_absence_review_snapshot UNIQUE(day_id,team_attendance_version),
      CONSTRAINT ck_absence_review_version CHECK(expected_day_version>0 AND team_attendance_version>0),
      CONSTRAINT ck_absence_review_reason CHECK(char_length(trim(reason)) BETWEEN 5 AND 1000))`);
    await q.query(`CREATE FUNCTION validate_attendance_absence_review() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NOT EXISTS(SELECT 1 FROM attendance_day d JOIN worker w ON w.id=d.worker_id AND w.site_id=d.site_id
          JOIN team_attendance a ON a.schedule_id=d.schedule_id
          JOIN contractor_team t ON t.id=a.team_id AND t.site_id=d.site_id AND t.contractor_id=w.contractor_id
          WHERE d.id=NEW.day_id AND a.status='PRESENT' AND a.version=NEW.team_attendance_version
            AND a.team_id=NEW.team_id AND a.membership_id=NEW.membership_id AND a.zone_id=NEW.zone_id)
        THEN RAISE EXCEPTION 'Invalid absence review scope' USING ERRCODE='23514'; END IF;
        RETURN NEW;
      END $$`);
    await q.query(`CREATE TRIGGER trg_attendance_absence_review BEFORE INSERT ON attendance_absence_review
      FOR EACH ROW EXECUTE FUNCTION validate_attendance_absence_review()`);
    await q.query(`ALTER TABLE user_notification DROP CONSTRAINT chk_notification_event,
      ADD CONSTRAINT chk_notification_event CHECK(event IN (${previousEvents},'ABSENCE_REVIEW_REQUIRED'))`);
  }
  async down(q: QueryRunner): Promise<void> {
    const [row] = await q.query(`SELECT EXISTS(SELECT 1 FROM attendance_absence_review) OR
      EXISTS(SELECT 1 FROM user_notification WHERE event='ABSENCE_REVIEW_REQUIRED') AS populated`);
    if (row?.populated)
      throw new Error('Preserve absence review and notification history before rollback');
    await q.query('DROP TABLE attendance_absence_review');
    await q.query('DROP FUNCTION validate_attendance_absence_review()');
    await q.query(`ALTER TABLE user_notification DROP CONSTRAINT chk_notification_event,
      ADD CONSTRAINT chk_notification_event CHECK(event IN (${previousEvents}))`);
  }
}
