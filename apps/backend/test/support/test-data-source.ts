import { DataSource } from 'typeorm';
import { buildTypeOrmOptions } from '../../src/database/typeorm.options.js';
import { resolveTestDatabaseUrl } from './test-environment.js';

export default new DataSource(
  buildTypeOrmOptions({
    DATABASE_URL: resolveTestDatabaseUrl(),
    DATABASE_TIMEOUT_MS: 2000,
  }),
);
