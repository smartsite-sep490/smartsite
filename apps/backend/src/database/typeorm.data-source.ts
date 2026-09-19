import { DataSource } from 'typeorm';
import { resolveCliEnvironment } from '../config/cli-environment.js';
import { buildTypeOrmOptions } from './typeorm.options.js';

const config = resolveCliEnvironment();

export default new DataSource(
  buildTypeOrmOptions({
    DATABASE_URL: config.DATABASE_URL,
    DATABASE_TIMEOUT_MS: config.DATABASE_TIMEOUT_MS,
  }),
);
