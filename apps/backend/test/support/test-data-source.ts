import { buildTypeOrmOptions } from '../../src/database/typeorm.options.js';
import { DataSource } from 'typeorm';
import { resolveTestDatabaseUrl } from './test-environment.js';

// Current services must run against current migrations and entity metadata.
// Historical upgrade tests use createIsolatedTestDatabase({ legacy: true }).
export default new DataSource({
  ...buildTypeOrmOptions({
    DATABASE_URL: resolveTestDatabaseUrl(),
    DATABASE_SCHEMA: 'public',
    DATABASE_TIMEOUT_MS: 2000,
  }),
});
