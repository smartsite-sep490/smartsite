import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import { AppModule } from '../../src/app.module.js';
import { configureApplication } from '../../src/configure-app.js';
import { validateEnvironment, type BackendEnvironment } from '../../src/config/environment.js';
import { createLoggerParams } from '../../src/observability/logger.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { CameraConfigurationService } from '../../src/modules/cameras/camera-configuration.service.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

const database = createIsolatedTestDatabase({ canonical: true }),
  db = database.dataSource;
const site = randomUUID(),
  otherSite = randomUUID(),
  camera = randomUUID(),
  actor = randomUUID();
const zones = Array.from({ length: 4 }, () => randomUUID()).sort();
let app: NestExpressApplication, apiDatabase: DataSource, origin: string, token: string;
let cameras: CameraConfigurationService;
const path = `/api/v1/sites/${site}/cameras/${camera}/observation-zones`;
const headers = () => ({ Authorization: `Bearer ${token}` });
const request = (suffix = '') => fetch(origin + path + suffix, { headers: headers() });

before(async () => {
  await database.initialize();
  for (const id of [site, otherSite])
    await db.query('INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,$2)', [
      id,
      'Synthetic observation Site',
    ]);
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash,must_change_password) VALUES($1,$1::uuid::text,'Synthetic viewer',$2,false)",
    [actor, await hashPassword('SyntheticObservation123!')],
  );
  await db.query(
    "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'SAFETY_OFFICER',$3)",
    [randomUUID(), actor, site],
  );
  await db.query(
    "INSERT INTO camera(id,site_id,external_id,code,name,status,configuration_version) VALUES($1,$2,$1::uuid::text,'CAM-07','Name must not define Zone','INACTIVE',7)",
    [camera, site],
  );
  for (const [i, id] of zones.entries())
    await db.query(
      "INSERT INTO zone(id,site_id,code,name,type,restriction_policy,required_ppe) VALUES($1,$2,$3,$4,'STANDARD','NONE','{}')",
      [id, i === 3 ? otherSite : site, `ZONE-${i}`, `Configured Zone ${i}`],
    );
  for (const [i, zoneId] of [zones[0], zones[0], zones[1], zones[2], zones[3]].entries())
    await db.query(
      "INSERT INTO camera_observation_region(id,camera_id,zone_id,polygon,is_active) VALUES($1,$2,$3,'[[0,0],[1,0],[0,1]]',$4)",
      [randomUUID(), camera, zoneId, i !== 3],
    );
  const config = new ConfigService<BackendEnvironment, true>(
    validateEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      LOG_FORMAT: 'json',
      THROTTLE_LIMIT: '1000',
    }),
  );
  apiDatabase = new DataSource(db.options);
  await apiDatabase.initialize();
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ConfigService)
    .useValue(config)
    .overrideProvider(PARAMS_PROVIDER_TOKEN)
    .useValue(createLoggerParams(config, { write: () => undefined }))
    .overrideProvider(getDataSourceToken())
    .useValue(apiDatabase)
    .overrideProvider(DataSource)
    .useValue(apiDatabase)
    .compile();
  cameras = module.get(CameraConfigurationService);
  app = module.createNestApplication<NestExpressApplication>({ logger: false, bodyParser: false });
  await configureApplication(app);
  await app.listen(0, '127.0.0.1');
  origin = await app.getUrl();
  const login = await fetch(origin + '/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: actor,
      password: 'SyntheticObservation123!',
      clientType: 'MOBILE',
    }),
  });
  assert.equal(login.status, 200);
  token = ((await login.json()) as { accessToken: string }).accessToken;
});
after(async () => {
  if (app) await app.close();
  if (apiDatabase?.isInitialized) await apiDatabase.destroy();
  await database.dispose();
});

