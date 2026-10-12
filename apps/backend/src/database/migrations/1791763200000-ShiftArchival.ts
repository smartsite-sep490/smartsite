import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ShiftArchival1791763200000 implements MigrationInterface {
  name = 'ShiftArchival1791763200000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query('ALTER TABLE shift ADD COLUMN archived_at timestamptz NULL');
  }

  async down(runner: QueryRunner): Promise<void> {
    // Removing the flag would silently enable archived templates again.
    await runner.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM shift WHERE archived_at IS NOT NULL) THEN
        RAISE EXCEPTION 'Cannot roll back while archived shifts exist';
      END IF;
    END $$`);
    await runner.query('ALTER TABLE shift DROP COLUMN archived_at');
  }
}
