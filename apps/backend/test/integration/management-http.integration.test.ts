import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { parseCameraRegionConfigurationPayload } from '@smartsite/contracts';
import { PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import { DataSource } from 'typeorm';
import dataSource from '../support/test-data-source.js';
import { AppModule } from '../../src/app.module.js';
import { configureApplication } from '../../src/configure-app.js';
import { validateEnvironment, type BackendEnvironment } from '../../src/config/environment.js';
import { createLoggerParams } from '../../src/observability/logger.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { UserRole } from '../../src/database/entities/user.entity.js';

after(async () => {
  if (dataSource.isInitialized) await dataSource.destroy();
});

test('Admin HTTP setup feeds an allowlisted AI snapshot and versioned observation', async () => {
  await dataSource.initialize();
  const suffix = randomUUID().slice(0, 8);
  const temporaryPassword = 'temporary-admin-password-123';
  const newPassword = 'permanent-admin-password-123';
  const serviceToken = 'test-ai-service-token-only';
  await new UsersService(dataSource).create({
    username: `http-admin-${suffix}`,
    displayName: 'HTTP Admin',
    role: UserRole.ADMIN,
    temporaryPassword,
  });
  const environment = validateEnvironment({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    LOG_FORMAT: 'json',
    SMARTSITE_AI_SERVICE_TOKEN: serviceToken,
  });
  const config = new ConfigService<BackendEnvironment, true>(environment);
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ConfigService)
    .useValue(config)
    .overrideProvider(PARAMS_PROVIDER_TOKEN)
    .useValue(createLoggerParams(config, { write: () => undefined }))
    .overrideProvider(getDataSourceToken())
    .useValue(dataSource)
    .overrideProvider(DataSource)
    .useValue(dataSource)
    .compile();
  const app = module.createNestApplication<NestExpressApplication>({
    logger: false,
    bodyParser: false,
  });
  await configureApplication(app);
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();
  const post = (path: string, body: unknown, token?: string) =>
    fetch(`${url}/api/v1${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  try {
    const firstLogin = await post('/auth/login', {
      username: `http-admin-${suffix}`,
      password: temporaryPassword,
    });
    assert.equal(firstLogin.status, 200);
    const temporaryToken = ((await firstLogin.json()) as { accessToken: string }).accessToken;
    assert.equal(
      (await post('/sites', { code: 'DENIED', name: 'Denied' }, temporaryToken)).status,
      403,
    );
    assert.equal(
      (
        await post(
          '/auth/change-password',
          {
            currentPassword: temporaryPassword,
            newPassword,
          },
          temporaryToken,
        )
      ).status,
      204,
    );
    assert.equal(
      (
        await fetch(`${url}/api/v1/auth/me`, {
          headers: { Authorization: `Bearer ${temporaryToken}` },
        })
      ).status,
      401,
    );
    const secondLogin = await post('/auth/login', {
      username: `http-admin-${suffix}`,
      password: newPassword,
    });
    assert.equal(secondLogin.status, 200);
    const adminToken = ((await secondLogin.json()) as { accessToken: string }).accessToken;
    const siteResponse = await post('/sites', { code: `SITE-${suffix}`, name: 'Site' }, adminToken);
    assert.equal(siteResponse.status, 201);
    const site = (await siteResponse.json()) as { id: string };
    const cameraResponse = await post(
      `/sites/${site.id}/cameras`,
      {
        code: `CAM-${suffix}`,
        externalId: `AI-CAM-${suffix}`,
        name: 'Gate',
      },
      adminToken,
    );
    assert.equal(cameraResponse.status, 201);
    const camera = (await cameraResponse.json()) as { id: string; configurationVersion: number };
    environment.AI_CONFIGURATION_CAMERA_IDS.push(camera.id);
    const zoneResponse = await post(
      `/sites/${site.id}/zones`,
      {
        code: `ZONE-${suffix}`,
        name: 'Restricted gate',
        type: 'RESTRICTED',
        restrictionPolicy: 'PROHIBITED_FOR_ALL',
        requiredPpe: [],
      },
      adminToken,
    );
    assert.equal(zoneResponse.status, 201);
    const zone = (await zoneResponse.json()) as { id: string };
    const regionResponse = await post(
      `/sites/${site.id}/cameras/${camera.id}/regions`,
      {
        zoneId: zone.id,
        polygon: {
          coordinates: [
            [0, 0],
            [1, 0],
            [0, 1],
          ],
        },
        expectedConfigurationVersion: camera.configurationVersion,
      },
      adminToken,
    );
    assert.equal(regionResponse.status, 201);
    const created = (await regionResponse.json()) as {
      region: { id: string; version: number };
      configurationVersion: number;
    };
    assert.equal(created.configurationVersion, 2);
    const configurationUrl = `${url}/api/v1/integrations/ai/cameras/${camera.id}/configuration`;
    const snapshotResponse = await fetch(configurationUrl, {
      headers: { Authorization: `Bearer ${serviceToken}` },
    });
    assert.equal(snapshotResponse.status, 200);
    const snapshotText = await snapshotResponse.text();
    assert.equal(parseCameraRegionConfigurationPayload(snapshotText).isValid, true);
    const snapshot = JSON.parse(snapshotText) as {
      configurationVersion: number;
      regions: { regionId: string; geometryVersion: number }[];
    };
    assert.equal(snapshot.configurationVersion, 2);
    assert.equal(snapshot.regions[0]?.regionId, created.region.id);
    const event = {
      eventId: randomUUID(),
      schemaVersion: '1.0.0',
      cameraExternalId: `AI-CAM-${suffix}`,
      streamSessionId: randomUUID(),
      capturedAt: new Date().toISOString(),
      frameDimensions: { width: 640, height: 480 },
      observations: [
        {
          type: 'ZONE_ENTRY',
          trackId: 1,
          regionId: created.region.id,
          geometryVersion: created.region.version,
        },
      ],
      evidence: [],
    };
    const firstEvent = await post('/integrations/ai/events', event, serviceToken);
    assert.equal(firstEvent.status, 202);
    assert.equal(((await firstEvent.json()) as { status: string }).status, 'PROCESSED');
    const retry = await post('/integrations/ai/events', event, serviceToken);
    assert.equal(retry.status, 202);
    assert.equal(((await retry.json()) as { status: string }).status, 'DUPLICATE_ACCEPTED');
    const changed = await fetch(
      `${url}/api/v1/sites/${site.id}/cameras/${camera.id}/regions/${created.region.id}/polygon`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          polygon: {
            coordinates: [
              [0, 0],
              [1, 0],
              [0.5, 1],
            ],
          },
          expectedConfigurationVersion: 2,
        }),
      },
    );
    assert.equal(changed.status, 200);
    const stale = await post(
      '/integrations/ai/events',
      { ...event, eventId: randomUUID() },
      serviceToken,
    );
    assert.equal(stale.status, 202);
    assert.equal(((await stale.json()) as { status: string }).status, 'SKIPPED_NO_CANDIDATE');
  } finally {
    await app.close();
  }
});
