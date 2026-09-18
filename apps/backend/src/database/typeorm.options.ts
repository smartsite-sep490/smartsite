import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DataSourceOptions } from 'typeorm';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface DatabaseConnectionConfig {
  DATABASE_URL: string;
  DATABASE_TIMEOUT_MS: number;
}

export function buildTypeOrmOptions(config: DatabaseConnectionConfig): DataSourceOptions {
  return {
    type: 'postgres',
    url: config.DATABASE_URL,
    synchronize: false,
    connectTimeoutMS: config.DATABASE_TIMEOUT_MS,
    entities: [path.join(__dirname, '../**/*.entity.{js,ts}')],
    migrations: [path.join(__dirname, '../migrations/*.{js,ts}')],
    migrationsRun: false,
    extra: {
      max: 5,
      connectionTimeoutMillis: config.DATABASE_TIMEOUT_MS,
      query_timeout: config.DATABASE_TIMEOUT_MS,
      statement_timeout: config.DATABASE_TIMEOUT_MS,
      idleTimeoutMillis: 30000,
      application_name: 'smartsite-backend',
    },
  };
}
