import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { DataSource } from 'typeorm';
import { buildTypeOrmOptions } from '../../src/database/typeorm.options.js';
import { resolveTestDatabaseUrl } from '../support/test-environment.js';

test('combined Safety/Identity/Workforce migrations initialize a fresh schema and rerun without changes', async () => {
  const schema = `safety_workforce_fresh_${randomUUID().replaceAll('-', '')}`;
  const options = buildTypeOrmOptions({ DATABASE_URL: resolveTestDatabaseUrl() });
  if (options.type !== 'postgres') throw new Error('Dedicated PostgreSQL test source required');
  const control = new DataSource(options);
  const fresh = new DataSource({
    ...options,
    schema,
    // Every pooled connection must stay in this isolated test schema, including
    // the runner created internally by runMigrations(). No public fallback.
    extra: { ...options.extra, options: `-c search_path=${schema}` },
  });
  await control.initialize();
  try {
    await control.query(`CREATE SCHEMA "${schema}"`);
    await fresh.initialize();
    const applied = await fresh.runMigrations();
    assert.equal(applied.length, fresh.migrations.length);
    assert.equal((await fresh.runMigrations()).length, 0);
    const runner = fresh.createQueryRunner();
    try {
      for (const table of [
        'worker',
        'contractor',
        'contractor_site_participation',
        'contractor_representative_grant',
        'contractor_representative_assignment',
        'worker_site_zone_assignment',
        'zone_access_grant',
        'observation_identity_decision',
        'worker_schedule',
      ]) {
        assert.equal(await runner.hasTable(table), true, `Missing ${table}`);
      }
      assert.equal(await runner.hasColumn('contractor', 'site_id'), false);
      assert.equal(await runner.hasColumn('worker', 'contractor_id'), true);
      assert.equal(await runner.hasColumn('worker', 'user_id'), true);
      assert.equal(await fresh.getRepository('worker').count(), 0);
      assert.equal(await fresh.getRepository('zone_access_grant').count(), 0);
    } finally {
      await runner.release();
    }
  } finally {
    if (fresh.isInitialized) await fresh.destroy();
    await control.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await control.destroy();
  }
});
