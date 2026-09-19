import type { DataSourceOptions } from 'typeorm';
import { ENTITIES } from './entities/index.js';
import { Mf05Mf06Foundation1789689600000 } from './migrations/1789689600000-Mf05Mf06Foundation.js';

export interface DatabaseConnectionConfig {
  DATABASE_URL: string;
  DATABASE_TIMEOUT_MS?: number;
}

export function buildTypeOrmOptions(config: DatabaseConnectionConfig): DataSourceOptions {
  const timeoutMs = config.DATABASE_TIMEOUT_MS ?? 2000;
  return {
    type: 'postgres',
    url: config.DATABASE_URL,
    synchronize: false,
    migrationsRun: false,
    connectTimeoutMS: timeoutMs,
    entities: [...ENTITIES],
    migrations: [Mf05Mf06Foundation1789689600000],
    logging: false,
    extra: {
      max: 5,
      connectionTimeoutMillis: timeoutMs,
      query_timeout: timeoutMs,
      statement_timeout: timeoutMs,
      idleTimeoutMillis: 30000,
      application_name: 'smartsite-backend',
    },
  };
}

export function createTypeOrmOptions(databaseUrl: string, timeoutMs = 2000): DataSourceOptions {
  return buildTypeOrmOptions({
    DATABASE_URL: databaseUrl,
    DATABASE_TIMEOUT_MS: timeoutMs,
  });
}
