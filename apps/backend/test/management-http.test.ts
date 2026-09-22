import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/configure-app.js';
import { validateEnvironment, type BackendEnvironment } from '../src/config/environment.js';
import { createLoggerParams } from '../src/observability/logger.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { SiteConfigurationService } from '../src/modules/sites/site-configuration.service.js';
import { CameraConfigurationService } from '../src/modules/cameras/camera-configuration.service.js';
import { UserRole } from '../src/database/entities/user.entity.js';

test('HTTP separates Admin, Worker and AI configuration credentials', async (t) => {
  const cameraId = randomUUID();
  const deniedCameraId = randomUUID();
  const siteId = randomUUID();
  const serviceToken = 'test-ai-service-token-only';
  const config = new ConfigService<BackendEnvironment, true>(
    validateEnvironment({
      NODE_ENV: 'test',
      LOG_FORMAT: 'json',
      SMARTSITE_AI_SERVICE_TOKEN: serviceToken,
      AI_CONFIGURATION_CAMERA_IDS: cameraId,
    }),
  );
  const fakeDatabase = {
    isInitialized: true,
    query: async () => [{ ok: 1 }],
    destroy: async () => undefined,
  };
  const fakeAuth = {
    authenticate: async (token: string) => {
      const role =
        token === 'A'.repeat(43) || token === 'T'.repeat(43) ? UserRole.ADMIN : UserRole.WORKER;
      return {
        user: {
          id: randomUUID(),
          username: 'tester',
          displayName: 'Tester',
          role,
          isActive: true,
          mustChangePassword: token === 'T'.repeat(43),
        },
        tokenHash: 'fake-hash',
      };
    },
    login: async () => ({
      accessToken: 'A'.repeat(43),
      tokenType: 'Bearer',
      expiresAt: new Date(Date.now() + 1000).toISOString(),
      user: { role: UserRole.ADMIN },
    }),
  };
  const site = { id: siteId, code: 'SITE', name: 'Site', createdAt: new Date() };
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ConfigService)
    .useValue(config)
    .overrideProvider(PARAMS_PROVIDER_TOKEN)
    .useValue(createLoggerParams(config, { write: () => undefined }))
    .overrideProvider(getDataSourceToken())
    .useValue(fakeDatabase)
    .overrideProvider(DataSource)
    .useValue(fakeDatabase)
    .overrideProvider(AuthService)
    .useValue(fakeAuth)
    .overrideProvider(SiteConfigurationService)
    .useValue({ list: async () => ({ items: [site], total: 1 }) })
    .overrideProvider(CameraConfigurationService)
    .useValue({
      buildConfigurationForCamera: async () => ({
        schemaVersion: '1.0.0',
        configurationVersion: 1,
        cameraExternalId: 'CAM-1',
        regions: [],
      }),
    })
    .compile();
  const app = module.createNestApplication<NestExpressApplication>({
    logger: false,
    bodyParser: false,
  });
  await configureApplication(app);
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close());
  const url = await app.getUrl();
  const getSites = (token: string) =>
    fetch(`${url}/api/v1/sites`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  assert.equal((await getSites('A'.repeat(43))).status, 200);
  assert.equal((await getSites('W'.repeat(43))).status, 403);
  assert.equal((await getSites('T'.repeat(43))).status, 403);
  assert.equal((await getSites(serviceToken)).status, 401);
  const login = await fetch(`${url}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'tester', password: 'password' }),
  });
  assert.equal(login.status, 200);
  assert.equal(login.headers.get('cache-control'), 'no-store');
  for (let attempt = 0; attempt < 4; attempt += 1)
    assert.equal(
      (
        await fetch(`${url}/api/v1/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'tester', password: 'password' }),
        })
      ).status,
      200,
    );
  const limited = await fetch(`${url}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'tester', password: 'password' }),
  });
  assert.equal(limited.status, 429);
  assert.equal(
    ((await limited.json()) as { requestId: string }).requestId,
    limited.headers.get('x-request-id'),
  );
  const aiUrl = `${url}/api/v1/integrations/ai/cameras/${cameraId}/configuration`;
  const snapshot = await fetch(aiUrl, { headers: { Authorization: `Bearer ${serviceToken}` } });
  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.headers.get('cache-control'), 'no-store');
  assert.deepEqual(((await snapshot.json()) as { regions: unknown[] }).regions, []);
  assert.equal(
    (await fetch(aiUrl, { headers: { Authorization: `Bearer ${'A'.repeat(43)}` } })).status,
    401,
  );
  assert.equal(
    (
      await fetch(`${url}/api/v1/integrations/ai/cameras/${deniedCameraId}/configuration`, {
        headers: { Authorization: `Bearer ${serviceToken}` },
      })
    ).status,
    404,
  );
});
