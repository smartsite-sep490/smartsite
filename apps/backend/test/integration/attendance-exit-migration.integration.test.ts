import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import source from '../support/test-data-source.js';
import { ShiftExitGracePeriod1792281600000 } from '../../src/database/migrations/1792281600000-ShiftExitGracePeriod.js';
import { AttendanceExitNotifications1792281600001 } from '../../src/database/migrations/1792281600001-AttendanceExitNotifications.js';

test('exit migrations backfill policies, allow violations and preserve notification history on rollback', async () => {
  await source.initialize();
  const runner = source.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const schema = `exit_${randomUUID().replaceAll('-', '')}`;
    await runner.query(`CREATE SCHEMA "${schema}"; SET LOCAL search_path TO "${schema}"`);
    await runner.query(`CREATE TABLE shift(id integer); INSERT INTO shift VALUES(1);
      CREATE TABLE attendance_day(id integer); INSERT INTO attendance_day VALUES(1);
      CREATE TABLE user_notification(event varchar(24) CONSTRAINT chk_notification_event CHECK(event='ABSENT'));
      INSERT INTO user_notification VALUES('ABSENT')`);
    const policy = new ShiftExitGracePeriod1792281600000();
    const notifications = new AttendanceExitNotifications1792281600001();
    await policy.up(runner);
    const [row] = await runner.query(
      'SELECT allowed_exit_minutes, max_exit_count, exit_count, deducted_minutes FROM attendance_day',
    );
    assert.deepEqual(row, {
      allowed_exit_minutes: 15,
      max_exit_count: 2,
      exit_count: 0,
      deducted_minutes: 0,
    });
    await notifications.up(runner);
    await runner.query(
      "INSERT INTO user_notification VALUES('EXIT_DURATION_EXCEEDED'),('MAX_EXITS_EXCEEDED')",
    );
    await runner.query('SAVEPOINT preserve_history');
    await assert.rejects(notifications.down(runner), /Exit violation history must be preserved/);
    await runner.query('ROLLBACK TO SAVEPOINT preserve_history');
    await runner.query("DELETE FROM user_notification WHERE event <> 'ABSENT'");
    await notifications.down(runner);
    await notifications.up(runner);
    await policy.down(runner);
    await policy.up(runner);
    assert.equal(
      (
        await runner.query(
          "SELECT count(*)::int AS count FROM user_notification WHERE event='ABSENT'",
        )
      )[0].count,
      1,
    );
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await source.destroy();
  }
});
