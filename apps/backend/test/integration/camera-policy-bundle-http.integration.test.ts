import 'reflect-metadata';
import { readIssuedCameraBundleInTransaction } from '../../src/modules/cameras/camera-configuration-bundle-reader.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../../src/app.module.js';
import { configureApplication } from '../../src/configure-app.js';
import { createLoggerParams } from '../../src/observability/logger.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { AuthClientType } from '../../src/database/entities/auth-session.entity.js';
import { CAMERA_CONFIGURATION_IMAGE_FETCH } from '../../src/modules/cameras/camera-configuration-image.service.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { createTestConfig } from '../support/config.js';
import { buildSourcePayload } from '../support/camera-configuration-image-fixture.js';

const owned = createIsolatedTestDatabase(),
  db = owned.dataSource;
const bundleMigrations = db.options.migrations;
assert(Array.isArray(bundleMigrations));
db.setOptions({
  migrations: bundleMigrations.filter(
    (m) => typeof m === 'function' && Number(m.name.match(/\d{13}$/)?.[0]) <= 1794528000000,
  ),
});
let app: NestExpressApplication, auth: AuthService, base: string;
const site = randomUUID(),
  otherSite = randomUUID(),
  camera = randomUUID();
let hash: string;
const password = 'Synthetic_camera_password_123';
let sourceSession = randomUUID();
before(async () => {
  await owned.initialize();
  hash = await hashPassword(password);
  await db.query(
    'INSERT INTO site(id,code,name) VALUES($1::uuid,$1::text,$1::text),($2::uuid,$2::text,$2::text)',
    [site, otherSite],
  );
  await db.query(
    "INSERT INTO camera(id,site_id,external_id,code,name) VALUES($1,$2,'camera-a','SYNTHETIC','Synthetic camera')",
    [camera, site],
  );
  const config = createTestConfig({
    LOG_FORMAT: 'json',
    AI_CONFIGURATION_CAMERA_IDS: camera,
    SMARTSITE_AI_SERVICE_TOKEN: 'synthetic-bundle-source-token',
    SMARTSITE_AI_PREVIEW_SOURCES: '{"camera-a":"http://ai-source.test"}',
  });
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ConfigService)
    .useValue(config)
    .overrideProvider(PARAMS_PROVIDER_TOKEN)
    .useValue(createLoggerParams(config, { write: () => undefined }))
    .overrideProvider(getDataSourceToken())
    .useValue(db)
    .overrideProvider(DataSource)
    .useValue(db)
    .overrideProvider(CAMERA_CONFIGURATION_IMAGE_FETCH)
    .useValue(async (url: string, options: RequestInit) => {
      assert.equal(
        url,
        'http://ai-source.test/v1/realtime/configuration-image?cameraExternalId=camera-a',
      );
      assert.equal(options.redirect, 'error');
      return new Response(
        JSON.stringify(
          buildSourcePayload({
            capturedAt: new Date().toISOString(),
            frame: { sessionId: sourceSession },
          }),
        ),
        { headers: { 'Content-Type': 'application/json' } },
      );
    })
    .compile();
  app = module.createNestApplication<NestExpressApplication>({
    bufferLogs: true,
    bodyParser: false,
  });
  await configureApplication(app);
  await app.listen(0, '127.0.0.1');
  base = `${await app.getUrl()}/api/v1/sites/${site}/cameras/${camera}`;
  auth = module.get(AuthService);
});
after(async () => {
  if (app) await app.close();
  await owned.dispose();
});

async function actor(role: string, siteId: string | null) {
  const id = randomUUID();
  await db.query(
    'INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1::uuid,$1::text,$1::text,$2)',
    [id, hash],
  );
  await db.query('INSERT INTO user_role_assignment(id,user_id,site_id,role) VALUES($1,$2,$3,$4)', [
    randomUUID(),
    id,
    siteId,
    role,
  ]);
  const session = await auth.login(id, password, AuthClientType.WEB);
  return { id, session, headers: { Authorization: `Bearer ${session.accessToken}` } };
}

const polygon = {
  coordinates: [
    [0.1, 0.1],
    [0.9, 0.1],
    [0.5, 0.9],
  ],
};
const serviceHeaders = { Authorization: 'Bearer synthetic-bundle-source-token' };
const bundleUrl = () =>
  `${base.replace('/sites/', '/integrations/ai/sites/').replace(`/sites/${site}`, '')}/configuration-bundle`;

