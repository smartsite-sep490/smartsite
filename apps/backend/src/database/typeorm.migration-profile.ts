import { InstallAuthorityJournal1795046400012 } from './migrations/1795046400012-InstallAuthorityJournal.js';
import { InstallAuthorityCutover1795046400013 } from './migrations/1795046400013-InstallAuthorityCutover.js';
import type { DataSourceOptions } from 'typeorm';
import { TrackedCameraPpeWire1795046400011 } from './migrations/1795046400011-TrackedCameraPpeWire.js';
import { CameraPpePolicyStorage1795046400010 } from './migrations/1795046400010-CameraPpePolicyStorage.js';
import {
  includesIdentificationProfile,
  includesCameraPpeWireV17,
  includesCameraPpeProfile,
  TRACKED_MIGRATION_PROFILES,
} from './migration-profile-names.js';
import { SafetyIdentificationRequests1795046400009 } from './migrations/1795046400009-SafetyIdentificationRequests.js';
import { WorkerEventAdmission1795046400002 } from './migrations/1795046400002-WorkerEventAdmission.js';
import { TrackedSubjectStorage1795046400003 } from './migrations/1795046400003-TrackedSubjectStorage.js';
import { TrackedPendingRecoveryIndex1795046400004 } from './migrations/1795046400004-TrackedPendingRecoveryIndex.js';
import { TrackedWireGenerationFence1795046400008 } from './migrations/1795046400008-TrackedWireGenerationFence.js';
import { trackedSchemaEntities } from './tracked-schema-metadata.js';
import { buildTypeOrmOptions, type DatabaseConnectionConfig } from './typeorm.options.js';

export function buildMigrationOptions(
  config: DatabaseConnectionConfig,
  selection: { profile?: string; schema?: string; runtime?: boolean } = {},
): DataSourceOptions {
  const { profile, schema } = selection;
  if (profile !== undefined && !TRACKED_MIGRATION_PROFILES.some((value) => value === profile))
    throw new Error('Unsupported migration profile');
  const options = buildTypeOrmOptions({
    DATABASE_URL: config.DATABASE_URL,
    DATABASE_TIMEOUT_MS: config.DATABASE_TIMEOUT_MS,
  });
  if (profile === undefined) return options;
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
    entities: selection.runtime ? options.entities : trackedSchemaEntities(options.entities),
    migrations: [
      ...options.migrations,
      WorkerEventAdmission1795046400002,
      TrackedSubjectStorage1795046400003,
      TrackedPendingRecoveryIndex1795046400004,
      TrackedWireGenerationFence1795046400008,
      ...(includesIdentificationProfile(profile)
        ? [SafetyIdentificationRequests1795046400009]
        : []),
      ...(includesCameraPpeProfile(profile) ? [CameraPpePolicyStorage1795046400010] : []),
      ...(includesCameraPpeWireV17(profile) ? [TrackedCameraPpeWire1795046400011] : []),
      ...(profile === 'tracked-v17-identification-ppe-authority'
        ? [InstallAuthorityJournal1795046400012, InstallAuthorityCutover1795046400013]
        : []),
    ],
  };
}
