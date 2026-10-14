import { DataSource } from 'typeorm';
import { buildTypeOrmOptions } from '../../src/database/typeorm.options.js';
import { resolveTestDatabaseUrl } from './test-environment.js';
import { LEGACY_TEST_MIGRATIONS } from './legacy-test-migrations.js';

export default new DataSource({
  ...buildTypeOrmOptions({
    DATABASE_URL: resolveTestDatabaseUrl(),
    DATABASE_TIMEOUT_MS: 2000,
  }),
  migrations: [...LEGACY_TEST_MIGRATIONS],
});
