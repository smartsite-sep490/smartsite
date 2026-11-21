import type { MigrationInterface, QueryRunner } from 'typeorm';
export class MobileAttendanceCompletion1795305600000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE attendance_day ADD COLUMN zone_attendance_requirement jsonb,
      ADD CONSTRAINT ck_attendance_zone_requirement CHECK(zone_attendance_requirement IS NULL OR
        ((jsonb_typeof(zone_attendance_requirement)='object' AND zone_attendance_requirement->>'version'='1' AND jsonb_typeof(zone_attendance_requirement->'required')='boolean') IS TRUE))`);
    await q.query(
      `CREATE TABLE team_attendance_policy(id boolean PRIMARY KEY DEFAULT true CHECK(id=true), effective_from timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    );
    await q.query(`INSERT INTO team_attendance_policy(id) VALUES(true)`);
  }
  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TABLE team_attendance_policy');
    await q.query('ALTER TABLE attendance_day DROP COLUMN zone_attendance_requirement');
  }
}
