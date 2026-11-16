import { DataSource, type DataSourceOptions } from 'typeorm';
import { resolveCliEnvironment } from '../config/cli-environment.js';
import { WorkerEventAdmission1795046400002 } from './migrations/1795046400002-WorkerEventAdmission.js';
import { TrackedSubjectStorage1795046400003 } from './migrations/1795046400003-TrackedSubjectStorage.js';
import { TrackedPendingRecoveryIndex1795046400004 } from './migrations/1795046400004-TrackedPendingRecoveryIndex.js';
import { TrackedWireGenerationFence1795046400008 } from './migrations/1795046400008-TrackedWireGenerationFence.js';
import { trackedSchemaEntities } from './tracked-schema-metadata.js';
import { buildTypeOrmOptions } from './typeorm.options.js';

function migrationOptions(): DataSourceOptions {
  const profile = process.env.SMARTSITE_DB_MIGRATION_PROFILE;
  if (profile !== undefined && profile !== 'tracked-v16')
    throw new Error('Unsupported migration profile');
  const config = resolveCliEnvironment();
  const options = buildTypeOrmOptions({
    DATABASE_URL: config.DATABASE_URL,
    DATABASE_TIMEOUT_MS: config.DATABASE_TIMEOUT_MS,
  });
  if (profile === undefined) return options;
  const schema = process.env.DATABASE_SCHEMA;
  if (
    !schema ||
    !/^[a-z_][a-z0-9_]{0,62}$/.test(schema) ||
    /^(pg_|information_schema$)/.test(schema)
  )
    throw new Error('Explicit tracked schema is required');
  if (new URL(config.DATABASE_URL).searchParams.has('options'))
    throw new Error('Connection options override is forbidden');
  if (
    options.type !== 'postgres' ||
    !Array.isArray(options.migrations) ||
    !Array.isArray(options.entities)
  )
    throw new Error('Tracked profile requires PostgreSQL migration and entity classes');
  return {
    ...options,
    schema,
    extra: { ...options.extra, options: `-c search_path=${schema}` },
    entities: trackedSchemaEntities(options.entities),
    migrations: [
      ...options.migrations,
      WorkerEventAdmission1795046400002,
      TrackedSubjectStorage1795046400003,
      TrackedPendingRecoveryIndex1795046400004,
      TrackedWireGenerationFence1795046400008,
    ],
  };
}

export default new DataSource(migrationOptions());
