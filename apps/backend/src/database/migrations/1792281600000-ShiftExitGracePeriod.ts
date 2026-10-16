import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ShiftExitGracePeriod1792281600000 implements MigrationInterface {
  name = 'ShiftExitGracePeriod1792281600000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE shift
        ADD COLUMN allowed_exit_minutes integer NOT NULL DEFAULT 15,
        ADD COLUMN max_exit_count integer NOT NULL DEFAULT 2,
        ADD CONSTRAINT chk_shift_allowed_exit_minutes CHECK (allowed_exit_minutes >= 0),
        ADD CONSTRAINT chk_shift_max_exit_count CHECK (max_exit_count >= 0);
    `);

    await runner.query(`
      ALTER TABLE attendance_day
        ADD COLUMN allowed_exit_minutes integer NOT NULL DEFAULT 15,
        ADD COLUMN max_exit_count integer NOT NULL DEFAULT 2,
        ADD COLUMN exit_count integer NOT NULL DEFAULT 0,
        ADD COLUMN deducted_minutes integer NOT NULL DEFAULT 0,
        ADD CONSTRAINT attendance_day_allowed_exit_minutes_check CHECK (allowed_exit_minutes >= 0),
        ADD CONSTRAINT attendance_day_max_exit_count_check CHECK (max_exit_count >= 0),
        ADD CONSTRAINT attendance_day_exit_count_check CHECK (exit_count >= 0),
        ADD CONSTRAINT attendance_day_deducted_minutes_check CHECK (deducted_minutes >= 0);
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE attendance_day
        DROP CONSTRAINT IF EXISTS attendance_day_deducted_minutes_check,
        DROP CONSTRAINT IF EXISTS attendance_day_exit_count_check,
        DROP CONSTRAINT IF EXISTS attendance_day_max_exit_count_check,
        DROP CONSTRAINT IF EXISTS attendance_day_allowed_exit_minutes_check,
        DROP COLUMN IF EXISTS deducted_minutes,
        DROP COLUMN IF EXISTS exit_count,
        DROP COLUMN IF EXISTS max_exit_count,
        DROP COLUMN IF EXISTS allowed_exit_minutes;
    `);

    await runner.query(`
      ALTER TABLE shift
        DROP CONSTRAINT IF EXISTS chk_shift_max_exit_count,
        DROP CONSTRAINT IF EXISTS chk_shift_allowed_exit_minutes,
        DROP COLUMN IF EXISTS max_exit_count,
        DROP COLUMN IF EXISTS allowed_exit_minutes;
    `);
  }
}
