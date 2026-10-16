import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DataSource } from 'typeorm';
import { DatabaseService } from '../src/database/database.service.js';
import { HealthController } from '../src/modules/health/health.controller.js';

function fixture() {
  const queries: string[] = [];
  const db = {
    isInitialized: true,
    options: { type: 'postgres', migrationsTableName: 'migrations' },
    driver: { schema: 'owned_test_schema' },
    migrations: [{ name: 'Foundation1789689600000' }, { name: 'Configuration1790035200000' }],
    rows: [
      { name: 'Foundation1789689600000', timestamp: '1789689600000' },
      { name: 'Configuration1790035200000', timestamp: '1790035200000' },
    ],
    failure: null as Error | null,
    async query(sql: string) {
      queries.push(sql);
      if (this.failure) throw this.failure;
      return sql === 'SELECT 1' ? [{ '?column?': 1 }] : this.rows;
    },
    async showMigrations() {
      throw new Error('Readiness must not create a migrations table');
    },
    async runMigrations() {
      throw new Error('Readiness must not run migrations');
    },
  };
  const service = new DatabaseService(db as unknown as DataSource);
  return { db, queries, service, health: new HealthController(service) };
}

test('reachable but partially migrated database cannot receive ready traffic', async () => {
  const f = fixture();
  f.db.rows.pop();
  assert.equal(await f.service.isReachable(), true);
  await assert.rejects(f.health.ready(), (error: unknown) => {
    const value = error as { getStatus(): number; publicPayload: { code: string } };
    assert.equal(value.getStatus(), 503);
    assert.equal(value.publicPayload.code, 'DATABASE_UNAVAILABLE');
    return true;
  });
  assert.deepEqual(f.health.live(), { status: 'ok', service: 'smartsite-backend' });
});

test('required migrations restored after a pending check recover readiness without restarting', async () => {
  const f = fixture();
  const missing = f.db.rows.pop()!;
  await assert.rejects(f.health.ready());
  f.db.rows.push(missing);
  assert.deepEqual(await f.health.ready(), {
    status: 'ok',
    service: 'smartsite-backend',
    database: 'up',
  });
  assert.ok(
    f.queries.every((sql) => /^SELECT\b/.test(sql)),
    'only read queries are allowed',
  );
});

test('missing/inaccessible migration history fails closed without exposing driver details', async () => {
  const f = fixture();
  f.db.failure = new Error('relation owned_private.migrations does not exist; fake-password');
  await assert.rejects(f.health.ready(), (error: unknown) => {
    const value = error as { getStatus(): number; publicPayload: unknown };
    assert.equal(value.getStatus(), 503);
    assert.equal(JSON.stringify(value.publicPayload).includes('owned_private'), false);
    assert.equal(JSON.stringify(value.publicPayload).includes('fake-password'), false);
    return true;
  });
});

test('a migration name with a mismatched timestamp cannot satisfy release readiness', async () => {
  const f = fixture();
  f.db.rows[1]!.timestamp = '1790035200001';
  await assert.rejects(f.health.ready());
});

test('malformed history and unavailable loaded migration metadata cannot become ready', async () => {
  for (const change of [
    (f: ReturnType<typeof fixture>) => {
      f.db.rows = [];
    },
    (f: ReturnType<typeof fixture>) => {
      f.db.migrations = [];
    },
    (f: ReturnType<typeof fixture>) => {
      f.db.migrations[0]!.name = 'missing_timestamp';
    },
    (f: ReturnType<typeof fixture>) => {
      f.db.rows[0]!.timestamp = 'not-an-integer';
    },
    (f: ReturnType<typeof fixture>) => {
      f.db.driver.schema = '';
    },
  ]) {
    const f = fixture();
    change(f);
    await assert.rejects(f.health.ready());
  }
});

test('migration history is read from the actual driver schema and custom table, never a default fallback', async () => {
  const f = fixture();
  f.db.driver.schema = 'owned."quoted';
  f.db.options.migrationsTableName = 'history"table';
  await f.health.ready();
  assert.ok(f.queries.some((sql) => sql.includes('"owned.""quoted"."history""table"')));
  assert.equal(
    f.queries.some((sql) => sql.includes('"public"')),
    false,
  );
});

test('uninitialized database stays unready without querying, and newer release history is tolerated', async () => {
  const f = fixture();
  f.db.isInitialized = false;
  await assert.rejects(f.health.ready());
  assert.deepEqual(f.queries, []);
  f.db.isInitialized = true;
  f.db.rows.push({ name: 'NewerRelease1799999999999', timestamp: '1799999999999' });
  assert.equal((await f.health.ready()).database, 'up');
});
