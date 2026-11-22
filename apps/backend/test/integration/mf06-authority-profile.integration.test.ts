import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { DataSource } from 'typeorm';
import { buildMigrationOptions } from '../../src/database/typeorm.migration-profile.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { resolveTestDatabaseUrl } from '../support/test-environment.js';

const authorityMigrations = [
  'InstallAuthorityJournal1795046400012',
  'InstallAuthorityCutover1795046400013',
];

for (const upgrade of [false, true]) {
  test(`MF06 authority profile preserves Main history and data with tracked upgrade=${upgrade}`, async () => {
    const owned = createIsolatedTestDatabase();
    const sources: DataSource[] = [];
    try {
      await owned.initialize();
      const db = owned.dataSource;
      const siteId = randomUUID();
      await db.query(
        "INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Retained authority test site')",
        [siteId],
      );
      const open = async (profile: string) => {
        const source = new DataSource(
          buildMigrationOptions(
            { DATABASE_URL: resolveTestDatabaseUrl() },
            { profile, schema: db.driver.schema },
          ),
        );
        sources.push(source);
        return source.initialize();
      };
      if (upgrade) await (await open('tracked-v17-identification-ppe')).runMigrations();
      const before = await db.query<{ timestamp: string; name: string }[]>(
        'SELECT timestamp,name FROM migrations ORDER BY id',
      );
      assert.ok(before.some((row) => row.name === 'LeaveNotice1795046400000'));
      const source = await open('tracked-v17-identification-ppe-authority');
      const applied = (await source.runMigrations()).map((row) => row.name);
      assert.deepEqual(upgrade ? applied : applied.slice(-2), authorityMigrations);
      assert.deepEqual(await source.runMigrations(), []);
      const after = await db.query('SELECT timestamp,name FROM migrations ORDER BY id');
      assert.deepEqual(after.slice(0, before.length), before);
      assert.deepEqual(await db.query('SELECT name FROM site WHERE id=$1', [siteId]), [
        { name: 'Retained authority test site' },
      ]);
      assert.deepEqual(
        await db.query('SELECT epoch_id FROM authorization_history_control WHERE singleton=1'),
        [{ epoch_id: null }],
      );
      assert.deepEqual(
        await db.query('SELECT count(*)::int AS count FROM authorization_history_source'),
        [{ count: 18 }],
      );
    } finally {
      for (const source of sources) if (source.isInitialized) await source.destroy();
      await owned.dispose();
    }
  });
}
