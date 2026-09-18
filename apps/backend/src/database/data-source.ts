import { DataSource } from 'typeorm';
import { validateEnvironment } from '../config/environment.js';
import { buildTypeOrmOptions } from './typeorm.options.js';

const config = validateEnvironment(process.env);

export default new DataSource(
  buildTypeOrmOptions({
    DATABASE_URL: config.DATABASE_URL,
    DATABASE_TIMEOUT_MS: config.DATABASE_TIMEOUT_MS,
  }),
);
