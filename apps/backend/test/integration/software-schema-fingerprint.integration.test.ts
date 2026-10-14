import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { DataSource } from 'typeorm';
import * as snapshotModule from '../../src/database/software-schema-freeze.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

test('software row fingerprints are independent of connection timezone and preserve microsecond times', async (t) => {
  const own = createIsolatedTestDatabase();
  t.after(() => own.dispose());
  await own.initialize();
  const db = own.dataSource;
  assert.equal(db.options.type, 'postgres');
  if (db.options.type !== 'postgres') throw Error('Postgres required');
  const schema = db.options.schema;
  assert.ok(schema);
  await db.query(
    "INSERT INTO site(id,code,name,created_at) VALUES($1,$1::uuid::text,'Synthetic timestamp Site','2026-10-01T00:00:00.123456Z')",
    [randomUUID()],
  );
  const utc = new DataSource({
    ...db.options,
    extra: { ...db.options.extra, options: `-c search_path=${schema} -c timezone=UTC` },
  });
  t.after(async () => {
    if (utc.isInitialized) await utc.destroy();
  });
  await utc.initialize();
  const first = await snapshotModule.withSoftwareSchemaFreeze(
    db,
    schema,
    async (snapshot) => snapshot.tables,
  );
  const second = await snapshotModule.withSoftwareSchemaFreeze(
    utc,
    schema,
    async (snapshot) => snapshot.tables,
  );
  assert.deepEqual(
    first,
    second,
    'Same persisted rows must not drift merely because a client uses a different timezone',
  );
});

test('read-only retained-schema fingerprint detects row drift without acquiring write-blocking locks or changing data', async (t) => {
  const own = createIsolatedTestDatabase();
  t.after(() => own.dispose());
  await own.initialize();
  const db = own.dataSource,
    schema = db.options.type === 'postgres' ? db.options.schema : undefined;
  assert.ok(schema);
  const read = (
    snapshotModule as unknown as {
      readSoftwareSchemaFingerprint?: (
        db: DataSource,
        schema: string,
      ) => Promise<{
        schema: string;
        rowHashFormat: string;
        tables: { name: string; rows: number; sha256: string }[];
      }>;
    }
  ).readSoftwareSchemaFingerprint;
  assert.equal(
    typeof read,
    'function',
    'Readonly retained-schema fingerprint is required before restart',
  );
  assert.ok(read);
  const before = await read(db, schema);
  const id = randomUUID();
  await db.query(
    "INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic retained Site')",
    [id],
  );
  const after = await read(db, schema);
  assert.equal(before.schema, schema);
  assert.equal(after.rowHashFormat, 'POSTGRES_JSONB_TEXT_UTC_SHA256_V1');
  assert.equal(before.tables.find((row) => row.name === 'site')?.rows, 0);
  assert.equal(after.tables.find((row) => row.name === 'site')?.rows, 1);
  assert.notEqual(
    after.tables.find((row) => row.name === 'site')?.sha256,
    before.tables.find((row) => row.name === 'site')?.sha256,
  );
  assert.equal(Number((await db.query('SELECT count(*) n FROM site'))[0].n), 1);
});

test('readonly fingerprint keeps its repeatable snapshot while an actual concurrent writer commits', async (t) => {
  const own = createIsolatedTestDatabase();
  t.after(() => own.dispose());
  await own.initialize();
  const db = own.dataSource,
    schema = db.options.type === 'postgres' ? db.options.schema : undefined;
  assert.ok(schema);
  const original = db.createQueryRunner.bind(db);
  let first = true;
  let release: () => void = () => undefined;
  let entered: () => void = () => undefined;
  const reached = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  db.createQueryRunner = (mode) => {
    const runner = original(mode);
    if (first) {
      first = false;
      const query = runner.query.bind(runner);
      runner.query = (async (...args: Parameters<typeof runner.query>) => {
        const [sql] = args;
        const result = await query(...args);
        if (sql.includes(`"${schema}"."site"`) && sql.startsWith('SELECT to_jsonb')) {
          entered();
          await gate;
        }
        return result;
      }) as typeof runner.query;
    }
    return runner;
  };
  let reading: Promise<snapshotModule.SoftwareSchemaFingerprint> | undefined;
  try {
    reading = snapshotModule.readSoftwareSchemaFingerprint(db, schema);
    await Promise.race([
      reached,
      new Promise((_, reject) =>
        setTimeout(() => reject(Error('Reader barrier not reached')), 3000),
      ),
    ]);
    await db.query(
      "INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Concurrent synthetic Site')",
      [randomUUID()],
    );
    release();
    const snapshot = await reading;
    assert.equal(snapshot.tables.find((row) => row.name === 'site')?.rows, 0);
    assert.equal(Number((await db.query('SELECT count(*) n FROM site'))[0].n), 1);
  } finally {
    release();
    db.createQueryRunner = original;
    if (reading) await reading.catch(() => undefined);
  }
});
