import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import {
  finalizeMainAuthoritySnapshot,
  MAIN_AUTHORITY_SNAPSHOT_TABLES,
  readMainAuthoritySnapshot,
} from '../../src/modules/zones/main-authority-read-snapshot.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

test('writable authority fence drains a writer before taking its snapshot and rolls back on failure', async () => {
  const owned = createIsolatedTestDatabase();
  const db = owned.dataSource;
  try {
    await owned.initialize();
    const schema = db.driver.schema!;
    assert.match(schema, /^isolated_test_[0-9a-f]{32}$/);
    // Lock mechanics only: no operational archive/coverage qualification is inferred.
    for (const table of MAIN_AUTHORITY_SNAPSHOT_TABLES)
      await db.query(`CREATE TABLE IF NOT EXISTS "${schema}"."${table}" (id integer)`);
    const siteId = randomUUID();
    await db.query('INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,$2)', [
      siteId,
      'before',
    ]);
    const writer = db.createQueryRunner();
    await writer.connect();
    await writer.startTransaction();
    let entered = false;
    let pending: Promise<{ error?: unknown; value?: string }> | undefined;
    try {
      await writer.query('UPDATE site SET name=$2 WHERE id=$1', [siteId, 'after-writer']);
      pending = finalizeMainAuthoritySnapshot(db, async (manager) => {
        entered = true;
        const [row] = await manager.query('SELECT name FROM site WHERE id=$1', [siteId]);
        assert.equal(row.name, 'after-writer');
        const [mode] = await manager.query('SHOW transaction_read_only');
        assert.equal(mode.transaction_read_only, 'off');
        await manager.query('UPDATE site SET name=$2 WHERE id=$1', [siteId, 'finalized']);
        return 'committed';
      }).then(
        (value) => ({ value }),
        (error) => ({ error }),
      );
      let waiting = false;
      for (let attempt = 0; attempt < 50; attempt++) {
        const [row] = await db.query(
          `SELECT EXISTS(
          SELECT 1 FROM pg_catalog.pg_locks l
          JOIN pg_catalog.pg_class c ON c.oid=l.relation
          JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname=$1 AND c.relname='site' AND l.mode='ShareLock' AND NOT l.granted
        ) AS waiting`,
          [schema],
        );
        if (row.waiting) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(waiting, true, 'actual authority SHARE lock must wait for the writer');
      assert.equal(entered, false);
      await writer.commitTransaction();
      const completed = await pending;
      if (completed.error) throw completed.error;
      assert.equal(completed.value, 'committed');
    } finally {
      if (writer.isTransactionActive) await writer.rollbackTransaction();
      if (pending) await pending;
      await writer.release();
    }
    assert.equal(
      (await db.query('SELECT name FROM site WHERE id=$1', [siteId]))[0].name,
      'finalized',
    );
    await assert.rejects(
      finalizeMainAuthoritySnapshot(db, async (manager) => {
        await manager.query('UPDATE site SET name=$2 WHERE id=$1', [siteId, 'must-rollback']);
        throw new Error('owned-finalizer-failure');
      }),
      /owned-finalizer-failure/,
    );
    assert.equal(
      (await db.query('SELECT name FROM site WHERE id=$1', [siteId]))[0].name,
      'finalized',
    );
    await assert.rejects(
      readMainAuthoritySnapshot(db, (manager) =>
        manager.query('UPDATE site SET name=$2 WHERE id=$1', [siteId, 'read-only-write']),
      ),
      (error: unknown) => (error as { code?: string }).code === '25006',
    );
  } finally {
    await owned.dispose();
  }
});
