import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import dataSource from '../support/test-data-source.js';
import { LeaveNotice1795046400000 } from '../../src/database/migrations/1795046400000-LeaveNotice.js';

test('leave migration preserves unknown historical notice and refuses to discard new metadata', async () => {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const schema = `leave_${randomUUID().replaceAll('-', '')}`;
    await runner.query(`CREATE SCHEMA "${schema}"`);
    await runner.query(`SET LOCAL search_path TO "${schema}"`);
    await runner.query('CREATE TABLE absence_request(id integer PRIMARY KEY, reason text)');
    await runner.query("INSERT INTO absence_request VALUES(1, 'Historical leave')");
    const migration = new LeaveNotice1795046400000();
    await migration.up(runner);
    const [old] = await runner.query('SELECT * FROM absence_request');
    assert.equal(old.notice_type, null);
    assert.equal(old.short_notice, null);
    await runner.query(
      "INSERT INTO absence_request VALUES(2, 'Unexpected illness', 'EMERGENCY', true)",
    );
    await runner.query('SAVEPOINT with_history');
    await assert.rejects(migration.down(runner), /history must be preserved/);
    await runner.query('ROLLBACK TO SAVEPOINT with_history');
    await runner.query('DELETE FROM absence_request WHERE id=2');
    await migration.down(runner);
    assert.deepEqual(await runner.query('SELECT * FROM absence_request'), [
      { id: 1, reason: 'Historical leave' },
    ]);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await dataSource.destroy();
  }
});
