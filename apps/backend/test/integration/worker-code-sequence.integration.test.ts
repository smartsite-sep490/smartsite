import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { WorkerCodeSequence1791676800000 } from '../../src/database/migrations/1791676800000-WorkerCodeSequence.js';
import source from '../support/test-data-source.js';

after(async () => {
  if (source.isInitialized) await source.destroy();
});

test('Worker code migration starts beyond legacy codes and reverses without changing Workers', async () => {
  await source.initialize();
  const q = source.createQueryRunner();
  await q.connect();
  await q.startTransaction();
  try {
    const schema = `worker_codes_${randomUUID().replaceAll('-', '')}`;
    await q.query(`CREATE SCHEMA "${schema}"`);
    await q.query(`SET LOCAL search_path TO "${schema}"`);
    await q.query('CREATE TABLE worker (external_id varchar(128) NOT NULL)');
    await q.query(
      "INSERT INTO worker VALUES ('W000009'), ('W12'), ('W000000'), ('LEGACY-900'), ('W999999999999999999999999')",
    );
    const migration = new WorkerCodeSequence1791676800000();
    await migration.up(q);
    const [first] = await q.query("SELECT nextval('worker_code_seq')::text AS number");
    assert.equal(first.number, '13');
    await q.query("INSERT INTO worker VALUES ('W000013')");
    await migration.down(q);
    assert.equal((await q.query('SELECT count(*)::int AS count FROM worker'))[0].count, 6);
    await migration.up(q);
    assert.equal(
      (await q.query("SELECT nextval('worker_code_seq')::text AS number"))[0].number,
      '14',
    );
  } finally {
    await q.rollbackTransaction();
    await q.release();
  }
});