test('authenticated real PostgreSQL metadata deduplicates active Regions and excludes foreign names while AI/offline', async () => {
  assert.equal((await cameras.observationZones(site, camera, 0, 1)).total, 2);
  const response = await request('?offset=0&limit=1');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const first = await response.json();
  assert.deepEqual(first, {
    siteId: site,
    cameraId: camera,
    configurationVersion: 7,
    items: [{ id: zones[0], code: 'ZONE-0', name: 'Configured Zone 0' }],
    total: 2,
    unresolvedRegionCount: 1,
  });
  const second = await request('?offset=1&limit=1');
  assert.equal(second.status, 200);
  assert.deepEqual((await second.json()).items, [
    { id: zones[1], code: 'ZONE-1', name: 'Configured Zone 1' },
  ]);
  assert.deepEqual((await (await request('?offset=2&limit=1')).json()).items, []);
  const renamed = 'Renamed configured Zone';
  await db.query('UPDATE zone SET name=$2 WHERE id=$1', [zones[0], renamed]);
  assert.equal((await (await request()).json()).items[0].name, renamed);
});
test('actual HTTP keeps authentication, scope, strict pagination and not-found boundaries', async () => {
  assert.equal((await fetch(origin + path)).status, 401);
  assert.equal(
    (await fetch(origin + path.replace(site, otherSite), { headers: headers() })).status,
    403,
  );
  for (const query of [
    '?limit=0',
    '?limit=101',
    '?offset=-1',
    '?offset=1.5',
    '?limit=2&limit=3',
    '?sourceUrl=private',
  ])
    assert.equal((await request(query)).status, 400, query);
  assert.equal(
    (await fetch(origin + path.replace(camera, randomUUID()), { headers: headers() })).status,
    404,
  );
  await db.query("UPDATE user_role_assignment SET role='SITE_MANAGER' WHERE user_id=$1", [actor]);
  try {
    assert.equal((await request()).status, 403);
  } finally {
    await db.query("UPDATE user_role_assignment SET role='SAFETY_OFFICER' WHERE user_id=$1", [
      actor,
    ]);
  }
});
test('camera revision races and role revocation during projection fail before response', async () => {
  const original = cameras.get.bind(cameras);
  cameras.get = async (...args) => ({ ...(await original(...args)), configurationVersion: 8 });
  try {
    assert.equal((await request()).status, 409);
  } finally {
    cameras.get = original;
  }
  cameras.get = async (...args) => {
    const result = await original(...args);
    await db.query('UPDATE app_user SET is_active=false WHERE id=$1', [actor]);
    return result;
  };
  try {
    assert.equal((await request()).status, 401);
  } finally {
    cameras.get = original;
    await db.query('UPDATE app_user SET is_active=true WHERE id=$1', [actor]);
  }
});
test('post-read authorization revocation takes priority over a missing camera lookup', async () => {
  const original = cameras.get.bind(cameras);
  cameras.get = async (siteId) => {
    await db.query('UPDATE app_user SET is_active=false WHERE id=$1', [actor]);
    return original(siteId, randomUUID());
  };
  try {
    assert.equal((await request()).status, 401);
  } finally {
    cameras.get = original;
    await db.query('UPDATE app_user SET is_active=true WHERE id=$1', [actor]);
  }
});
test('true configured-empty camera and existing global Admin access stay distinct from denied metadata', async () => {
  const emptyCamera = randomUUID();
  await db.query(
    "INSERT INTO camera(id,site_id,external_id,code,name,status) VALUES($1,$2,$1::uuid::text,'EMPTY','Configured but not connected','INACTIVE')",
    [emptyCamera, site],
  );
  const empty = await fetch(origin + path.replace(camera, emptyCamera), { headers: headers() });
  assert.equal(empty.status, 200);
  assert.deepEqual(await empty.json(), {
    siteId: site,
    cameraId: emptyCamera,
    configurationVersion: 1,
    items: [],
    total: 0,
    unresolvedRegionCount: 0,
  });
  await db.query("UPDATE user_role_assignment SET role='ADMIN',site_id=NULL WHERE user_id=$1", [
    actor,
  ]);
  try {
    assert.equal((await request()).status, 200);
  } finally {
    await db.query(
      "UPDATE user_role_assignment SET role='SAFETY_OFFICER',site_id=$2 WHERE user_id=$1",
      [actor, site],
    );
  }
});
test('over-capacity stored active Regions are refused rather than silently truncated', async () => {
  const ids = Array.from({ length: 61 }, () => randomUUID());
  for (const id of ids)
    await db.query(
      "INSERT INTO camera_observation_region(id,camera_id,zone_id,polygon) VALUES($1,$2,$3,'[[0,0],[1,0],[0,1]]')",
      [id, camera, zones[0]],
    );
  try {
    assert.equal((await request()).status, 409);
  } finally {
    await db.query('DELETE FROM camera_observation_region WHERE id=ANY($1::uuid[])', [ids]);
  }
});
