import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateEnvironment } from '../src/config/environment.js';
import { buildMigrationOptions } from '../src/database/typeorm.migration-profile.js';

test('v1.7 combined profile explicitly adds the forward fence and preserves v1.6 selection', () => {
  const selection = { profile: 'tracked-v17-identification-ppe', schema: 'synthetic_v17' };
  const connection = { DATABASE_URL: 'postgresql://test:test@127.0.0.1:5433/test' };
  const options = buildMigrationOptions(connection, selection);
  const names = (value: typeof options) =>
    (value.migrations as Array<{ name: string }>).map((migration) => migration.name);
  const legacy = names(
    buildMigrationOptions(connection, { ...selection, profile: 'tracked-v16-identification-ppe' }),
  );
  assert.deepEqual(names(options), [...legacy, 'TrackedCameraPpeWire1795046400011']);
  assert.equal(options.synchronize, false);
  assert.equal(options.migrationsRun, false);
  const environment = validateEnvironment({
    SMARTSITE_DB_MIGRATION_PROFILE: selection.profile,
    DATABASE_SCHEMA: selection.schema,
    SAFETY_IDENTIFICATION_ENABLED: 'true',
  });
  assert.equal(environment.SAFETY_IDENTIFICATION_ENABLED, true);
  assert.equal(environment.AI_TRACKED_FRAME_RUNTIME_ENABLED, false);
});