test('issued bundle journey binds exact geometry and PPE policy, preserving immutable history', async (t) => {
  const manager = await actor('SITE_MANAGER', site);
  const send = (path: string, value: unknown, method = 'POST') =>
    fetch(`${base}/${path}`, {
      method,
      headers: { ...manager.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    });
  const read = (match?: string) =>
    fetch(bundleUrl(), {
      headers: { ...serviceHeaders, ...(match ? { 'If-None-Match': match } : {}) },
    });
  const reference = async () => {
    const r = await fetch(`${base}/configuration-reference`, { headers: manager.headers });
    assert.equal(r.status, 200);
    return (await r.json()).reference;
  };
  const body = (r: Awaited<ReturnType<typeof reference>>) => ({
    expectedConfigurationVersion: r.configurationVersion,
    referenceId: r.referenceId,
    viewRevision: r.viewRevision,
    confirmReferenceView: true,
    polygon,
  });
  const headers = () =>
    db.query('SELECT * FROM camera_configuration_bundle ORDER BY configuration_version');
  await t.test(
    'empty bundle migration rolls back and upgrades without changing camera identity',
    async () => {
      await db.undoLastMigration();
      assert.equal(
        (await db.query("SELECT to_regclass('camera_configuration_bundle') AS name"))[0].name,
        null,
      );
      await db.runMigrations();
      assert.equal((await db.query('SELECT id FROM camera WHERE id=$1', [camera]))[0].id, camera);
    },
  );
  await t.test('empty retained bundle tables permit parent cleanup', async () => {
    await db.query('TRUNCATE camera_configuration_bundle CASCADE');
  });
  await t.test('reads without issued data cannot create a bundle or return304', async () => {
    assert.equal((await read('*')).status, 409);
    await reference();
    await reference();
    assert.deepEqual(await headers(), []);
    assert.equal((await read('*')).status, 409);
  });
  const zoneResponse = await fetch(`${base.slice(0, base.indexOf('/cameras/'))}/zones`, {
    method: 'POST',
    headers: { ...manager.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Synthetic PPE policy',
      type: 'HAZARDOUS',
      restrictionPolicy: 'NONE',
      requiredPpe: ['GLOVES', 'HARD_HAT'],
    }),
  });
  assert.equal(zoneResponse.status, 201);
  const zoneId = (await zoneResponse.json()).id as string;
  let regionId: string, oldBundle: Record<string, unknown>, etag: string;
  await t.test(
    'manual save issues canonical geometry and sorted immutable PPE in the same revision',
    async () => {
      const ref = await reference(),
        saved = await send('reference-regions', { ...body(ref), zoneId });
      assert.equal(saved.status, 201);
      regionId = (await saved.json()).region.id;
      const r = await read();
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('cache-control'), 'no-store');
      etag = r.headers.get('etag')!;
      oldBundle = await r.json();
      assert.equal(oldBundle.configurationVersion, 2);
      const regions = oldBundle.regions as Array<Record<string, unknown>>;
      assert.equal(regions[0]!.regionId, regionId);
      assert.equal(regions[0]!.zoneId, zoneId);
      assert.equal(regions[0]!.policyRevision, 1);
      assert.deepEqual(regions[0]!.requiredPpe, ['GLOVES', 'HARD_HAT']);
      await reference();
      assert.equal((await headers()).length, 1);
      const cached = await read(etag);
      assert.equal(cached.status, 304);
      assert.equal(await cached.text(), '');
      assert.equal((await headers()).length, 1);
    },
  );
  if (!regionId!) return;
  const historical = async (overrides: Record<string, unknown> = {}) => {
    const modulePath = '../../src/modules/cameras/camera-configuration-bundle-reader.js';
    const api = await import(modulePath);
    assert.equal(typeof api.readHistoricalIssuedCameraBundleInTransaction, 'function');
    return db.transaction('REPEATABLE READ', (transaction) =>
      api.readHistoricalIssuedCameraBundleInTransaction(transaction, {
        cameraId: camera,
        siteId: site,
        cameraExternalId: 'camera-a',
        configurationVersion: oldBundle.configurationVersion,
        viewRevision: oldBundle.viewRevision,
        bundleSha256: oldBundle.bundleSha256,
        ...overrides,
      }),
    );
  };
  await t.test(
    'inactive camera rejects conditional read; reactivation issues a new counter-bound bundle',
    async () => {
      assert.equal(
        (await send('status', { status: 'INACTIVE', expectedConfigurationVersion: 2 }, 'PATCH'))
          .status,
        200,
      );
      assert.equal((await read(etag)).status, 409);
      assert.equal((await headers()).length, 1);
      assert.deepEqual(await historical(), oldBundle);
      assert.equal(
        (await send('status', { status: 'ACTIVE', expectedConfigurationVersion: 3 }, 'PATCH'))
          .status,
        200,
      );
      const current = await read();
      assert.equal(current.status, 200);
      assert.equal((await current.json()).configurationVersion, 4);
      assert.equal((await headers()).length, 2);
    },
  );
  await t.test(
    'view replacement preserves old bundle but requires manual revalidation before delivery',
    async () => {
      sourceSession = randomUUID();
      const ref = await reference();
      assert.equal(ref.viewRevision, 2);
      assert.equal((await read('*')).status, 409);
      assert.equal((await headers()).length, 2);
      assert.equal(
        (await send(`regions/${regionId}/reference-polygon`, body(ref), 'PATCH')).status,
        200,
      );
      assert.equal((await headers()).length, 3);
      const old = (await headers())[0];
      assert.equal(old.bundle_sha256, oldBundle.bundleSha256);
    },
  );
  await t.test(
    'historical lookup survives retired view and requires every exact scope dimension',
    async () => {
      const before = await headers();
      assert.deepEqual(await historical(), oldBundle);
      for (const overrides of [
        { cameraId: randomUUID() },
        { siteId: otherSite },
        { cameraExternalId: 'other-camera' },
        { configurationVersion: 4 },
        { viewRevision: 2 },
        { bundleSha256: '0'.repeat(64) },
        { configurationVersion: 0 },
        { configurationVersion: Number.MAX_SAFE_INTEGER + 1 },
        { viewRevision: '1' },
        { cameraId: 'malformed' },
        { bundleSha256: 'SELECT secret' },
        { siteId: null },
      ])
        assert.equal(await historical(overrides), undefined);
      assert.deepEqual(await headers(), before);
    },
  );
  await t.test('historical PPE comes from immutable policy, not current Zone values', async () => {
    await db.query('UPDATE zone SET required_ppe=$2 WHERE id=$1', [zoneId, ['BOOTS']]);
    try {
      assert.deepEqual(await historical(), oldBundle);
    } finally {
      await db.query('UPDATE zone SET required_ppe=$2 WHERE id=$1', [
        zoneId,
        ['GLOVES', 'HARD_HAT'],
      ]);
    }
    const modulePath = '../../src/modules/cameras/camera-configuration-bundle-reader.js';
    const api = await import(modulePath);
    await assert.rejects(
      () =>
        api.readHistoricalIssuedCameraBundleInTransaction(db.manager, {
          cameraId: camera,
          siteId: site,
          cameraExternalId: 'camera-a',
          configurationVersion: oldBundle.configurationVersion,
          viewRevision: oldBundle.viewRevision,
          bundleSha256: oldBundle.bundleSha256,
        }),
      /transaction/,
    );
  });
  await t.test(
    'an unconfirmed active region prevents issuance until all active geometry is confirmed',
    async () => {
      const created = await send('regions', { polygon, zoneId, expectedConfigurationVersion: 5 });
      assert.equal(created.status, 201);
      const other = (await created.json()).region.id;
      assert.equal((await read('*')).status, 409);
      assert.equal((await headers()).length, 3);
      const ref = await reference();
      assert.equal(
        (await send(`regions/${other}/reference-polygon`, body(ref), 'PATCH')).status,
        200,
      );
      const current = await read();
      assert.equal(current.status, 200);
      const data = await current.json();
      assert.equal(data.configurationVersion, 7);
      assert.equal(data.regions.length, 2);
      assert.equal((await headers()).length, 4);
    },
  );
  await t.test(
    'policy history mismatch rolls back geometry/camera and issues no new bundle',
    async () => {
      const ref = await reference();
      await db.query('UPDATE zone SET required_ppe=$2 WHERE id=$1', [zoneId, ['BOOTS']]);
      try {
        assert.equal(
          (await send(`regions/${regionId}/reference-polygon`, body(ref), 'PATCH')).status,
          409,
        );
        assert.equal((await headers()).length, 4);
        assert.equal(
          (
            await db.query('SELECT configuration_version::text FROM camera WHERE id=$1', [camera])
          )[0].configuration_version,
          '7',
        );
      } finally {
        await db.query('UPDATE zone SET required_ppe=$2 WHERE id=$1', [
          zoneId,
          ['GLOVES', 'HARD_HAT'],
        ]);
      }
    },
  );
  await t.test('bundle insert failure rolls back geometry history and Camera counter', async () => {
    const ref = await reference();
    const before = await db.query(
      'SELECT to_jsonb(r) AS value FROM camera_observation_region r WHERE id=$1',
      [regionId],
    );
    const [{ n }] = await db.query(
      'SELECT count(*)::int AS n FROM camera_region_geometry_revision',
    );
    await db.query(
      "CREATE FUNCTION synthetic_bundle_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic bundle failure'; END $$",
    );
    await db.query(
      'CREATE TRIGGER synthetic_bundle_failure BEFORE INSERT ON camera_configuration_bundle FOR EACH ROW EXECUTE FUNCTION synthetic_bundle_failure()',
    );
    try {
      assert.equal(
        (await send(`regions/${regionId}/reference-polygon`, body(ref), 'PATCH')).status,
        500,
      );
      assert.deepEqual(
        await db.query('SELECT to_jsonb(r) AS value FROM camera_observation_region r WHERE id=$1', [
          regionId,
        ]),
        before,
      );
      assert.equal(
        (await db.query('SELECT count(*)::int AS n FROM camera_region_geometry_revision'))[0].n,
        n,
      );
      assert.equal(
        (await db.query('SELECT configuration_version::text FROM camera WHERE id=$1', [camera]))[0]
          .configuration_version,
        '7',
      );
      assert.equal((await headers()).length, 4);
    } finally {
      await db.query('DROP TRIGGER synthetic_bundle_failure ON camera_configuration_bundle');
      await db.query('DROP FUNCTION synthetic_bundle_failure()');
    }
  });
  await t.test('immutable bundle/header rows reject changes and populated rollback', async () => {
    for (const table of ['camera_configuration_bundle', 'camera_configuration_bundle_region']) {
      await assert.rejects(db.query(`DELETE FROM ${table}`), /immutable/);
      await assert.rejects(db.query(`TRUNCATE ${table} CASCADE`), /immutable/);
    }
    await assert.rejects(db.undoLastMigration(), /history must be retained/);
    assert.equal((await headers()).length, 4);
  });
  await t.test(
    'reader rejects a privileged corrupted policy Site instead of trusting a matching hash',
    async () => {
      // File-owned schema only: simulate damaged provenance, then roll back all DDL/data.
      const runner = db.createQueryRunner();
      await runner.connect();
      await runner.startTransaction();
      try {
        await runner.query(
          'ALTER TABLE zone_policy_revision DROP CONSTRAINT fk_zone_policy_revision_scope',
        );
        await runner.query(
          'ALTER TABLE zone_policy_revision DISABLE TRIGGER zone_policy_revision_immutable',
        );
        await runner.query('UPDATE zone_policy_revision SET site_id=$2 WHERE zone_id=$1', [
          zoneId,
          otherSite,
        ]);
        await assert.rejects(
          readIssuedCameraBundleInTransaction(runner.manager, camera),
          (error) => (error as { getStatus?: () => number }).getStatus?.() === 503,
        );
        const modulePath = '../../src/modules/cameras/camera-configuration-bundle-reader.js';
        const api = await import(modulePath);
        await assert.rejects(
          api.readHistoricalIssuedCameraBundleInTransaction(runner.manager, {
            cameraId: camera,
            siteId: site,
            cameraExternalId: 'camera-a',
            configurationVersion: oldBundle.configurationVersion,
            viewRevision: oldBundle.viewRevision,
            bundleSha256: oldBundle.bundleSha256,
          }),
          (error) => (error as { getStatus?: () => number }).getStatus?.() === 503,
        );
      } finally {
        await runner.rollbackTransaction();
        await runner.release();
      }
      assert.equal((await read()).status, 200);
    },
  );
});
