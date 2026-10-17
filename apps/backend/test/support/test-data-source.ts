import { buildTypeOrmOptions } from '../../src/database/typeorm.options.js';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { resolveTestDatabaseUrl } from './test-environment.js';

const schema =
  process.env.SMARTSITE_TEST_SCHEMA ?? `isolated_test_${randomUUID().replaceAll('-', '')}`;
if (!/^isolated_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Invalid owned test schema');
const options = buildTypeOrmOptions({
  DATABASE_URL: resolveTestDatabaseUrl(),
  DATABASE_TIMEOUT_MS: 2000,
});
if (options.type !== 'postgres') throw new Error('Dedicated PostgreSQL required');

// The runner creates this namespace once; sequential child files share it.
// Historical upgrades retain explicit file-owned legacy profiles.
export default new DataSource({
  ...options,
  schema,
  extra: { ...options.extra, options: `-c search_path=${schema}` },
});
