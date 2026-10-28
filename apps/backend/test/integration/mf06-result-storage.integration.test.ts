import assert from 'node:assert/strict';
import test from 'node:test';
import { CanonicalMf06Results1794182400000 } from '../../src/database/migrations/1794182400000-CanonicalMf06Results.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { checkResults } from '../support/mf06-result-storage-cases.js';

test('registered immutable MF06 result storage matches metadata and preserves V1/V2 binding boundaries', async () => {
  const owned = createIsolatedTestDatabase();
  let runner;
  try {
    await owned.initialize();
    assert.deepEqual((await owned.dataSource.driver.createSchemaBuilder().log()).upQueries, []);
    runner = owned.dataSource.createQueryRunner();
    await runner.connect();
    await checkResults(owned.dataSource, runner, new CanonicalMf06Results1794182400000());
  } finally {
    if (runner) await runner.release();
    await owned.dispose();
  }
});

test('result migration refuses namespace shadows/collisions and reverts empty storage without touching requests', async () => {
  const owned = createIsolatedTestDatabase();
  let runner;
  const migration = new CanonicalMf06Results1794182400000();
  try {
    await owned.initialize();
    runner = owned.dataSource.createQueryRunner();
    await runner.connect();
    const [{ name }] = await runner.query('SELECT current_schema() AS name');
    assert.match(name, /^isolated_test_[a-f0-9]{32}$/);
    for (const method of ['up', 'down'] as const) {
      await assert.rejects(migration[method](runner), /requires a transaction/);
      for (const table of [
        'zone_entry_assessment_request',
        'zone_entry_assessment_job',
        'zone_entry_assessment',
        'zone_entry_authority_artifact',
      ]) {
        await runner.startTransaction();
        try {
          await runner.query(`CREATE TEMP TABLE ${table}(id uuid) ON COMMIT DROP`);
          await assert.rejects(migration[method](runner), /Temporary result storage/);
        } finally {
          await runner.rollbackTransaction();
        }
      }
      await runner.startTransaction();
      try {
        await runner.query(`CREATE SCHEMA "${name}_empty"`);
        await runner.query(`SET LOCAL search_path="${name}_empty","${name}"`);
        await assert.rejects(migration[method](runner), /target schema/);
      } finally {
        await runner.rollbackTransaction();
      }
    }
    await runner.startTransaction();
    try {
      await assert.rejects(migration.up(runner), /Existing result objects/);
    } finally {
      await runner.rollbackTransaction();
    }
    const functions = await runner.query(
      "SELECT proconfig FROM pg_catalog.pg_proc WHERE pronamespace=current_schema()::regnamespace AND proname LIKE 'mf06_b2_%'",
    );
    assert.equal(functions.length, 5);
    assert.ok(
      functions.every((f: { proconfig: string[] }) =>
        f.proconfig.some((s) => s.endsWith(', pg_temp')),
      ),
    );
    await runner.startTransaction();
    try {
      await migration.down(runner);
      await runner.commitTransaction();
    } catch (error) {
      await runner.rollbackTransaction();
      throw error;
    }
    assert.equal(
      (await runner.query('SELECT count(*)::int AS n FROM zone_entry_assessment_request'))[0].n,
      0,
    );
    await runner.startTransaction();
    try {
      await migration.up(runner);
      await runner.commitTransaction();
    } catch (error) {
      await runner.rollbackTransaction();
      throw error;
    }
    assert.deepEqual((await owned.dataSource.driver.createSchemaBuilder().log()).upQueries, []);
  } finally {
    if (runner) await runner.release();
    await owned.dispose();
  }
});
