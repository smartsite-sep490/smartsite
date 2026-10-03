import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { buildTypeOrmOptions } from '../../src/database/typeorm.options.js';
import { resolveTestDatabaseUrl } from './test-environment.js';

/** File-owned disposable schema. Never truncate audit belonging to another integration suite. */
export function createIsolatedTestDatabase() {
  const schema = `isolated_test_${randomUUID().replaceAll('-', '')}`;
  const options = buildTypeOrmOptions({ DATABASE_URL: resolveTestDatabaseUrl() });
  if (options.type !== 'postgres') throw new Error('Dedicated PostgreSQL required');
  const control = new DataSource(options);
  const dataSource = new DataSource({
    ...options,
    schema,
    extra: { ...options.extra, options: `-c search_path=${schema}` },
  });
  return {
    dataSource,
    async initialize() {
      await control.initialize();
      await control.query(`CREATE SCHEMA "${schema}"`);
      await dataSource.initialize();
      await dataSource.runMigrations();
    },
    async dispose() {
      if (dataSource.isInitialized) await dataSource.destroy();
      if (control.isInitialized) {
        try {
          await control.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } finally {
          await control.destroy();
        }
      }
    },
  };
}
