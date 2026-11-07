import 'reflect-metadata';
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
import { CameraObservationRegionEntity } from '../../src/database/entities/camera-observation-region.entity.js';
import { attachRegionConfirmations } from '../../src/modules/cameras/camera-region-confirmation.query.js';

const owned = createIsolatedTestDatabase(),
  db = owned.dataSource;
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
const changed = {
  coordinates: [
    [0.2, 0.2],
    [0.8, 0.2],
    [0.5, 0.8],
  ],
};
let zoneId: string;

test('reference-bound polygon HTTP saves and reopens exact provenance, preserving legacy history', async (t) => {
  const manager = await actor('SITE_MANAGER', site);
  const zone = await fetch(`${base.slice(0, base.indexOf('/cameras/'))}/zones`, {
    method: 'POST',
    headers: { ...manager.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Synthetic Zone',
      type: 'RESTRICTED',
      restrictionPolicy: 'PROHIBITED_FOR_ALL',
      requiredPpe: [],
    }),
  });
  assert.equal(zone.status, 201);
  zoneId = (await zone.json()).id;
  const send = async (path: string, body: unknown, method = 'POST', headers = manager.headers) =>
    fetch(`${base}/${path}`, {
      method,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const reference = async () => {
    const response = await fetch(`${base}/configuration-reference`, { headers: manager.headers });
    assert.equal(response.status, 200);
    return (await response.json()).reference;
  };
  const body = (ref: Awaited<ReturnType<typeof reference>>, poly = polygon) => ({
    expectedConfigurationVersion: ref.configurationVersion,
    referenceId: ref.referenceId,
    viewRevision: ref.viewRevision,
    confirmReferenceView: true,
    polygon: poly,
  });
  let regionId: string, first: Awaited<ReturnType<typeof reference>>;
  let firstRegion: CameraObservationRegionEntity;
  await t.test(
    'create returns matching manual confirmation and saved reader projection',
    async () => {
      first = await reference();
      const response = await send('reference-regions', { ...body(first), zoneId });
      assert.equal(response.status, 201);
      const saved = await response.json();
      regionId = saved.region.id;
      firstRegion = await db
        .getRepository(CameraObservationRegionEntity)
        .findOneByOrFail({ id: regionId });
      assert.equal(saved.configurationVersion, 2);
      assert.equal(saved.region.geometryConfirmation.referenceId, first.referenceId);
      assert.equal(saved.region.geometryConfirmation.confirmedByUserId, manager.id);
      assert.equal(saved.region.geometryConfirmation.status, 'MANUALLY_CONFIRMED');
      const reopened = await fetch(`${base}/regions/${regionId}`, { headers: manager.headers });
      assert.deepEqual(
        (await reopened.json()).geometryConfirmation,
        saved.region.geometryConfirmation,
      );
      const page = await fetch(`${base}/regions?offset=0&limit=20`, { headers: manager.headers });
      assert.equal(
        (await page.json()).items[0].geometryConfirmation.referenceId,
        first.referenceId,
      );
    },
  );
  if (!regionId!) return;
  await t.test(
    'same-coordinate revalidation and changed polygon both append immutable versions',
    async () => {
      const ref = await reference();
      const result = await send(`regions/${regionId}/reference-polygon`, body(ref), 'PATCH');
      assert.equal(result.status, 200);
      assert.equal((await result.json()).region.version, 2);
      const next = await reference();
      const update = await send(
        `regions/${regionId}/reference-polygon`,
        body(next, changed),
        'PATCH',
      );
      assert.equal(update.status, 200);
      assert.equal((await update.json()).configurationVersion, 4);
      const rows = await db.query(
        'SELECT geometry_version,configuration_version,reference_id FROM camera_region_geometry_revision WHERE region_id=$1 ORDER BY geometry_version',
        [regionId],
      );
      assert.deepEqual(
        rows.map((r: { geometry_version: number }) => r.geometry_version),
        [1, 2, 3],
      );
      assert.deepEqual(
        rows.map((r: { reference_id: string }) => r.reference_id),
        [first.referenceId, ref.referenceId, next.referenceId],
      );
      const old = await attachRegionConfirmations(db, site, camera, [firstRegion]);
      assert.equal(old[0]!.geometryConfirmation.referenceId, first.referenceId);
      assert.equal(old[0]!.version, 1);
    },
  );
  await t.test(
    'stale, reused, mismatched-view, cross-camera and spoofed commands leave data unchanged',
    async () => {
      const ref = await reference();
      const snapshot = () =>
        db.query('SELECT to_jsonb(r) AS value FROM camera_observation_region r WHERE id=$1', [
          regionId,
        ]);
      const before = await snapshot();
      const [{ n }] = await db.query(
        'SELECT count(*)::int AS n FROM camera_region_geometry_revision',
      );
      for (const invalid of [
        { ...body(ref), expectedConfigurationVersion: 1 },
        body(first),
        { ...body(ref), viewRevision: ref.viewRevision + 1 },
        { ...body(ref), referenceId: randomUUID() },
      ]) {
        assert.equal(
          (await send(`regions/${regionId}/reference-polygon`, invalid, 'PATCH')).status,
          409,
        );
      }
      assert.equal(
        (
          await send(
            `regions/${regionId}/reference-polygon`,
            { ...body(ref), confirmedByUserId: manager.id },
            'PATCH',
          )
        ).status,
        400,
      );
      assert.deepEqual(await snapshot(), before);
      assert.equal(
        (await db.query('SELECT count(*)::int AS n FROM camera_region_geometry_revision'))[0].n,
        n,
      );
    },
  );
  await t.test('Admin, Safety Officer, Worker and other-Site manager cannot write', async () => {
    const ref = await reference();
    for (const [role, scope] of [
      ['ADMIN', null],
      ['SAFETY_OFFICER', site],
      ['WORKER', site],
      ['SITE_MANAGER', otherSite],
    ] as const) {
      const denied = await actor(role, scope);
      assert.equal(
        (await send('reference-regions', { ...body(ref), zoneId }, 'POST', denied.headers)).status,
        403,
      );
    }
  });
  await t.test(
    'status carries provenance, legacy polygon change clears it and history remains',
    async () => {
      for (const [active, version] of [
        [false, 4],
        [true, 5],
      ] as const) {
        assert.equal(
          (
            await send(
              `regions/${regionId}/status`,
              { isActive: active, expectedConfigurationVersion: version },
              'PATCH',
            )
          ).status,
          200,
        );
        const read = await fetch(`${base}/regions/${regionId}`, { headers: manager.headers });
        assert.equal((await read.json()).geometryConfirmation.status, 'MANUALLY_CONFIRMED');
      }
      assert.equal(
        (
          await send(
            `regions/${regionId}/polygon`,
            { polygon, expectedConfigurationVersion: 6 },
            'PATCH',
          )
        ).status,
        200,
      );
      const read = await fetch(`${base}/regions/${regionId}`, { headers: manager.headers });
      assert.deepEqual((await read.json()).geometryConfirmation, {
        status: 'UNCONFIRMED',
        referenceId: null,
        viewRevision: null,
        confirmedByUserId: null,
        confirmedAt: null,
      });
      const rows = await db.query(
        'SELECT reference_id FROM camera_region_geometry_revision WHERE region_id=$1 ORDER BY geometry_version',
        [regionId],
      );
      assert.equal(rows.length, 6);
      assert.ok(
        rows.slice(0, 5).every((r: { reference_id: string | null }) => r.reference_id !== null),
      );
      assert.equal(rows[5].reference_id, null);
    },
  );
  await t.test(
    'expired, future-issued, inactive and cross-Site Zone commands reject without mutation',
    async () => {
      const ref = await reference();
      for (const [captured, issued, expires] of [
        [-120000, -119000, -1000],
        [60000, 61000, 180000],
      ]) {
        const id = randomUUID(),
          now = Date.now();
        await db.query(
          `INSERT INTO camera_configuration_reference SELECT $1,camera_id,view_revision,site_id,session_id,source_kind,width,height,image_sha256,configuration_version,$2,$3,$4,issued_by_user_id FROM camera_configuration_reference WHERE id=$5`,
          [
            id,
            new Date(now + captured!),
            new Date(now + issued!),
            new Date(now + expires!),
            ref.referenceId,
          ],
        );
        assert.equal(
          (await send('reference-regions', { ...body(ref), referenceId: id, zoneId })).status,
          409,
        );
      }
      await db.query("UPDATE camera SET status='INACTIVE' WHERE id=$1", [camera]);
      try {
        assert.equal((await send('reference-regions', { ...body(ref), zoneId })).status, 409);
      } finally {
        await db.query("UPDATE camera SET status='ACTIVE' WHERE id=$1", [camera]);
      }
      const otherZone = randomUUID();
      await db.query(
        "INSERT INTO zone(id,site_id,code,name,type,restriction_policy) VALUES($1,$2,$1::uuid::text,'Other Site Zone','RESTRICTED','PROHIBITED_FOR_ALL')",
        [otherZone, otherSite],
      );
      assert.equal(
        (await send('reference-regions', { ...body(ref), zoneId: otherZone })).status,
        404,
      );
      assert.equal(
        (await db.query('SELECT configuration_version::text FROM camera WHERE id=$1', [camera]))[0]
          .configuration_version,
        '7',
      );
      assert.equal(
        (await db.query('SELECT count(*)::int AS n FROM camera_region_geometry_revision'))[0].n,
        6,
      );
    },
  );
  await t.test(
    'history insert failure rolls back Region, Zone link and camera revision together',
    async () => {
      const ref = await reference(),
        freshZone = randomUUID();
      await db.query(
        "INSERT INTO zone(id,site_id,code,name,type,restriction_policy) VALUES($1,$2,$1::uuid::text,'Atomic Zone','RESTRICTED','PROHIBITED_FOR_ALL')",
        [freshZone, site],
      );
      await db.query(
        "CREATE FUNCTION synthetic_history_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic history failure'; END $$",
      );
      await db.query(
        'CREATE TRIGGER synthetic_history_failure BEFORE INSERT ON camera_region_geometry_revision FOR EACH ROW EXECUTE FUNCTION synthetic_history_failure()',
      );
      try {
        assert.equal(
          (await send('reference-regions', { ...body(ref), zoneId: freshZone })).status,
          500,
        );
        assert.equal(
          (
            await db.query(
              'SELECT count(*)::int AS n FROM camera_observation_region WHERE zone_id=$1',
              [freshZone],
            )
          )[0].n,
          0,
        );
        assert.equal(
          (await db.query('SELECT configuration_locked FROM zone WHERE id=$1', [freshZone]))[0]
            .configuration_locked,
          false,
        );
        assert.equal(
          (
            await db.query('SELECT configuration_version::text FROM camera WHERE id=$1', [camera])
          )[0].configuration_version,
          '7',
        );
      } finally {
        await db.query('DROP TRIGGER synthetic_history_failure ON camera_region_geometry_revision');
        await db.query('DROP FUNCTION synthetic_history_failure()');
      }
    },
  );
  await t.test(
    'retired source view requires revalidation while keeping saved provenance',
    async () => {
      const ref = await reference();
      assert.equal(
        (await send(`regions/${regionId}/reference-polygon`, body(ref), 'PATCH')).status,
        200,
      );
      sourceSession = randomUUID();
      const rotated = await reference();
      assert.equal(rotated.viewRevision, ref.viewRevision + 1);
      const read = await fetch(`${base}/regions/${regionId}`, { headers: manager.headers });
      const confirmation = (await read.json()).geometryConfirmation;
      assert.equal(confirmation.status, 'NEEDS_REVALIDATION');
      assert.equal(confirmation.referenceId, ref.referenceId);
      assert.equal(
        (
          await send(
            `regions/${regionId}/reference-polygon`,
            { ...body(rotated), referenceId: ref.referenceId },
            'PATCH',
          )
        ).status,
        409,
      );
    },
  );
  await t.test(
    'transaction-time authentication rejects role revocation after HTTP guard',
    async () => {
      const ref = await reference();
      const original = auth.authenticate.bind(auth);
      let intercepted = false;
      auth.authenticate = async (token, transaction) => {
        if (transaction && !intercepted) {
          intercepted = true;
          await db.query('DELETE FROM user_role_assignment WHERE user_id=$1', [manager.id]);
        }
        return original(token, transaction);
      };
      try {
        // Main treats an account with no remaining assignments as unauthenticated.
        assert.equal((await send('reference-regions', { ...body(ref), zoneId })).status, 401);
        assert.equal(intercepted, true);
        assert.equal(
          (
            await db.query('SELECT configuration_version::text FROM camera WHERE id=$1', [camera])
          )[0].configuration_version,
          '8',
        );
      } finally {
        auth.authenticate = original;
      }
    },
  );
});

test('authoring reference expiry does not erase saved historical confirmation', async () => {
  // Synthetic historical fixture tests read projection, not acceptance of an expired write.
  const referenceId = randomUUID(),
    regionId = randomUUID(),
    now = Date.now();
  await db.query(
    `INSERT INTO camera_configuration_reference SELECT $1,camera_id,view_revision,site_id,session_id,source_kind,width,height,image_sha256,configuration_version,$2,$3,$4,issued_by_user_id FROM camera_configuration_reference WHERE camera_id=$5 AND view_revision=(SELECT revision FROM camera_view_revision WHERE camera_id=$5 AND is_current) ORDER BY issued_at DESC LIMIT 1`,
    [referenceId, new Date(now - 120000), new Date(now - 119000), new Date(now - 1000), camera],
  );
  await db.query(
    `INSERT INTO camera_observation_region(id,camera_id,zone_id,polygon,coordinate_space,version,is_active,created_at) VALUES($1,$2,$3,$4::jsonb,'NORMALIZED_0_1',1,true,$5)`,
    [regionId, camera, zoneId, JSON.stringify(polygon), new Date(now - 90000)],
  );
  await db.query(
    `INSERT INTO camera_region_geometry_revision(region_id,geometry_version,camera_id,zone_id,configuration_version,coordinate_space,polygon,is_active,is_cutover_baseline,reference_id,view_revision,confirmed_by_user_id,confirmed_at,recorded_at) SELECT $1,1,camera_id,$2,configuration_version,'NORMALIZED_0_1',$3::jsonb,true,false,id,view_revision,issued_by_user_id,$4,$5 FROM camera_configuration_reference WHERE id=$6`,
    [
      regionId,
      zoneId,
      JSON.stringify(polygon),
      new Date(now - 60000),
      new Date(now - 59000),
      referenceId,
    ],
  );
  const reader = await actor('SAFETY_OFFICER', site);
  const response = await fetch(`${base}/regions/${regionId}`, { headers: reader.headers });
  assert.equal(response.status, 200);
  const confirmation = (await response.json()).geometryConfirmation;
  assert.equal(confirmation.status, 'MANUALLY_CONFIRMED');
  assert.equal(confirmation.referenceId, referenceId);
});
