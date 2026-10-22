import assert from 'node:assert/strict';
import { reviewedReleaseMigrationNames } from './reviewed-release-graph.js';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { buildTypeOrmOptions } from '../../src/database/typeorm.options.js';
import { resolveTestDatabaseUrl } from './test-environment.js';
import { LEGACY_TEST_MIGRATIONS } from './legacy-test-migrations.js';
import { Legacy24TestDataSource, LEGACY_ENTITIES } from './legacy24/data-source.js';

/** File-owned disposable schema. Never truncate audit belonging to another integration suite. */
export function createIsolatedTestDatabase(
  profile:
    | { canonical?: true; legacy?: never; preAuthorityCutover72?: true }
    | { legacy: true; canonical?: never; preAuthorityCutover72?: never } = {},
) {
  const schema = `isolated_test_${randomUUID().replaceAll('-', '')}`;
  let productionOptions = buildTypeOrmOptions({ DATABASE_URL: resolveTestDatabaseUrl() });
  if (profile.preAuthorityCutover72) {
    const migrations = productionOptions.migrations;
    assert(Array.isArray(migrations));
    const names = reviewedReleaseMigrationNames(migrations);
    assert.equal(names.length, 73);
    assert.equal(names.at(-1), 'AuthorizationHistoryCutover1793232000000');
    productionOptions = { ...productionOptions, migrations: migrations.slice(0, -1) };
    assert.equal(reviewedReleaseMigrationNames(productionOptions.migrations).length, 72);
  }
  // Default is the actual release graph. Old branch fixtures opt into frozen24
  // explicitly; their PASS never proves canonical MAIN behavior.
  const options = profile.legacy
    ? {
        ...productionOptions,
        migrations: [...LEGACY_TEST_MIGRATIONS],
        // The frozen source catalog also contains later B2 projections. The
        // legacy migration graph stops at request/job and never creates B2.
        entities: LEGACY_ENTITIES.filter(
          (entity) =>
            !['Mf06AssessmentEntity', 'Mf06AuthorityArtifactEntity'].includes(entity.name),
        ),
      }
    : productionOptions;
  if (options.type !== 'postgres') throw new Error('Dedicated PostgreSQL required');
  const Source = profile.legacy ? Legacy24TestDataSource : DataSource;
  const control = new Source(options);
  const dataSource = new Source({
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
