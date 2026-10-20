import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { readMainAuthoritySnapshot } from '../../src/modules/zones/main-authority-read-snapshot.js';
import { MAIN_AUTHORITY_V2_SOURCES } from '../../src/common/configuration/main-team-authority-sources.js';

const owned = createIsolatedTestDatabase();
const db = owned.dataSource;
const schema = (db.options as { schema: string }).schema;
before(async () => {
  console.log(`ownedAuthoritySnapshotSchema=${schema}`);
  await owned.initialize();
});
after(() => owned.dispose());

test('read-only SERIALIZABLE snapshot drains an actual pre-event source writer', async () => {
  const writer = db.createQueryRunner(),
    observer = db.createQueryRunner();
  const id = randomUUID();
  try {
    await writer.startTransaction();
    await writer.query(
      "INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic pending Site')",
      [id],
    );
    const pending = readMainAuthoritySnapshot(db, async (manager) => {
      const [mode] = await manager.query(
        "SELECT current_setting('transaction_read_only') AS readonly,current_setting('transaction_isolation') AS isolation",
      );
      assert.deepEqual(mode, { readonly: 'on', isolation: 'serializable' });
      const [row] = await manager.query('SELECT name FROM site WHERE id=$1', [id]);
      assert.equal(row?.name, 'Synthetic pending Site');
      const [locks] = await manager.query(
        `SELECT count(*)::integer AS count FROM pg_locks l
        JOIN pg_class c ON c.oid=l.relation JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE l.pid=pg_backend_pid() AND l.granted AND l.mode='ShareLock'
        AND n.nspname=$1 AND c.relname=ANY($2::text[])`,
        [schema, MAIN_AUTHORITY_V2_SOURCES.map(([, table]) => table)],
      );
      assert.equal(locks.count, MAIN_AUTHORITY_V2_SOURCES.length);
      await assert.rejects(
        manager.query("UPDATE site SET name='Forbidden' WHERE id=$1", [id]),
        (error: unknown) =>
          (error as { driverError?: { code?: string } }).driverError?.code === '25006',
      );
    });
    let waiting = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const [state] = await observer.query(
        `SELECT EXISTS(SELECT 1 FROM pg_locks l JOIN pg_class c ON c.oid=l.relation
        JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT l.granted AND l.mode='ShareLock'
        AND n.nspname=$1 AND c.relname='site') AS waiting`,
        [schema],
      );
      if ((waiting = state.waiting)) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(waiting, true);
    await writer.commitTransaction();
    await pending;
  } finally {
    if (writer.isTransactionActive) await writer.rollbackTransaction();
    await writer.release();
    await observer.release();
  }
});

test('failed snapshot operation releases source locks', async () => {
  await assert.rejects(
    readMainAuthoritySnapshot(db, async () => {
      throw new Error('Synthetic callback failure');
    }),
    /Synthetic callback failure/,
  );
  const writer = db.createQueryRunner();
  try {
    await writer.startTransaction();
    await writer.query("SET LOCAL lock_timeout='250ms'");
    await writer.query('LOCK TABLE site IN ROW EXCLUSIVE MODE NOWAIT');
    await writer.rollbackTransaction();
  } finally {
    if (writer.isTransactionActive) await writer.rollbackTransaction();
    await writer.release();
  }
});
