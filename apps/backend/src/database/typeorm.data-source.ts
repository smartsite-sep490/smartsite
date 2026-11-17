import { DataSource } from 'typeorm';
import { resolveCliEnvironment } from '../config/cli-environment.js';
import { buildMigrationOptions } from './typeorm.migration-profile.js';

export default new DataSource(
  buildMigrationOptions(resolveCliEnvironment(), {
    profile: process.env.SMARTSITE_DB_MIGRATION_PROFILE,
    schema: process.env.DATABASE_SCHEMA,
  }),
);
