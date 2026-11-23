import type { MigrationInterface, QueryRunner } from 'typeorm';

const previousEvents =
  "'CHANGE_REQUESTED','SWAP_REQUESTED','SWAP_CONFIRMED','SWAP_DECLINED','REQUEST_APPLIED','REQUEST_REJECTED','REQUEST_CONFLICTED','SAFETY_HANDOVER','EARLY_EXIT','MISSING_CHECKOUT','ABSENT','UNSCHEDULED_ENTRY','ENTRY_DENIED_NO_SCHEDULE','TIME_REQUESTED','TIME_APPROVED','TIME_REJECTED','SCHEDULE_CHANGED','SCHEDULE_CANCELLED','CHECKLIST_ASSIGNED','CHECKLIST_SUBMITTED','CHECKLIST_RETURNED','CHECKLIST_RECORDED','EXIT_DURATION_EXCEEDED','MAX_EXITS_EXCEEDED','DOCUMENT_SUBMITTED','DOCUMENT_APPROVED','DOCUMENT_REJECTED','DOCUMENT_EXPIRING','DOCUMENT_EXPIRED','PPE_ALERT_CREATED','ABSENCE_REVIEW_REQUIRED'";
export class AttendanceZoneReview1795651200001 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE attendance_day ADD COLUMN zone_attendance_review_audit_id uuid,
      ADD CONSTRAINT fk_attendance_zone_review_audit FOREIGN KEY(zone_attendance_review_audit_id) REFERENCES audit_log(id) ON DELETE RESTRICT`);
    await q.query(
      `CREATE UNIQUE INDEX uq_zone_hours_review_request ON audit_log(entity_id) WHERE action='ATTENDANCE_ZONE_HOURS_CONFIRMED'`,
    );
    await q.query(`CREATE FUNCTION validate_attendance_zone_review_link() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.zone_attendance_review_audit_id IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM audit_log a JOIN worker w ON w.id=NEW.worker_id AND w.site_id=NEW.site_id
        JOIN contractor_team t ON t.id::text=a.changes->>'teamId' AND t.site_id=NEW.site_id AND t.contractor_id=w.contractor_id
        WHERE a.id=NEW.zone_attendance_review_audit_id AND a.site_id=NEW.site_id
          AND a.action='ATTENDANCE_ZONE_HOURS_CONFIRMED' AND a.entity_type='attendance_zone_review'
          AND a.changes->>'dayId'=NEW.id::text AND a.changes->>'evidenceHash' ~ '^[a-f0-9]{64}$'
          AND a.changes->>'teamId'=NEW.zone_attendance_requirement->>'teamId'
          AND a.changes->>'membershipId'=NEW.zone_attendance_requirement->>'membershipId'
          AND a.changes->>'zoneId'=NEW.zone_attendance_requirement->>'zoneId'
          AND a.actor_account_id IS NOT NULL AND a.actor_account_id IS DISTINCT FROM w.user_id
          AND char_length(trim(a.reason)) BETWEEN 5 AND 1000)
      THEN RAISE EXCEPTION 'Invalid attendance review link' USING ERRCODE='23514'; END IF; RETURN NEW; END $$`);
    await q.query(
      `CREATE TRIGGER trg_attendance_zone_review_link BEFORE INSERT OR UPDATE OF zone_attendance_review_audit_id ON attendance_day FOR EACH ROW EXECUTE FUNCTION validate_attendance_zone_review_link()`,
    );
    await q.query(`ALTER TABLE user_notification DROP CONSTRAINT chk_notification_event,
      ADD CONSTRAINT chk_notification_event CHECK(event IN (${previousEvents},'ZONE_REVIEW_REQUIRED'))`);
  }
  async down(q: QueryRunner): Promise<void> {
    const [row] = await q.query(
      `SELECT EXISTS(SELECT 1 FROM audit_log WHERE action='ATTENDANCE_ZONE_HOURS_CONFIRMED') OR EXISTS(SELECT 1 FROM user_notification WHERE event='ZONE_REVIEW_REQUIRED') AS populated`,
    );
    if (row?.populated) throw new Error('Preserve Zone attendance review history before rollback');
    await q.query('DROP TRIGGER trg_attendance_zone_review_link ON attendance_day');
    await q.query('DROP FUNCTION validate_attendance_zone_review_link()');
    await q.query('ALTER TABLE attendance_day DROP COLUMN zone_attendance_review_audit_id');
    await q.query('DROP INDEX uq_zone_hours_review_request');
    await q.query(`ALTER TABLE user_notification DROP CONSTRAINT chk_notification_event,
      ADD CONSTRAINT chk_notification_event CHECK(event IN (${previousEvents}))`);
  }
}
