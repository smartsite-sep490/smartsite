import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { withSoftwareSchemaFreeze } from '../../src/database/software-schema-freeze.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { resolveTestDatabaseUrl } from '../support/test-environment.js';
import { recoveryPostgresTools } from '../support/recovery-postgres-tools.js';

test('software snapshot blocks owned writes, permits unrelated namespace writes, and releases after callback failure', async (t) => {
  const own = createIsolatedTestDatabase(),
    other = createIsolatedTestDatabase();
  t.after(async () => {
    await own.dispose();
    await other.dispose();
  });
  await own.initialize();
  await other.initialize();
  const schema =
    own.dataSource.options.type === 'postgres' ? own.dataSource.options.schema : undefined;
  assert.ok(schema);
  const writer = own.dataSource.createQueryRunner();
  await writer.connect();
  try {
    await writer.query('SET lock_timeout=100');
    await assert.rejects(
      withSoftwareSchemaFreeze(own.dataSource, schema, async (snapshot) => {
        assert.equal(snapshot.schema, schema);
        assert.equal(snapshot.tables.find((row) => row.name === 'site')?.rows, 0);
        await assert.rejects(
          writer.query(
            "INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Blocked synthetic Site')",
            [randomUUID()],
          ),
          (error: unknown) => (error as { code?: string }).code === '55P03',
        );
        await other.dataSource.query(
          "INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Unrelated synthetic Site')",
          [randomUUID()],
        );
        throw Error('Controlled callback failure');
      }),
      /Controlled callback failure/,
    );
    await writer.query(
      "INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Released synthetic Site')",
      [randomUUID()],
    );
    assert.equal(Number((await own.dataSource.query('SELECT count(*) n FROM site'))[0].n), 1);
    assert.equal(Number((await other.dataSource.query('SELECT count(*) n FROM site'))[0].n), 1);
  } finally {
    await writer.release();
  }
});

test('software snapshot waits for a preceding writer then captures committed rows without changing them', async (t) => {
  const own = createIsolatedTestDatabase();
  t.after(() => own.dispose());
  await own.initialize();
  const db = own.dataSource,
    schema = db.options.type === 'postgres' ? db.options.schema : undefined;
  assert.ok(schema);
  const writer = db.createQueryRunner();
  await writer.connect();
  try {
    await writer.startTransaction();
    await writer.query(
      "INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Preceding synthetic Site')",
      [randomUUID()],
    );
    let entered = false;
    const frozen = withSoftwareSchemaFreeze(db, schema, async (snapshot) => {
      entered = true;
      assert.equal(snapshot.tables.find((row) => row.name === 'site')?.rows, 1);
      return snapshot;
    });
    await delay(50);
    assert.equal(entered, false);
    await writer.commitTransaction();
    const snapshot = await frozen;
    assert.match(snapshot.snapshotId, /^[0-9A-Fa-f-]+$/);
    assert.equal(Number((await db.query('SELECT count(*) n FROM site'))[0].n), 1);
  } finally {
    if (writer.isTransactionActive) await writer.rollbackTransaction();
    await writer.release();
  }
});

test(
  'software freeze exports a snapshot accepted by an independent bounded PostgreSQL dump',
  {
    skip:
      process.env.SMARTSITE_TEST_PG_BIN || process.env.SMARTSITE_TEST_PG_CONTAINER
        ? false
        : 'Explicit existing PostgreSQL client binaries required',
  },
  async (t) => {
    const postgres = recoveryPostgresTools(
      process.env.SMARTSITE_TEST_PG_BIN,
      process.env.SMARTSITE_TEST_PG_CONTAINER,
    );
    const own = createIsolatedTestDatabase();
    t.after(() => own.dispose());
    await own.initialize();
    const db = own.dataSource,
      schema = db.options.type === 'postgres' ? db.options.schema : undefined;
    assert.ok(schema);
    const root = await mkdtemp(join(tmpdir(), 'smartsite-freeze-snapshot-'));
    const url = new URL(resolveTestDatabaseUrl());
    assert.equal(url.port, '5433');
    await withSoftwareSchemaFreeze(db, schema, async (snapshot) => {
      const file = join(root, 'database.dump');
      postgres(
        'pg_dump',
        [
          '-h',
          url.hostname,
          '-p',
          url.port,
          '-U',
          decodeURIComponent(url.username),
          '-d',
          'smartsite_test',
          '--schema',
          schema,
          '--snapshot',
          snapshot.snapshotId,
          '--format=custom',
          '--file',
          file,
        ],
        {
          ...process.env,
          PGPASSWORD: decodeURIComponent(url.password),
        },
      );
      const bytes = await readFile(file);
      assert.equal(bytes.subarray(0, 5).toString(), 'PGDMP');
      assert.equal(snapshot.tables.find((row) => row.name === 'mf06_authority_source')?.rows, 18);
    });
  },
);
