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

const owned = createIsolatedTestDatabase(),
  db = owned.dataSource;
let app: NestExpressApplication, auth: AuthService, base: string;
const site = randomUUID(),
  otherSite = randomUUID(),
  camera = randomUUID();
let hash: string;
const password = 'Synthetic_camera_password_123';
let reads = 0;
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
      reads++;
      return new Response(
        JSON.stringify(buildSourcePayload({ capturedAt: new Date().toISOString() })),
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

test('registered image/reference HTTP routes enforce existing read roles and retain UNCONFIRMED provenance', async () => {
  assert.equal((await fetch(`${base}/configuration-reference`)).status, 401);
  const manager = await actor('SITE_MANAGER', site);
  const image = await fetch(`${base}/configuration-image`, { headers: manager.headers });
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('cache-control'), 'no-store');
  const response = await fetch(`${base}/configuration-reference`, { headers: manager.headers });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.viewValidity, 'UNCONFIRMED');
  assert.equal(body.reference.cameraId, camera);
  assert.equal(body.reference.siteId, site);
  const [stored] = await db.query(
    'SELECT issued_by_user_id,image_sha256 FROM camera_configuration_reference WHERE id=$1',
    [body.reference.referenceId],
  );
  assert.equal(stored.issued_by_user_id, manager.id);
  assert.equal(stored.image_sha256, body.image.frame.imageSha256);
  assert.equal(
    (await fetch(`${base}/configuration-reference?source=untrusted`, { headers: manager.headers }))
      .status,
    400,
  );
  for (const role of ['SAFETY_OFFICER', 'ADMIN']) {
    const reader = await actor(role, role === 'ADMIN' ? null : site);
    assert.equal(
      (await fetch(`${base}/configuration-reference`, { headers: reader.headers })).status,
      200,
    );
  }
  const denied = await actor('WORKER', site),
    otherManager = await actor('SITE_MANAGER', otherSite);
  const before = reads;
  assert.equal(
    (await fetch(`${base}/configuration-reference`, { headers: denied.headers })).status,
    403,
  );
  assert.equal(
    (await fetch(`${base}/configuration-reference`, { headers: otherManager.headers })).status,
    403,
  );
  assert.equal(
    (
      await fetch(`${base.replace(site, otherSite)}/configuration-reference`, {
        headers: otherManager.headers,
      })
    ).status,
    404,
  );
  assert.equal(reads, before);
  await db.query('UPDATE app_user SET must_change_password=true WHERE id=$1', [manager.id]);
  assert.equal(
    (await fetch(`${base}/configuration-reference`, { headers: manager.headers })).status,
    403,
  );
  await db.query('UPDATE app_user SET must_change_password=false WHERE id=$1', [manager.id]);
  await auth.logout(manager.session.refreshToken, AuthClientType.WEB);
  assert.equal(
    (await fetch(`${base}/configuration-reference`, { headers: manager.headers })).status,
    401,
  );
});
