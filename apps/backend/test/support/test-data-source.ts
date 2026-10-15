import { buildTypeOrmOptions } from '../../src/database/typeorm.options.js';
import { resolveTestDatabaseUrl } from './test-environment.js';
import { LEGACY_TEST_MIGRATIONS } from './legacy-test-migrations.js';
import { Legacy24TestDataSource, LEGACY_ENTITIES } from './legacy24/data-source.js';

export default new Legacy24TestDataSource({
  ...buildTypeOrmOptions({
    DATABASE_URL: resolveTestDatabaseUrl(),
    DATABASE_TIMEOUT_MS: 2000,
  }),
  migrations: [...LEGACY_TEST_MIGRATIONS],
  entities: [...LEGACY_ENTITIES],
});
