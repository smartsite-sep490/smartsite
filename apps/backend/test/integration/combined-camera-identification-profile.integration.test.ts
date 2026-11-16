import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
import { AuthClientType } from '../../src/database/entities/auth-session.entity.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { resolveTestDatabaseUrl } from '../support/test-environment.js';
import { createTestConfig } from '../support/config.js';
import { seedTrackedFrameFixture } from '../support/tracked-frame-fixture.js';

for (const enabled of ['true', 'false']) {
  test(`combined profile refuses partial PPE storage with C02 ${enabled}`, async () => {
    const owned = createIsolatedTestDatabase();
    let cli: DataSource | undefined;
    let app: NestExpressApplication | undefined;
    try {
      await owned.initialize();
      const schema = owned.dataSource.driver.schema!;
      const profile = 'tracked-v16-identification-ppe';
      cli = new DataSource(
        buildMigrationOptions({ DATABASE_URL: resolveTestDatabaseUrl() }, { profile, schema }),
      );
      await cli.initialize();
      await cli.runMigrations();
      await cli.undoLastMigration();
      const config = createTestConfig({
        DATABASE_URL: resolveTestDatabaseUrl(),
        DATABASE_SCHEMA: schema,
        SMARTSITE_DB_MIGRATION_PROFILE: profile,
        SAFETY_IDENTIFICATION_ENABLED: enabled,
      });
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(ConfigService)
        .useValue(config)
        .overrideProvider(PARAMS_PROVIDER_TOKEN)
        .useValue(createLoggerParams(config, { write: () => undefined }))
        .compile();
      assert.notEqual(module.get(DataSource), owned.dataSource);
      app = module.createNestApplication<NestExpressApplication>({
        bufferLogs: true,
        bodyParser: false,
      });
      await assert.rejects(configureApplication(app), /Camera PPE database profile is unavailable/);
    } finally {
      if (app) await app.close();
      if (cli?.isInitialized) await cli.destroy();
      await owned.dispose();
    }
  });
}

