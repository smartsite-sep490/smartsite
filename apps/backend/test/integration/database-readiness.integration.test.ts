import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { DatabaseService } from '../../src/database/database.service.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

// Existing validated TEST_DATABASE_URL only. No runtime DataSource or AI action.
const isolated = createIsolatedTestDatabase({ legacy: true });
const db = isolated.dataSource;
const service = new DatabaseService(db);
before(() => isolated.initialize());
after(() => isolated.dispose());

test('readiness accepts the real migrated file-owned schema', async () => {
  assert.equal(await service.isReachable(), true);
  assert.equal(await service.isReady(), true);
});

test('a release requiring an additional migration remains unready without running it', async () => {
  const originalLength = db.migrations.length;
  db.migrations.push({
    name: 'SyntheticPending1999999999999',
    async up() {
      throw new Error('Readiness must not execute a migration');
    },
    async down() {
      throw new Error('Readiness must not revert a migration');
    },
  });
  try {
    assert.equal(await service.isReachable(), true);
    assert.equal(await service.isReady(), false);
  } finally {
    db.migrations.splice(originalLength);
  }
  assert.equal(await service.isReady(), true);
});

test('a missing owned history table stays missing; readiness never creates it', async () => {
  const schema = db.driver.schema;
  assert.ok(schema);
  assert.ok(schema.startsWith('isolated_test_'));
  // Exact helper-generated schema only; identifiers are independently quoted.
  const qualified = `"${schema.replaceAll('"', '""')}"`;
  await db.query(`ALTER TABLE ${qualified}."migrations" RENAME TO "readiness_saved_history"`);
  try {
    assert.equal(await service.isReachable(), true);
    assert.equal(await service.isReady(), false);
    const rows = await db.query(
      'SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2',
      [schema, 'migrations'],
    );
    assert.equal(rows[0].count, 0, 'no showMigrations() creation side effect');
  } finally {
    await db.query(`ALTER TABLE ${qualified}."readiness_saved_history" RENAME TO "migrations"`);
  }
  assert.equal(await service.isReady(), true);
});
