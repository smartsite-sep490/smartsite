import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ShiftBreak1791763200001 implements MigrationInterface {
  name = 'ShiftBreak1791763200001';
  async up(runner: QueryRunner): Promise<void> {
    for (const [table, constraint] of [
      ['shift', 'chk_shift_break'],
      ['attendance_day', 'attendance_day_break_check'],
    ]) {
      await runner.query(`ALTER TABLE ${table} ADD COLUMN break_starts_at timestamptz, ADD COLUMN break_ends_at timestamptz,
        ADD CONSTRAINT ${constraint} CHECK ((break_starts_at IS NULL AND break_ends_at IS NULL) OR
        (break_starts_at IS NOT NULL AND break_ends_at IS NOT NULL AND starts_at IS NOT NULL AND ends_at IS NOT NULL
        AND break_starts_at >= starts_at AND break_ends_at <= ends_at AND break_ends_at > break_starts_at))`);
    }
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM shift WHERE break_starts_at IS NOT NULL)
      OR EXISTS (SELECT 1 FROM attendance_day WHERE break_starts_at IS NOT NULL)
      THEN RAISE EXCEPTION 'Shift break configuration and attendance history cannot be discarded'; END IF; END $$`);
    for (const [table, constraint] of [
      ['attendance_day', 'attendance_day_break_check'],
      ['shift', 'chk_shift_break'],
    ]) {
      await runner.query(
        `ALTER TABLE ${table} DROP CONSTRAINT ${constraint}, DROP COLUMN break_starts_at, DROP COLUMN break_ends_at`,
      );
    }
  }
}