for (const variant of ['fresh', 'upgrade'] as const) {
  test(`combined tracked identification/PPE profile: ${variant} and normal HTTP`, async () => {
    const owned = createIsolatedTestDatabase();
    const db = owned.dataSource;
    let cli: DataSource | undefined;
    let fixtureDb: DataSource | undefined;
    let app: NestExpressApplication | undefined;
    try {
      const profile = 'tracked-v16-identification-ppe';
      const options = buildMigrationOptions(
        { DATABASE_URL: resolveTestDatabaseUrl() },
        { profile, schema: db.driver.schema! },
      );
      if (variant === 'fresh') db.setOptions(options);
      await owned.initialize();
      cli = new DataSource(options);
      await cli.initialize();
      const applied = await cli.runMigrations();
      assert.deepEqual(
        applied.map((item) => item.name),
        variant === 'fresh'
          ? []
          : [
              'WorkerEventAdmission1795046400002',
              'TrackedSubjectStorage1795046400003',
              'TrackedPendingRecoveryIndex1795046400004',
              'TrackedWireGenerationFence1795046400008',
              'SafetyIdentificationRequests1795046400009',
              'CameraPpePolicyStorage1795046400010',
            ],
      );
      assert.deepEqual(await cli.runMigrations(), []);
      // Before adopting any v2 policy, rollback/reapply is lossless.
      await cli.undoLastMigration();
      assert.deepEqual(
        (await cli.runMigrations()).map((item) => item.name),
        ['CameraPpePolicyStorage1795046400010'],
      );
      fixtureDb = new DataSource(
        buildMigrationOptions(
          { DATABASE_URL: resolveTestDatabaseUrl() },
          { profile, schema: db.driver.schema!, runtime: true },
        ),
      );
      await fixtureDb.initialize();
      const fixture = await seedTrackedFrameFixture(fixtureDb, ['HARD_HAT']);
      const password = 'Synthetic_combined_policy_123';
      const hash = await hashPassword(password);
      const manager = randomUUID(),
        officer = randomUUID();
      for (const [id, role] of [
        [manager, 'SITE_MANAGER'],
        [officer, 'SAFETY_OFFICER'],
      ]) {
        await db.query(
          "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'Synthetic profile actor',$2)",
          [id, hash],
        );
        await db.query(
          'INSERT INTO user_role_assignment(id,user_id,site_id,role) VALUES($1,$2,$3,$4)',
          [randomUUID(), id, fixture.siteId, role],
        );
      }
      const config = createTestConfig({
        DATABASE_URL: resolveTestDatabaseUrl(),
        DATABASE_SCHEMA: db.driver.schema!,
        SMARTSITE_DB_MIGRATION_PROFILE: profile,
        SAFETY_IDENTIFICATION_ENABLED: 'true',
      });
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(ConfigService)
        .useValue(config)
        .overrideProvider(PARAMS_PROVIDER_TOKEN)
        .useValue(createLoggerParams(config, { write: () => undefined }))
        .compile();
      const runtime = module.get(DataSource);
      assert.notEqual(runtime, db);
      assert.equal(runtime.driver.schema, db.driver.schema);
      assert.equal(runtime.options.synchronize, false);
      assert.equal(runtime.options.migrationsRun, false);
      app = module.createNestApplication<NestExpressApplication>({
        bufferLogs: true,
        bodyParser: false,
      });
      await configureApplication(app);
      await app.listen(0, '127.0.0.1');
      const auth = module.get(AuthService);
      const managerToken = (await auth.login(manager!, password, AuthClientType.WEB)).accessToken;
      const officerToken = (await auth.login(officer!, password, AuthClientType.WEB)).accessToken;
      const api = (await app.getUrl()) + '/api/v1';
      const path =
        api + '/sites/' + fixture.siteId + '/cameras/' + fixture.cameraId + '/ppe-policy';
      const call = async (
        suffix: string,
        method: string,
        token: string,
        body?: unknown,
        status = 200,
      ) => {
        const result = await fetch(path + suffix, {
          method,
          headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        assert.equal(result.status, status, await result.clone().text());
        return result.json();
      };
      const activeRegions = await db.query<{ id: string }[]>(
        'SELECT id FROM camera_observation_region WHERE camera_id=$1 AND is_active=true',
        [fixture.cameraId],
      );
      const initial = {
        commandId: randomUUID(),
        expectedConfigurationVersion: 1,
        policy: { mode: 'EXPLICIT', requiredPpe: ['HARD_HAT'] },
        regionPolicies: activeRegions.map(({ id }) => ({
          regionId: id,
          policy: { mode: 'INHERIT' },
        })),
      };
      await call('/initialize', 'POST', officerToken, initial, 403);
      const saved = await call('/initialize', 'POST', managerToken, initial, 201);
      assert.equal(saved.configurationVersion, 2);
      assert.equal(saved.replayed, false);
      const replay = await call('/initialize', 'POST', managerToken, initial, 201);
      assert.deepEqual(replay, { ...saved, replayed: true });
      const inherited = await call('/regions/' + fixture.ppeRegionId, 'GET', officerToken);
      assert.deepEqual(inherited.policy, { mode: 'INHERIT' });
      const changed = await call('/regions/' + fixture.ppeRegionId, 'PATCH', managerToken, {
        commandId: randomUUID(),
        expectedConfigurationVersion: 2,
        policy: { mode: 'EXPLICIT', requiredPpe: ['SAFETY_VEST'] },
      });
      assert.equal(changed.configurationVersion, 3);
      const region = await call('/regions/' + fixture.ppeRegionId, 'GET', officerToken);
      assert.deepEqual(region.policy, { mode: 'EXPLICIT', requiredPpe: ['SAFETY_VEST'] });
      const camera = await call('', 'GET', officerToken);
      assert.deepEqual(camera.policy, { mode: 'EXPLICIT', requiredPpe: ['HARD_HAT'] });
      const queue = await fetch(
        api + '/sites/' + fixture.siteId + '/safety-identification-requests',
        {
          headers: { authorization: 'Bearer ' + officerToken },
        },
      );
      assert.equal(queue.status, 200, await queue.clone().text());
      assert.equal((await queue.json()).total, 0);
      const before = await db.query(
        'SELECT configuration_version,bundle_sha256 FROM camera_configuration_bundle WHERE camera_id=$1 ORDER BY configuration_version',
        [fixture.cameraId],
      );
      assert.equal(before.length, 3);
      await assert.rejects(cli.undoLastMigration(), /PPE policy history must be retained/);
      assert.deepEqual(
        await db.query(
          'SELECT configuration_version,bundle_sha256 FROM camera_configuration_bundle WHERE camera_id=$1 ORDER BY configuration_version',
          [fixture.cameraId],
        ),
        before,
      );
      assert.deepEqual((await call('', 'GET', officerToken)).policy, camera.policy);
    } finally {
      if (app) await app.close();
      if (cli?.isInitialized) await cli.destroy();
      if (fixtureDb?.isInitialized) await fixtureDb.destroy();
      await owned.dispose();
    }
  });
}
