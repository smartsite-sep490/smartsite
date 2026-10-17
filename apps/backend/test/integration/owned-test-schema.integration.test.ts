import 'reflect-metadata';
import assert from 'node:assert/strict';
import { Client } from 'pg';
import { test } from 'node:test';
import type { QueryRunner } from 'typeorm';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { resolveTestDatabaseUrl } from '../support/test-environment.js';

async function outside(client: Client) {
  return (
    await client.query(`
    SELECT 'schema' kind,nspname name,oid::text identity FROM pg_namespace
    WHERE nspname NOT LIKE 'pg_%' AND nspname<>'information_schema'
    UNION ALL
    SELECT 'relation',relname,c.oid::text FROM pg_class c JOIN pg_namespace n
      ON n.oid=c.relnamespace WHERE n.nspname='public'
    UNION ALL
    SELECT 'function',proname,p.oid::text FROM pg_proc p JOIN pg_namespace n
      ON n.oid=p.pronamespace WHERE n.nspname='public'
    UNION ALL
    SELECT 'type',typname,t.oid::text FROM pg_type t JOIN pg_namespace n
      ON n.oid=t.typnamespace WHERE n.nspname='public'
    ORDER BY kind,name,identity
  `)
  ).rows;
}

for (const legacy of [false, true]) {
  test(`owned ${legacy ? 'legacy24' : 'canonical'} fixture leaves public and other schemas unchanged`, async () => {
    const client = new Client({ connectionString: resolveTestDatabaseUrl() });
    const fixture = createIsolatedTestDatabase(legacy ? { legacy: true } : { canonical: true });
    await client.connect();
    try {
      const before = await outside(client);
      try {
        await fixture.initialize();
        assert.match(
          (await fixture.dataSource.query('SELECT current_schema() value'))[0].value,
          /^isolated_test_[a-f0-9]{32}$/,
        );
        assert.equal(
          (await fixture.dataSource.query('SELECT count(*)::int value FROM migrations'))[0].value,
          fixture.dataSource.migrations.length,
        );
      } finally {
        await fixture.dispose();
      }
      assert.deepEqual(await outside(client), before);
    } finally {
      await client.end();
    }
  });
}

class RejectOwnedMigration1792454399999 {
  async up(runner: QueryRunner) {
    await runner.query('CREATE TABLE owned_failure_probe (id integer PRIMARY KEY)');
    throw new Error('Synthetic migration refusal');
  }
  async down() {
    throw new Error('Synthetic fixture must be disposed');
  }
}

test('failed owned migration can be disposed without leaving schema, tables or public extension', async () => {
  const client = new Client({ connectionString: resolveTestDatabaseUrl() });
  const fixture = createIsolatedTestDatabase({ canonical: true });
  fixture.dataSource.setOptions({ migrations: [RejectOwnedMigration1792454399999] });
  await client.connect();
  try {
    const before = await outside(client);
    try {
      await assert.rejects(fixture.initialize(), /Synthetic migration refusal/);
    } finally {
      await fixture.dispose();
    }
    assert.deepEqual(await outside(client), before);
  } finally {
    await client.end();
  }
});
