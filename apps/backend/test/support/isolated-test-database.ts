import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { buildTypeOrmOptions } from '../../src/database/typeorm.options.js';
import { resolveTestDatabaseUrl } from './test-environment.js';

/** A file-owned schema; never migrate or truncate another suite's application tables. */
export function createIsolatedTestDatabase() {
  const connection = resolveTestDatabaseUrl();
  assert.equal(new URL(connection).port, '5433', 'Dedicated test PostgreSQL port required');
  const options = buildTypeOrmOptions({ DATABASE_URL: connection });
  assert.equal(options.type, 'postgres');
  const schema = `isolated_test_${randomUUID().replaceAll('-', '')}`;
  assert.match(schema, /^isolated_test_[0-9a-f]{32}$/);
  const control = new DataSource({ ...options, entities: [], migrations: [] });
  const dataSource = new DataSource({
    ...options,
    schema,
    extra: { ...options.extra, options: `-c search_path=${schema}` },
  });
  let created = false;
  return {
    dataSource,
    async initialize() {
      await control.initialize();
      const [identity] = await control.query(
        'SELECT current_database() AS db, current_user AS role',
      );
      assert.deepEqual(identity, { db: 'smartsite_test', role: 'smartsite_test' });
      await control.query(`CREATE SCHEMA "${schema}"`);
      created = true;
      await dataSource.initialize();
      const [scope] = await dataSource.query('SELECT current_schema() AS name');
      assert.equal(scope.name, schema);
      await dataSource.runMigrations();
    },
    async dispose() {
      if (dataSource.isInitialized) await dataSource.destroy();
      if (control.isInitialized) {
        try {
          if (created) await control.query(`DROP SCHEMA "${schema}" CASCADE`);
        } finally {
          await control.destroy();
        }
      }
    },
  };
}
