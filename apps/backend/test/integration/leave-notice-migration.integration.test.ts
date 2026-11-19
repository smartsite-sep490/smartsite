import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { QueryFailedError } from 'typeorm';
import dataSource from '../support/test-data-source.js';
import { LeaveNotice1795046400000 } from '../../src/database/migrations/1795046400000-LeaveNotice.js';
import { AbsenceRequestEntity, AbsenceRequestStatus } from '../../src/database/entities/index.js';

test('leave migration restores attendance absence reads on a database from before notice classification', async () => {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const schema = `leave_read_${randomUUID().replaceAll('-', '')}`;
    await runner.query(`CREATE SCHEMA "${schema}"`);
    await runner.query(`SET LOCAL search_path TO "${schema}"`);
    await runner.query('CREATE TABLE absence_request (LIKE public.absence_request)');
    await runner.query(
      'ALTER TABLE absence_request DROP COLUMN notice_type, DROP COLUMN short_notice',
    );
    const repository = runner.manager.getRepository(AbsenceRequestEntity);
    const siteId = randomUUID();
    // Both attendance endpoints select the full entity, including the new nullable columns.
    await runner.query('SAVEPOINT before_read');
    await assert.rejects(
      repository.findBy({ siteId }),
      (error: unknown) => error instanceof QueryFailedError && error.driverError.code === '42703',
    );
    await runner.query('ROLLBACK TO SAVEPOINT before_read');

    await new LeaveNotice1795046400000().up(runner);
    assert.deepEqual(
      await repository.find({ where: { siteId }, order: { createdAt: 'DESC' }, take: 100 }),
      [],
    );
    assert.deepEqual(
      await repository.findBy({
        siteId,
        workerScheduleId: randomUUID(),
        status: AbsenceRequestStatus.APPROVED,
      }),
      [],
    );
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await dataSource.destroy();
  }
});

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
