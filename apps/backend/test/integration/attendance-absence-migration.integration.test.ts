import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import dataSource from '../support/test-data-source.js';
import { AttendanceAbsence1792022400000 } from '../../src/database/migrations/1792022400000-AttendanceAbsence.js';

test('absence migration expands enums and refuses rollback with absence history', async () => {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const schema = `absence_${randomUUID().replaceAll('-', '')}`;
    await runner.query(`CREATE SCHEMA "${schema}"`);
    await runner.query(`SET LOCAL search_path TO "${schema}"`);
    await runner.query(
      `CREATE TABLE attendance_day(status varchar(16) CONSTRAINT attendance_day_status_check CHECK(status IN ('IN_PROGRESS','NEEDS_REVIEW','CONFIRMED')))`,
    );
    await runner.query(
      `CREATE TABLE user_notification(event varchar(64) CONSTRAINT chk_notification_event CHECK(event='MISSING_CHECKOUT'))`,
    );
    const migration = new AttendanceAbsence1792022400000();
    await migration.up(runner);
    await runner.query(
      "INSERT INTO attendance_day VALUES('ABSENT'); INSERT INTO user_notification VALUES('ABSENT')",
    );
    await runner.query('SAVEPOINT populated_absence');
    await assert.rejects(migration.down(runner), /Absence history must be preserved/);
    await runner.query('ROLLBACK TO SAVEPOINT populated_absence');
    await runner.query('DELETE FROM attendance_day; DELETE FROM user_notification');
    await migration.down(runner);
    await runner.query('SAVEPOINT absent_not_allowed');
    await assert.rejects(
      runner.query("INSERT INTO attendance_day VALUES('ABSENT')"),
      /attendance_day_status_check/,
    );
    await runner.query('ROLLBACK TO SAVEPOINT absent_not_allowed');
    await migration.up(runner);
    await runner.query(
      "INSERT INTO attendance_day VALUES('ABSENT'); INSERT INTO user_notification VALUES('ABSENT')",
    );
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await dataSource.destroy();
  }
});
