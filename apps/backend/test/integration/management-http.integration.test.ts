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
import type { ErrorResponseDto } from '../../src/common/http/error-response.dto.js';
import { validateEnvironment, type BackendEnvironment } from '../../src/config/environment.js';
import { createLoggerParams } from '../../src/observability/logger.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { UserRole } from '../../src/database/entities/user.entity.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import {
  UserEntity,
  WorkerEntity,
  WorkerSiteZoneAssignmentEntity,
  WorkerSiteZoneAssignmentStatus,
  ZoneAccessEffect,
} from '../../src/database/entities/index.js';
import { ContractorZoneAccessManagementService } from '../../src/modules/zones/contractor-zone-access-management.service.js';

after(async () => {
  if (dataSource.isInitialized) await dataSource.destroy();
});

test('Admin HTTP setup feeds an allowlisted AI snapshot and versioned observation', async () => {
  await dataSource.initialize();
  const suffix = randomUUID().slice(0, 8);
  const temporaryPassword = 'TempAdmin123!';
  const newPassword = 'PermanentAdmin123!';
  const serviceToken = 'test-ai-service-token-only';
  await new UsersService(dataSource, new SiteConfigurationService(dataSource)).create({
    username: `http-admin-${suffix}`,
    displayName: 'HTTP Admin',
    roleAssignments: [{ role: UserRole.ADMIN, siteId: null }],
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
      clientType: 'MOBILE',
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
      clientType: 'MOBILE',
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
        restrictionPolicy: 'AUTHORIZATION_REQUIRED',
        requiredPpe: [],
      },
      adminToken,
    );
    assert.equal(zoneResponse.status, 201);
    const zone = (await zoneResponse.json()) as { id: string };
    const workerResponse = await post(
      `/sites/${site.id}/workers`,
      { externalId: `WORKER-${suffix}`, displayName: 'Authorized Worker' },
      adminToken,
    );
    assert.equal(workerResponse.status, 201);
    const worker = (await workerResponse.json()) as { id: string };
    const workerList = await fetch(`${url}/api/v1/sites/${site.id}/workers`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(workerList.status, 200);
    assert.equal(((await workerList.json()) as { total: number }).total, 1);
    const timezoneLessGrant = await post(
      `/sites/${site.id}/zones/${zone.id}/access-grants`,
      {
        workerId: worker.id,
        effect: 'ALLOW',
        validFrom: '2026-09-28T00:00:00',
        validUntil: null,
      },
      adminToken,
    );
    assert.equal(timezoneLessGrant.status, 400);
    const grantValidFrom = new Date(Date.now() + 60_000).toISOString();
    const unavailableGrant = await post(
      `/sites/${site.id}/zones/${zone.id}/access-grants`,
      { workerId: worker.id, effect: 'ALLOW', validFrom: grantValidFrom, validUntil: null },
      adminToken,
    );
    assert.equal(unavailableGrant.status, 409);
    const unavailableBody = (await unavailableGrant.json()) as ErrorResponseDto;
    assert.equal(unavailableBody.code, 'CONFLICT');
    assert.equal(unavailableBody.success, false);
    assert.equal(unavailableBody.statusCode, 409);

    // Synthetic command prerequisites. This exercises the HTTP grant guard,
    // not Worker registration/assignment review or real camera identity.
    const contractorResponse = await post(
      `/sites/${site.id}/contractors`,
      { code: `CTR-${suffix}`, name: 'Synthetic HTTP Contractor' },
      adminToken,
    );
    assert.equal(contractorResponse.status, 201);
    const contractor = (await contractorResponse.json()) as { id: string };
    const adminRow = await dataSource
      .getRepository(UserEntity)
      .findOneByOrFail({ username: `http-admin-${suffix}` });
    await dataSource
      .getRepository(WorkerEntity)
      .update({ id: worker.id }, { contractorId: contractor.id });
    await dataSource.getRepository(WorkerSiteZoneAssignmentEntity).insert({
      id: randomUUID(),
      workerId: worker.id,
      siteId: site.id,
      contractorId: contractor.id,
      zoneIds: [zone.id],
      status: WorkerSiteZoneAssignmentStatus.APPROVED,
      validFrom: new Date(grantValidFrom),
      validUntil: null,
      requestedByUserId: adminRow.id,
    });
    await new ContractorZoneAccessManagementService(dataSource).createGrant(
      site.id,
      zone.id,
      {
        contractorId: contractor.id,
        effect: ZoneAccessEffect.ALLOW,
        validFrom: grantValidFrom,
        validUntil: null,
      },
      { kind: 'USER', userId: adminRow.id },
    );
    const grantResponse = await post(
      `/sites/${site.id}/zones/${zone.id}/access-grants`,
      {
        workerId: worker.id,
        effect: 'ALLOW',
        validFrom: grantValidFrom,
        validUntil: null,
      },
      adminToken,
    );
    assert.equal(grantResponse.status, 201);
    const grantList = await fetch(`${url}/api/v1/sites/${site.id}/zones/${zone.id}/access-grants`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(grantList.status, 200);
    const grantListBody = (await grantList.json()) as { items: { id: string }[]; total: number };
    assert.equal(grantListBody.total, 1);
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
          type: 'IDENTITY_CANDIDATE',
          trackId: 1,
          status: 'CANDIDATE',
          candidateWorkerId: `WORKER-${suffix}`,
          similarityScore: 0.98,
        },
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
    const unverifiedDecisions = await fetch(
      `${url}/api/v1/sites/${site.id}/zone-entry-decisions?zoneId=${zone.id}&status=UNAVAILABLE`,
      { headers: { Authorization: `Bearer ${adminToken}` } },
    );
    assert.equal(unverifiedDecisions.status, 200);
    assert.equal(((await unverifiedDecisions.json()) as { total: number }).total, 1);
    const retry = await post('/integrations/ai/events', event, serviceToken);
    assert.equal(retry.status, 202);
    assert.equal(((await retry.json()) as { status: string }).status, 'DUPLICATE_ACCEPTED');
    const revoked = await fetch(
      `${url}/api/v1/sites/${site.id}/zones/${zone.id}/access-grants/${grantListBody.items[0]!.id}/revoke`,
      {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${adminToken}` },
      },
    );
    assert.equal(revoked.status, 200);
    assert.notEqual(((await revoked.json()) as { revokedAt: string | null }).revokedAt, null);
    const deniedEvent = await post(
      '/integrations/ai/events',
      { ...event, eventId: randomUUID(), capturedAt: new Date().toISOString() },
      serviceToken,
    );
    assert.equal(deniedEvent.status, 202);
    assert.equal(((await deniedEvent.json()) as { status: string }).status, 'PROCESSED');
    const stillUnverifiedDecisions = await fetch(
      `${url}/api/v1/sites/${site.id}/zone-entry-decisions?zoneId=${zone.id}&status=UNAVAILABLE`,
      { headers: { Authorization: `Bearer ${adminToken}` } },
    );
    assert.equal(stillUnverifiedDecisions.status, 200);
    assert.equal(((await stillUnverifiedDecisions.json()) as { total: number }).total, 2);
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
