import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DataSource } from 'typeorm';
import { hasMainAuthorityCapture } from '../../src/common/configuration/main-authority-capture-preflight.js';
import { buildMigrationOptions } from '../../src/database/typeorm.migration-profile.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { resolveTestDatabaseUrl } from '../support/test-environment.js';

test('authority preflight validates pinned function paths independently of pooled session defaults', async () => {
  const owned = createIsolatedTestDatabase();
  let authority: DataSource | undefined;
  try {
    await owned.initialize();
    const schema = owned.dataSource.driver.schema;
    assert.ok(schema);
    authority = new DataSource(
      buildMigrationOptions(
        { DATABASE_URL: resolveTestDatabaseUrl() },
        { profile: 'tracked-v17-identification-ppe-authority', schema },
      ),
    );
    await authority.initialize();
    await authority.runMigrations();
    assert.equal(await hasMainAuthorityCapture(authority.manager), true);

    await authority.transaction(async (manager) => {
      // Simulate connection-pool/session variation without changing stored functions.
      await manager.query("SELECT set_config('search_path', $1, true)", [
        `"$user", ${schema}, public`,
      ]);
      assert.deepEqual(await manager.query('SELECT current_schema() AS schema'), [{ schema }]);
      assert.equal(await hasMainAuthorityCapture(manager), true);
      assert.equal(await hasMainAuthorityCapture(manager, ['app_user', 'worker']), true);
    });

    const runner = authority.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      // An unsafe stored function path still fails, even when it equals the caller's.
      await runner.query('ALTER FUNCTION mf06_assignment_response(uuid) SET search_path TO public');
      assert.equal(await hasMainAuthorityCapture(runner.manager), false);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }

    await authority.transaction(async (manager) => {
      await manager.query("SELECT set_config('search_path', 'pg_catalog', true)");
      await assert.rejects(hasMainAuthorityCapture(manager), (error: unknown) => {
        assert.equal((error as { driverError?: { code?: string } }).driverError?.code, '42P01');
        return true;
      });
    });
    assert.equal(await hasMainAuthorityCapture(authority.manager), true);
  } finally {
    if (authority?.isInitialized) await authority.destroy();
    await owned.dispose();
  }
});
