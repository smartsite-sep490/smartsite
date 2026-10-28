import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import * as entities from '../src/database/entities/index.js';
import { CanonicalMf06Requests1794096000000 } from '../src/database/migrations/1794096000000-CanonicalMf06Requests.js';
import { createIsolatedTestDatabase } from './support/isolated-test-database.js';
import { checkPopulated } from './support/mf06-storage-cases.js';

test('MF06 storage matches registered metadata and preserves populated immutable bindings', async () => {
  const owned = createIsolatedTestDatabase();
  let runner;
  try {
    await owned.initialize();
    const drift = await owned.dataSource.driver.createSchemaBuilder().log();
    assert.deepEqual(drift.upQueries, []);
    runner = owned.dataSource.createQueryRunner();
    await runner.connect();
    await checkPopulated(
      owned.dataSource,
      runner,
      new CanonicalMf06Requests1794096000000(),
      entities,
    );
  } finally {
    if (runner) await runner.release();
    await owned.dispose();
  }
});

test('MF06 migration rejects shadow schemas and collisions without losing existing Site data', async () => {
  const owned = createIsolatedTestDatabase();
  let runner;
  const migration = new CanonicalMf06Requests1794096000000();
  try {
    await owned.initialize();
    runner = owned.dataSource.createQueryRunner();
    await runner.connect();
    const [{ name }] = await runner.query('SELECT current_schema() AS name');
    assert.match(name, /^isolated_test_[0-9a-f]{32}$/);
    for (const table of [
      'zone',
      'ai_observation_event',
      'zone_entry_assessment_request',
      'zone_entry_assessment_job',
    ]) {
      await runner.startTransaction();
      try {
        await runner.query(`CREATE TEMP TABLE ${table}(id uuid) ON COMMIT DROP`);
        await assert.rejects(migration.down(runner), /Temporary relations/);
      } finally {
        await runner.rollbackTransaction();
      }
    }
    await runner.startTransaction();
    try {
      await assert.rejects(migration.up(runner), /Existing MF06 storage objects/);
    } finally {
      await runner.rollbackTransaction();
    }
    await runner.startTransaction();
    try {
      await runner.query(`CREATE SCHEMA "${name}_empty"`);
      await runner.query(`SET LOCAL search_path="${name}_empty","${name}"`);
      await assert.rejects(migration.down(runner), /target schema/);
    } finally {
      await runner.rollbackTransaction();
    }
    await migration.down(runner);
    const site = randomUUID();
    await owned.dataSource
      .getRepository(entities.SiteEntity)
      .insert({ id: site, code: site, name: 'Prior migration Site' });
    await assert.rejects(migration.up(runner), /requires a transaction/);
    for (const table of ['zone', 'ai_observation_event', 'zone_entry_assessment_request']) {
      await runner.startTransaction();
      try {
        await runner.query(`CREATE TEMP TABLE ${table}(id uuid) ON COMMIT DROP`);
        await assert.rejects(migration.up(runner), /Temporary relations/);
      } finally {
        await runner.rollbackTransaction();
      }
    }
    await runner.startTransaction();
    try {
      await runner.query(`CREATE SCHEMA "${name}_empty"`);
      await runner.query(`SET LOCAL search_path="${name}_empty","${name}"`);
      await assert.rejects(migration.up(runner), /target schema/);
    } finally {
      await runner.rollbackTransaction();
    }
    await runner.startTransaction();
    try {
      await migration.up(runner);
      await runner.commitTransaction();
    } catch (error) {
      await runner.rollbackTransaction();
      throw error;
    }
    assert.equal(
      await owned.dataSource.getRepository(entities.SiteEntity).countBy({ id: site }),
      1,
    );
    const drift = await owned.dataSource.driver.createSchemaBuilder().log();
    assert.deepEqual(drift.upQueries, []);
  } finally {
    if (runner) await runner.release();
    await owned.dispose();
  }
});
