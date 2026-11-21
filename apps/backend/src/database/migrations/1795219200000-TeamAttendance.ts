import type { MigrationInterface, QueryRunner } from 'typeorm';

export class TeamAttendance1795219200000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(
      "CREATE UNIQUE INDEX uq_team_attendance_request ON audit_log(entity_id) WHERE action = 'TEAM_ATTENDANCE_SUBMITTED'",
    );
    await q.query(
      "CREATE INDEX idx_team_attendance_gate ON attendance_event(shift_assignment_id,site_id,worker_id) WHERE kind = 'CHECK_IN' AND gate_event_id IS NOT NULL",
    );
    await q.query(`ALTER TABLE contractor_team ADD COLUMN leader_worker_id uuid,
      ADD CONSTRAINT fk_team_leader FOREIGN KEY (leader_worker_id) REFERENCES worker(id) ON DELETE RESTRICT`);
    await q.query(`CREATE TABLE team_attendance (
      schedule_id uuid CONSTRAINT pk_team_attendance PRIMARY KEY,
      team_id uuid NOT NULL, membership_id uuid NOT NULL, zone_id uuid NOT NULL,
      status varchar(16) NOT NULL, version integer NOT NULL DEFAULT 1,
      updated_by uuid NOT NULL, updated_at timestamptz NOT NULL,
      CONSTRAINT fk_team_attendance_schedule FOREIGN KEY(schedule_id) REFERENCES worker_schedule(id) ON DELETE RESTRICT,
      CONSTRAINT fk_team_attendance_team FOREIGN KEY(team_id) REFERENCES contractor_team(id) ON DELETE RESTRICT,
      CONSTRAINT fk_team_attendance_membership FOREIGN KEY(membership_id) REFERENCES contractor_team_membership(id) ON DELETE RESTRICT,
      CONSTRAINT fk_team_attendance_zone FOREIGN KEY(zone_id) REFERENCES zone(id) ON DELETE RESTRICT,
      CONSTRAINT fk_team_attendance_actor FOREIGN KEY(updated_by) REFERENCES app_user(id) ON DELETE RESTRICT,
      CONSTRAINT ck_team_attendance_status CHECK(status IN ('PRESENT','ABSENT')),
      CONSTRAINT ck_team_attendance_version CHECK(version > 0))`);
    await q.query('CREATE INDEX idx_team_attendance_team ON team_attendance(team_id)');
    await q.query(`CREATE FUNCTION validate_team_attendance_scope() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NOT EXISTS(SELECT 1 FROM worker_schedule s JOIN worker w ON w.id=s.worker_id
          JOIN contractor_team_membership tm ON tm.id=NEW.membership_id AND tm.worker_id=w.id
          JOIN contractor_team t ON t.id=NEW.team_id AND t.id=tm.team_id
          JOIN zone z ON z.id=NEW.zone_id AND z.site_id=s.site_id
          WHERE s.id=NEW.schedule_id AND w.site_id=s.site_id AND tm.site_id=s.site_id
          AND t.site_id=s.site_id AND tm.contractor_id=w.contractor_id AND t.contractor_id=w.contractor_id)
        THEN RAISE EXCEPTION 'Invalid team attendance scope' USING ERRCODE='23514'; END IF;
        RETURN NEW;
      END $$`);
    await q.query(`CREATE TRIGGER trg_team_attendance_scope BEFORE INSERT OR UPDATE ON team_attendance
      FOR EACH ROW EXECUTE FUNCTION validate_team_attendance_scope()`);
  }
  async down(q: QueryRunner): Promise<void> {
    const [row] = (await q.query('SELECT EXISTS(SELECT 1 FROM team_attendance) AS populated')) as {
      populated: boolean;
    }[];
    if (row?.populated) throw new Error('Preserve team attendance history before rollback');
    await q.query('DROP TABLE team_attendance');
    await q.query('DROP INDEX uq_team_attendance_request');
    await q.query('DROP INDEX idx_team_attendance_gate');
    await q.query('DROP FUNCTION validate_team_attendance_scope()');
    await q.query(
      'ALTER TABLE contractor_team DROP CONSTRAINT fk_team_leader, DROP COLUMN leader_worker_id',
    );
  }
}
