import type { MigrationInterface, QueryRunner } from 'typeorm';

export class MissingRollCallAbsence1795651200004 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE attendance_absence_review DROP CONSTRAINT ck_absence_review_version,
      ADD CONSTRAINT ck_absence_review_version CHECK(expected_day_version>0 AND team_attendance_version>=0)`);
    await q.query(`CREATE OR REPLACE FUNCTION validate_attendance_absence_review() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NOT EXISTS(SELECT 1 FROM attendance_day d JOIN worker w ON w.id=d.worker_id AND w.site_id=d.site_id
          JOIN team_attendance a ON a.schedule_id=d.schedule_id
          JOIN contractor_team t ON t.id=a.team_id AND t.site_id=d.site_id AND t.contractor_id=w.contractor_id
          WHERE d.id=NEW.day_id AND a.status='PRESENT' AND a.version=NEW.team_attendance_version
            AND a.team_id=NEW.team_id AND a.membership_id=NEW.membership_id AND a.zone_id=NEW.zone_id)
        AND NOT EXISTS(SELECT 1 FROM attendance_day d
          JOIN worker w ON w.id=d.worker_id AND w.site_id=d.site_id
          JOIN worker_schedule s ON s.id=d.schedule_id AND s.worker_id=w.id AND s.site_id=d.site_id AND s.is_active
          JOIN contractor_team t ON t.id=NEW.team_id AND t.site_id=d.site_id AND t.contractor_id=w.contractor_id
          JOIN contractor_team_membership m ON m.id=NEW.membership_id AND m.team_id=t.id AND m.worker_id=w.id AND m.site_id=d.site_id AND m.contractor_id=w.contractor_id
          JOIN zone z ON z.id=NEW.zone_id AND z.site_id=d.site_id
          WHERE d.id=NEW.day_id AND NEW.team_attendance_version=0
            AND d.zone_attendance_requirement->>'required'='true'
            AND d.zone_attendance_requirement->>'teamId'=NEW.team_id::text
            AND d.zone_attendance_requirement->>'membershipId'=NEW.membership_id::text
            AND d.zone_attendance_requirement->>'zoneId'=NEW.zone_id::text
            AND NOT EXISTS(SELECT 1 FROM team_attendance a WHERE a.schedule_id=d.schedule_id))
        THEN RAISE EXCEPTION 'Invalid absence review scope' USING ERRCODE='23514'; END IF;
        RETURN NEW;
      END $$`);
  }
  async down(q: QueryRunner): Promise<void> {
    const [row] = await q.query(
      `SELECT EXISTS(SELECT 1 FROM attendance_absence_review WHERE team_attendance_version=0) AS populated`,
    );
    if (row?.populated)
      throw new Error('Preserve missing roll-call absence review history before rollback');
    await q.query(`CREATE OR REPLACE FUNCTION validate_attendance_absence_review() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NOT EXISTS(SELECT 1 FROM attendance_day d JOIN worker w ON w.id=d.worker_id AND w.site_id=d.site_id
          JOIN team_attendance a ON a.schedule_id=d.schedule_id
          JOIN contractor_team t ON t.id=a.team_id AND t.site_id=d.site_id AND t.contractor_id=w.contractor_id
          WHERE d.id=NEW.day_id AND a.status='PRESENT' AND a.version=NEW.team_attendance_version
            AND a.team_id=NEW.team_id AND a.membership_id=NEW.membership_id AND a.zone_id=NEW.zone_id)
        THEN RAISE EXCEPTION 'Invalid absence review scope' USING ERRCODE='23514'; END IF;
        RETURN NEW;
      END $$`);
    await q.query(`ALTER TABLE attendance_absence_review DROP CONSTRAINT ck_absence_review_version,
      ADD CONSTRAINT ck_absence_review_version CHECK(expected_day_version>0 AND team_attendance_version>0)`);
  }
}
