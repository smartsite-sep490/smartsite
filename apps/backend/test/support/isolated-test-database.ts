import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { buildTypeOrmOptions } from '../../src/database/typeorm.options.js';
import { resolveTestDatabaseUrl } from './test-environment.js';
import { LEGACY_TEST_MIGRATIONS } from './legacy-test-migrations.js';

/** File-owned disposable schema. Never truncate audit belonging to another integration suite. */
export function createIsolatedTestDatabase(
  profile: { canonical?: true; legacy?: never } | { legacy: true; canonical?: never } = {},
) {
  const schema = `isolated_test_${randomUUID().replaceAll('-', '')}`;
  const productionOptions = buildTypeOrmOptions({ DATABASE_URL: resolveTestDatabaseUrl() });
  // Default is the actual release graph. Old branch fixtures opt into frozen24
  // explicitly; their PASS never proves canonical MAIN behavior.
  const options = profile.legacy
    ? { ...productionOptions, migrations: [...LEGACY_TEST_MIGRATIONS] }
    : productionOptions;
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
