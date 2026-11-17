import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DataSourceOptions } from 'typeorm';
import { validateEnvironment, type BackendEnvironment } from '../src/config/environment.js';

test('cutover operator uses the explicit Backend profile and schema for runtime reads', async () => {
  const operator = (await import('../src/scripts/activate-authority-cutover.js')) as unknown as {
    buildCutoverDataSourceOptions?: (env: BackendEnvironment) => DataSourceOptions;
  };
  assert.equal(typeof operator.buildCutoverDataSourceOptions, 'function');
  const env = validateEnvironment({
    NODE_ENV: 'test',
    DATABASE_SCHEMA: 'isolated_test_cutover_selection',
    SMARTSITE_DB_MIGRATION_PROFILE: 'tracked-v17-identification-ppe-authority',
  });
  const options = operator.buildCutoverDataSourceOptions!(env);
  assert.equal(options.type, 'postgres');
  if (options.type !== 'postgres') throw new Error('PostgreSQL options required');
  assert.equal(options.schema, env.DATABASE_SCHEMA);
  assert.equal(options.extra.options, '-c search_path=isolated_test_cutover_selection');
});
