import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { DataSource } from 'typeorm';
import { buildMigrationOptions } from '../../src/database/typeorm.migration-profile.js';
import { TrackedCameraPpeWire1795046400011 } from '../../src/database/migrations/1795046400011-TrackedCameraPpeWire.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { resolveTestDatabaseUrl } from '../support/test-environment.js';
import { seedTrackedFrameFixture } from '../support/tracked-frame-fixture.js';

test('explicit v1.7 fresh CLI profile installs and reverses only the unused forward fence', async () => {
  const owned = createIsolatedTestDatabase();
  const options = buildMigrationOptions(
    { DATABASE_URL: resolveTestDatabaseUrl() },
    { profile: 'tracked-v17-identification-ppe', schema: owned.dataSource.driver.schema! },
  );
  owned.dataSource.setOptions(options);
  const cli = new DataSource(options);
  try {
    await owned.initialize();
    await cli.initialize();
    assert.deepEqual(await cli.runMigrations(), []);
    const names = await cli.query<Array<{ name: string }>>(
      'SELECT name FROM migrations ORDER BY timestamp',
    );
    assert.equal(names.at(-1)?.name, 'TrackedCameraPpeWire1795046400011');
    await cli.undoLastMigration();
    assert.deepEqual(
      (await cli.runMigrations()).map((migration) => migration.name),
      ['TrackedCameraPpeWire1795046400011'],
    );
  } finally {
    if (cli.isInitialized) await cli.destroy();
    await owned.dispose();
  }
});

for (const variant of ['fresh', 'upgrade'] as const) {
  test(`v1.7 forward wire fence preserves predecessor and retained generations: ${variant}`, async () => {
    const owned = createIsolatedTestDatabase();
    const db = owned.dataSource;
    let cli: DataSource | undefined;
    let runtime: DataSource | undefined;
    try {
      const selection = { profile: 'tracked-v16-identification-ppe', schema: db.driver.schema! };
      const options = buildMigrationOptions({ DATABASE_URL: resolveTestDatabaseUrl() }, selection);
      if (variant === 'fresh') db.setOptions(options);
      await owned.initialize();
      cli = new DataSource(options);
      await cli.initialize();
      await cli.runMigrations();
      runtime = new DataSource(
        buildMigrationOptions(
          { DATABASE_URL: resolveTestDatabaseUrl() },
          { ...selection, runtime: true },
        ),
      );
      await runtime.initialize();
      const fixture = await seedTrackedFrameFixture(runtime);
      const checks = () =>
        db.query(`SELECT r.relname,c.conname,pg_get_constraintdef(c.oid) AS definition
        FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
        WHERE n.nspname=current_schema() AND c.conname IN ('chk_ai_event_tracking_fields','chk_generation_tracked_wire_version','chk_v16_requires_tracked_route','chk_v17_requires_tracked_route')
        ORDER BY r.relname,c.conname`);
      const before = await checks();
      const migration = new TrackedCameraPpeWire1795046400011();
      await db.transaction((manager) => migration.up(manager.queryRunner!));
      const widened = await checks();
      assert.equal(widened.length, before.length + 1);
      assert.ok(widened.some((row: { definition: string }) => row.definition.includes('1.7.0')));
      await assert.rejects(
        db.transaction((manager) => migration.up(manager.queryRunner!)),
        /constraint source pin changed/,
      );
      assert.deepEqual(await checks(), widened);
      await db.transaction((manager) => migration.down(manager.queryRunner!));
      assert.deepEqual(await checks(), before);
      await db.transaction((manager) => migration.up(manager.queryRunner!));
      assert.deepEqual(await checks(), widened);
      await db.query(
        "UPDATE camera_worker_generation SET observation_route_mode='EPISODE_TRACKED',tracking_route_epoch=$2,tracked_wire_version='1.7.0' WHERE id=$1",
        [fixture.generation.workerGenerationId, randomUUID()],
      );
      await assert.rejects(
        db.transaction((manager) => migration.down(manager.queryRunner!)),
        /v1.7 tracked history must be retained/,
      );
      assert.deepEqual(await checks(), widened);
      await assert.rejects(
        db.query("UPDATE camera_worker_generation SET tracked_wire_version='1.6.0' WHERE id=$1", [
          fixture.generation.workerGenerationId,
        ]),
        /Tracked generation wire version is immutable/,
      );
      assert.deepEqual(
        await db.query('SELECT tracked_wire_version FROM camera_worker_generation WHERE id=$1', [
          fixture.generation.workerGenerationId,
        ]),
        [{ tracked_wire_version: '1.7.0' }],
      );
      assert.deepEqual(await checks(), widened);
    } finally {
      if (runtime?.isInitialized) await runtime.destroy();
      if (cli?.isInitialized) await cli.destroy();
      await owned.dispose();
    }
  });
}
