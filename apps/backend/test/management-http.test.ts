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
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/configure-app.js';
import { validateEnvironment, type BackendEnvironment } from '../src/config/environment.js';
import { createLoggerParams } from '../src/observability/logger.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { SiteConfigurationService } from '../src/modules/sites/site-configuration.service.js';
import { CameraConfigurationService } from '../src/modules/cameras/camera-configuration.service.js';
import { UserRole } from '../src/database/entities/user.entity.js';
import { AlertStatus, AlertType, EventProcessingStatus } from '../src/database/entities/enums.js';
import { SafetyAlertQueryService } from '../src/modules/safety/alerts/safety-alert-query.service.js';

test('HTTP separates Admin, Worker and AI configuration credentials', async (t) => {
  const cameraId = randomUUID();
  const deniedCameraId = randomUUID();
  const siteId = randomUUID();
  const serviceToken = 'test-ai-service-token-only';
  const jwt = (value: string) => `${value.repeat(16)}.${value.repeat(16)}.${value.repeat(16)}`;
  const adminToken = jwt('A');
  const temporaryAdminToken = jwt('T');
  const workerToken = jwt('W');
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
      const roleAssignments =
        token === adminToken || token === temporaryAdminToken
          ? [{ role: UserRole.ADMIN, siteId: null }]
          : [{ role: UserRole.SECURITY_OFFICER, siteId }];
      return {
        user: {
          id: randomUUID(),
          username: 'tester',
          displayName: 'Tester',
          roleAssignments,
          isActive: true,
          mustChangePassword: token === temporaryAdminToken,
        },
        sessionId: randomUUID(),
        clientType: 'MOBILE',
      };
    },
    login: async () => ({
      accessToken: adminToken,
      tokenType: 'Bearer',
      accessTokenExpiresAt: new Date(Date.now() + 1000).toISOString(),
      refreshToken: `${randomUUID()}.${'R'.repeat(43)}`,
      refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      user: { roleAssignments: [{ role: UserRole.ADMIN, siteId: null }] },
    }),
  };
  const site = { id: siteId, code: 'SITE', name: 'Site', createdAt: new Date() };
  const alertId = randomUUID();
  const alert = {
    id: alertId,
    siteId,
    zoneId: null,
    candidateWorkerId: null,
    alertType: AlertType.PPE_VIOLATION,
    candidateSubtype: 'PPE_HARD_HAT_MISSING',
    status: AlertStatus.PENDING_REVIEW,
    firstDetectedAt: new Date('2026-09-27T01:00:00Z'),
    lastDetectedAt: new Date('2026-09-27T01:01:00Z'),
    detectionCount: 3,
    createdAt: new Date('2026-09-27T01:00:00Z'),
  };
  let alertListArguments: unknown[] | undefined;
  let configurationReads = 0;
  let cameraExternalId = 'CAM-1';
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
      buildConfigurationForCamera: async () => {
        configurationReads += 1;
        return {
          schemaVersion: '1.0.0',
          configurationVersion: 1,
          cameraExternalId,
          regions: [],
        };
      },
    })
    .overrideProvider(SafetyAlertQueryService)
    .useValue({
      list: async (...args: unknown[]) => {
        alertListArguments = args;
        return { items: [alert], total: 1 };
      },
      get: async () => ({
        alert,
        detections: [
          {
            eventId: randomUUID(),
            cameraExternalId: 'CAM-1',
            capturedAt: new Date('2026-09-27T01:01:00Z'),
            processingStatus: EventProcessingStatus.PROCESSED,
          },
        ],
        detectionsTotal: 1,
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
  assert.equal((await getSites(adminToken)).status, 200);
  assert.equal((await getSites(workerToken)).status, 403);
  assert.equal((await getSites(temporaryAdminToken)).status, 403);
  assert.equal((await getSites(serviceToken)).status, 401);
  const alertsUrl = `${url}/api/v1/sites/${siteId}/safety-alerts`;
  const alertList = await fetch(
    `${alertsUrl}?offset=2&limit=5&status=PENDING_REVIEW&type=PPE_VIOLATION`,
    { headers: { Authorization: `Bearer ${adminToken}` } },
  );
  assert.equal(alertList.status, 200);
  assert.equal(alertList.headers.get('cache-control'), 'no-store');
  assert.deepEqual(alertListArguments, [
    siteId,
    2,
    5,
    {
      status: AlertStatus.PENDING_REVIEW,
      type: AlertType.PPE_VIOLATION,
    },
  ]);
  assert.equal(((await alertList.json()) as { total: number }).total, 1);
  const alertDetail = await fetch(`${alertsUrl}/${alertId}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  assert.equal(alertDetail.status, 200);
  assert.equal(alertDetail.headers.get('cache-control'), 'no-store');
  const alertDetailBody = (await alertDetail.json()) as Record<string, unknown>;
  assert.equal(alertDetailBody.id, alertId);
  assert.equal(alertDetailBody.detectionsTotal, 1);
  assert.equal('rawPayload' in alertDetailBody, false);
  assert.equal(
    (await fetch(alertsUrl, { headers: { Authorization: `Bearer ${workerToken}` } })).status,
    403,
  );
  assert.equal(
    (await fetch(alertsUrl, { headers: { Authorization: `Bearer ${serviceToken}` } })).status,
    401,
  );
  const login = await fetch(`${url}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'tester', password: 'password', clientType: 'MOBILE' }),
  });
  assert.equal(login.status, 200);
  assert.equal(login.headers.get('cache-control'), 'no-store');
  for (let attempt = 0; attempt < 4; attempt += 1)
    assert.equal(
      (
        await fetch(`${url}/api/v1/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'tester', password: 'password', clientType: 'MOBILE' }),
        })
      ).status,
      200,
    );
  const limited = await fetch(`${url}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'tester', password: 'password', clientType: 'MOBILE' }),
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
  const etag = `"sha256:${computeCanonicalPayloadHash({
    schemaVersion: '1.0.0',
    configurationVersion: 1,
    cameraExternalId: 'CAM-1',
    regions: [],
  })}"`;
  assert.equal(snapshot.headers.get('etag'), etag);
  assert.deepEqual(((await snapshot.json()) as { regions: unknown[] }).regions, []);
  const unchanged = await fetch(aiUrl, {
    headers: { Authorization: `Bearer ${serviceToken}`, 'If-None-Match': etag },
  });
  assert.equal(unchanged.status, 304);
  assert.equal(unchanged.headers.get('etag'), etag);
  assert.equal(unchanged.headers.get('cache-control'), 'no-store');
  assert.equal(await unchanged.text(), '');
  const weakUnchanged = await fetch(aiUrl, {
    headers: { Authorization: `Bearer ${serviceToken}`, 'If-None-Match': `W/${etag}` },
  });
  assert.equal(weakUnchanged.status, 304);
  assert.equal(weakUnchanged.headers.get('etag'), etag);
  assert.equal(await weakUnchanged.text(), '');
  const changed = await fetch(aiUrl, {
    headers: { Authorization: `Bearer ${serviceToken}`, 'If-None-Match': `"${cameraId}:0"` },
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.headers.get('etag'), etag);
  assert.deepEqual(((await changed.json()) as { regions: unknown[] }).regions, []);
  assert.equal(configurationReads, 4);
  cameraExternalId = 'CAM-1-REPAIRED';
  const sameVersionDifferentBody = await fetch(aiUrl, {
    headers: { Authorization: `Bearer ${serviceToken}`, 'If-None-Match': etag },
  });
  assert.equal(sameVersionDifferentBody.status, 200);
  assert.notEqual(sameVersionDifferentBody.headers.get('etag'), etag);
  assert.equal(
    ((await sameVersionDifferentBody.json()) as { cameraExternalId: string }).cameraExternalId,
    'CAM-1-REPAIRED',
  );
  assert.equal(configurationReads, 5);
  assert.equal(
    (await fetch(aiUrl, { headers: { Authorization: `Bearer ${adminToken}` } })).status,
    401,
  );
  const denied = await fetch(
    `${url}/api/v1/integrations/ai/cameras/${deniedCameraId}/configuration`,
    { headers: { Authorization: `Bearer ${serviceToken}`, 'If-None-Match': '*' } },
  );
  assert.equal(denied.status, 404);
  const deniedBody = (await denied.json()) as {
    success: boolean;
    statusCode: number;
    code: string;
    message: string;
    requestId: string;
  };
  assert.deepEqual(
    {
      success: deniedBody.success,
      statusCode: deniedBody.statusCode,
      code: deniedBody.code,
      message: deniedBody.message,
    },
    {
      success: false,
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Configuration resource not found',
    },
  );
  assert.equal(deniedBody.requestId, denied.headers.get('x-request-id'));
  const invalid = await fetch(`${url}/api/v1/integrations/ai/cameras/not-a-uuid/configuration`, {
    headers: { Authorization: `Bearer ${serviceToken}`, 'If-None-Match': '*' },
  });
  assert.equal(invalid.status, 404);
  const invalidBody = (await invalid.json()) as {
    success: boolean;
    statusCode: number;
    code: string;
    message: string;
    requestId: string;
  };
  assert.deepEqual(
    {
      success: invalidBody.success,
      statusCode: invalidBody.statusCode,
      code: invalidBody.code,
      message: invalidBody.message,
    },
    {
      success: false,
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Configuration resource not found',
    },
  );
  assert.equal(invalidBody.requestId, invalid.headers.get('x-request-id'));
  assert.equal(configurationReads, 5);
});
