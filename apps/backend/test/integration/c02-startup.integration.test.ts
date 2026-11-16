import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module.js';
import { configureApplication } from '../../src/configure-app.js';
import { createLoggerParams } from '../../src/observability/logger.js';
import { buildMigrationOptions } from '../../src/database/typeorm.migration-profile.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { createTestConfig } from '../support/config.js';
import { resolveTestDatabaseUrl } from '../support/test-environment.js';

for (const variant of [
  'disabled-unmigrated',
  'enabled-unmigrated',
  'enabled-migrated',
  'enabled-unprotected-history',
] as const) {
  test(`C02 normal DataSource startup: ${variant}`, async () => {
    const owned = createIsolatedTestDatabase();
    let app: NestExpressApplication | undefined;
    try {
      await owned.initialize();
      const schema = owned.dataSource.driver.schema!;
      if (variant === 'enabled-migrated' || variant === 'enabled-unprotected-history') {
        const cli = new DataSource(
          buildMigrationOptions(
            { DATABASE_URL: resolveTestDatabaseUrl() },
            { profile: 'tracked-v16-identification', schema },
          ),
        );
        try {
          await cli.initialize();
          const applied = await cli.runMigrations();
          assert.deepEqual(
            applied.map((migration) => migration.name),
            [
              'WorkerEventAdmission1795046400002',
              'TrackedSubjectStorage1795046400003',
              'TrackedPendingRecoveryIndex1795046400004',
              'TrackedWireGenerationFence1795046400008',
              'SafetyIdentificationRequests1795046400009',
            ],
          );
        } finally {
          if (cli.isInitialized) await cli.destroy();
        }
        if (variant === 'enabled-unprotected-history')
          await owned.dataSource.query(
            'ALTER TABLE safety_identification_action DISABLE TRIGGER trg_safety_identification_action_immutable',
          );
      }
      const config = createTestConfig({
        DATABASE_URL: resolveTestDatabaseUrl(),
        DATABASE_SCHEMA: schema,
        SMARTSITE_DB_MIGRATION_PROFILE: 'tracked-v16-identification',
        SAFETY_IDENTIFICATION_ENABLED: variant === 'disabled-unmigrated' ? 'false' : 'true',
      });
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(ConfigService)
        .useValue(config)
        .overrideProvider(PARAMS_PROVIDER_TOKEN)
        .useValue(createLoggerParams(config, { write: () => undefined }))
        .compile();
      const runtime = module.get(DataSource);
      assert.notEqual(runtime, owned.dataSource);
      assert.equal(runtime.driver.schema, schema);
      assert.equal(runtime.options.synchronize, false);
      assert.equal(runtime.options.migrationsRun, false);
      app = module.createNestApplication<NestExpressApplication>({
        bufferLogs: true,
        bodyParser: false,
      });
      if (variant === 'enabled-unmigrated' || variant === 'enabled-unprotected-history') {
        await assert.rejects(configureApplication(app), /C02 database profile is unavailable/);
      } else {
        await configureApplication(app);
        const [state] = await runtime.query(
          "SELECT to_regclass('safety_identification_request') IS NOT NULL AS present",
        );
        assert.equal(state.present, variant === 'enabled-migrated');
      }
    } finally {
      if (app) await app.close();
      await owned.dispose();
    }
  });
}
