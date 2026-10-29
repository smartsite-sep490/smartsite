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
let sourceSession: string = randomUUID();
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

import {
  provisionCameraWorkerGeneration,
  revokeCameraWorkerGeneration,
} from '../../src/modules/cameras/camera-worker-generations.js';

test('registered ACK route persists an authenticated receipt without claiming application readiness', async () => {
  const credential = await provisionCameraWorkerGeneration(db, camera, [camera], 60000);
  sourceSession = credential.streamSessionId;
  const manager = await actor('SITE_MANAGER', site);
  assert.equal(
    (await fetch(`${base}/configuration-reference`, { headers: manager.headers })).status,
    200,
  );
  for (const [status, version] of [
    ['INACTIVE', 1],
    ['ACTIVE', 2],
  ] as const) {
    const result = await fetch(`${base}/status`, {
      method: 'PATCH',
      headers: { ...manager.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, expectedConfigurationVersion: version }),
    });
    assert.equal(result.status, 200);
  }
  const endpoint = `${base.replace('/sites/', '/integrations/ai/sites/').replace(`/sites/${site}`, '')}`;
  const service = { Authorization: 'Bearer synthetic-bundle-source-token' };
  const bundleResponse = await fetch(`${endpoint}/configuration-bundle`, { headers: service });
  assert.equal(bundleResponse.status, 200);
  const bundle = await bundleResponse.json();
  const command = {
    commandId: randomUUID(),
    workerGenerationId: credential.workerGenerationId,
    streamSessionId: credential.streamSessionId,
    configurationVersion: bundle.configurationVersion,
    bundleSha256: bundle.bundleSha256,
    viewRevision: bundle.viewRevision,
    outcome: 'LOADED',
  };
  const send = (headers: Record<string, string>, body = command) =>
    fetch(`${endpoint}/configuration-ack`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  assert.equal((await send(service)).status, 401);
  assert.equal((await send(manager.headers)).status, 401);
  const headers = { ...service, 'x-worker-generation-secret': credential.secret };
  const first = await send(headers);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('cache-control'), 'no-store');
  const receipt = await first.json();
  assert.equal(receipt.replayed, false);
  assert.equal(receipt.outcome, 'LOADED');
  assert.equal(receipt.applicationState, undefined);
  assert.ok(!JSON.stringify(receipt).includes(credential.secret));
  assert.equal((await (await send(headers)).json()).replayed, true);
  assert.equal((await send(headers, { ...command, outcome: 'REJECTED' })).status, 409);
  const rows = await db.query(
    'SELECT command_id,bundle_sha256 FROM camera_configuration_application_receipt',
  );
  assert.deepEqual(rows, [{ command_id: command.commandId, bundle_sha256: bundle.bundleSha256 }]);
  await revokeCameraWorkerGeneration(db, camera, [camera], credential.workerGenerationId);
  assert.equal((await send(headers)).status, 409);
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM camera_configuration_application_receipt'))[0]
      .n,
    1,
  );
});
