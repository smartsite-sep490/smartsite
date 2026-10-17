import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { parseCameraRegionConfigurationPayload } from '@smartsite/contracts';
import { PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import { DataSource } from 'typeorm';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { AppModule } from '../../src/app.module.js';
import { configureApplication } from '../../src/configure-app.js';
import type { ErrorResponseDto } from '../../src/common/http/error-response.dto.js';
import { validateEnvironment, type BackendEnvironment } from '../../src/config/environment.js';
import { createLoggerParams } from '../../src/observability/logger.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { UserRole } from '../../src/database/entities/user.entity.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';

const database = createIsolatedTestDatabase({ canonical: true }),
  dataSource = database.dataSource;

before(async () => {
  await database.initialize();
});

after(async () => {
  await database.dispose();
});

test('Admin Site setup and scoped Manager Zone setup feed an allowlisted AI snapshot and versioned observation', async () => {
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
      (
        await fetch(`${url}/api/v1/sites`, {
          headers: { Authorization: `Bearer ${temporaryToken}` },
        })
      ).status,
      200,
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
    const managerResponse = await post(
      '/users',
      {
        username: `http-manager-${suffix}`,
        displayName: 'Site Manager',
        temporaryPassword,
        roleAssignments: [{ role: 'SITE_MANAGER', siteId: site.id }],
      },
      adminToken,
    );
    assert.equal(managerResponse.status, 201);
    const managerLogin = await post('/auth/login', {
      username: `http-manager-${suffix}`,
      password: temporaryPassword,
      clientType: 'MOBILE',
    });
    assert.equal(managerLogin.status, 200);
    const managerToken = ((await managerLogin.json()) as { accessToken: string }).accessToken;
    const contractorPath = `/sites/${site.id}/contractors`;
    const contractorInput = { code: `CTR-${suffix}`, name: 'HTTP contractor' };
    assert.equal((await post(contractorPath, contractorInput, managerToken)).status, 403);
    assert.equal(
      (await post(`/sites/${randomUUID()}/contractors`, contractorInput, managerToken)).status,
      403,
    );
    const contractorResponse = await post(contractorPath, contractorInput, adminToken);
    assert.equal(contractorResponse.status, 201);
    const contractor = (await contractorResponse.json()) as { id: string };
    const generatedContractor = await post(
      contractorPath,
      { name: 'Automatic code contractor' },
      adminToken,
    );
    assert.equal(generatedContractor.status, 201);
    const generatedBody = (await generatedContractor.clone().json()) as { id: string };
    for (const id of [contractor.id, generatedBody.id]) {
      const participation = await post(
        `/contractors/${id}/participations`,
        { siteId: site.id, validFrom: '2020-01-01T00:00:00Z', validUntil: null },
        managerToken,
      );
      assert.equal(participation.status, 201);
    }
    assert.match(
      ((await generatedContractor.json()) as { code: string }).code,
      /^CTR-[0-9A-F-]{36}$/,
    );
    const overviewPath = `${url}/api/v1/sites/${site.id}/management/overview`;
    assert.equal((await fetch(overviewPath)).status, 401);
    assert.equal(
      (await fetch(overviewPath, { headers: { Authorization: `Bearer ${adminToken}` } })).status,
      403,
    );
    const overviewResponse = await fetch(overviewPath, {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    const participationPath = `${url}/api/v1/contractors/${contractor.id}/participations`;
    assert.equal((await fetch(participationPath)).status, 401);
    assert.equal(
      (await fetch(participationPath, { headers: { Authorization: `Bearer ${managerToken}` } }))
        .status,
      403,
    );
    const participationResponse = await fetch(`${participationPath}?offset=0&limit=1`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(participationResponse.status, 200);
    const participationBody = await participationResponse.json();
    assert.equal(participationBody.items[0].site.id, site.id);
    assert.equal(participationBody.items[0].status, 'ACTIVE');
    assert.equal(
      (
        await fetch(`${participationPath}?limit=101`, {
          headers: { Authorization: `Bearer ${adminToken}` },
        })
      ).status,
      400,
    );
    const directoryPath = `${url}/api/v1/contractors?limit=1`;
    assert.equal(
      (await fetch(directoryPath, { headers: { Authorization: `Bearer ${adminToken}` } })).status,
      200,
    );
    assert.equal(
      (await fetch(directoryPath, { headers: { Authorization: `Bearer ${managerToken}` } })).status,
      403,
    );
    assert.equal(overviewResponse.status, 200);
    assert.equal(
      ((await overviewResponse.json()) as { contractorCount: number }).contractorCount,
      2,
    );
    const detailPath = `${url}/api/v1/sites/${site.id}/management/contractors/${contractor.id}`;
    assert.equal(
      (
        await fetch(`${detailPath}?date=2026-10-12&timezone=Asia%2FHo_Chi_Minh`, {
          headers: { Authorization: `Bearer ${managerToken}` },
        })
      ).status,
      200,
    );
    assert.equal(
      (await fetch(detailPath, { headers: { Authorization: `Bearer ${managerToken}` } })).status,
      400,
    );
    const repPath = `/sites/${site.id}/contractors/${contractor.id}/representative-accounts`;
    const repInput = {
      username: `http-rep-${suffix}`,
      displayName: 'Representative',
      temporaryPassword,
    };
    assert.equal((await post(repPath, repInput, adminToken)).status, 403);
    assert.equal(
      (
        await post(
          repPath,
          { ...repInput, roleAssignments: [{ role: 'ADMIN', siteId: null }] },
          managerToken,
        )
      ).status,
      400,
    );
    assert.equal((await post(repPath, repInput, managerToken)).status, 201);
    assert.equal(
      (await fetch(`${url}/api/v1/users`, { headers: { Authorization: `Bearer ${managerToken}` } }))
        .status,
      403,
    );
    const scopedAccounts = await fetch(`${url}/api/v1/sites/${site.id}/representative-accounts`, {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    assert.equal(scopedAccounts.status, 200);
    assert.equal(((await scopedAccounts.json()) as { total: number }).total, 1);
    assert.equal(
      (
        await post(
          `/sites/${site.id}/zones`,
          {
            code: 'DENIED',
            name: 'Denied',
            type: 'STANDARD',
            restrictionPolicy: 'NONE',
            requiredPpe: [],
          },
          adminToken,
        )
      ).status,
      403,
    );
    const representativeLogin = await post('/auth/login', {
      username: repInput.username,
      password: temporaryPassword,
      clientType: 'MOBILE',
    });
    assert.equal(representativeLogin.status, 200);
    const representativeToken = ((await representativeLogin.json()) as { accessToken: string })
      .accessToken;
    const cameraResponse = await post(
      `/sites/${site.id}/cameras`,
      {
        code: `CAM-${suffix}`,
        externalId: `AI-CAM-${suffix}`,
        name: 'Gate',
      },
      managerToken,
    );
    assert.equal(cameraResponse.status, 201);
    const camera = (await cameraResponse.json()) as { id: string; configurationVersion: number };
    environment.AI_CONFIGURATION_CAMERA_IDS.push(camera.id);
    const zoneInput = {
      code: `ZONE-${suffix}`,
      name: 'Restricted gate',
      type: 'RESTRICTED',
      restrictionPolicy: 'AUTHORIZATION_REQUIRED',
      requiredPpe: [],
    };
    assert.equal((await post(`/sites/${site.id}/zones`, zoneInput, adminToken)).status, 403);
    assert.equal(
      (await post(`/sites/${randomUUID()}/zones`, zoneInput, managerToken)).status,
      403,
    );
    const zoneResponse = await post(`/sites/${site.id}/zones`, zoneInput, managerToken);
    assert.equal(zoneResponse.status, 201);
    const zone = (await zoneResponse.json()) as { id: string };
    const setupOptions = await fetch(`${url}/api/v1/sites/${site.id}/access-setup`, {
      headers: { Authorization: `Bearer ${managerToken}` },
    });
    assert.equal(setupOptions.status, 200);
    const participation = (
      (await setupOptions.json()) as { participations: { id: string; contractorId: string }[] }
    ).participations.find((p) => p.contractorId === contractor.id)!;
    const workDate = new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10);
    const dateGrant = {
      requestId: randomUUID(),
      siteContractorId: participation.id,
      zoneId: zone.id,
      startDate: workDate,
      endDate: workDate,
      timezone: 'Asia/Ho_Chi_Minh',
    };
    const datesPath = `/sites/${site.id}/access-setup/contractor-zone-permissions/dates`;
    assert.equal((await post(datesPath, dateGrant, adminToken)).status, 403);
    assert.equal(
      (
        await post(
          `/sites/${randomUUID()}/access-setup/contractor-zone-permissions/dates`,
          dateGrant,
          managerToken,
        )
      ).status,
      403,
    );
    assert.equal(
      (await post(datesPath, { ...dateGrant, startDate: `${workDate}T10:00:00Z` }, managerToken))
        .status,
      400,
    );
    assert.equal(
      (await post(datesPath, { ...dateGrant, validUntil: `${workDate}T10:00:00Z` }, managerToken))
        .status,
      400,
    );
    const dateResponse = await post(datesPath, dateGrant, managerToken);
    assert.equal(dateResponse.status, 201);
    const datePermission = (await dateResponse.json()) as {
      id: string;
      validFrom: string;
      validUntil: string;
    };
    const expectedStart = new Date(`${workDate}T00:00:00+07:00`);
    assert.equal(datePermission.validFrom, expectedStart.toISOString());
    assert.equal(datePermission.validUntil, new Date(+expectedStart + 86400_000).toISOString());
    const dateRetry = await post(datesPath, dateGrant, managerToken);
    assert.equal(dateRetry.status, 201);
    assert.equal(((await dateRetry.json()) as { id: string }).id, datePermission.id);
    const workerResponse = await post(
      `/sites/${site.id}/workers`,
      {
        contractorId: contractor.id,
        externalId: `WORKER-${suffix}`,
        displayName: 'Authorized Worker',
      },
      representativeToken,
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
        effect: 'DENY',
        validFrom: '2026-09-28T00:00:00',
        validUntil: null,
      },
      managerToken,
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

    // A canonical Contractor date permission was created above. It does not
    // make the legacy flat worker ALLOW route valid or establish Worker identity.
    const flatAllowWithContractorPermission = await post(
      `/sites/${site.id}/zones/${zone.id}/access-grants`,
      {
        workerId: worker.id,
        effect: 'ALLOW',
        validFrom: grantValidFrom,
        validUntil: null,
      },
      adminToken,
    );
    assert.equal(flatAllowWithContractorPermission.status, 409);
    const flatAllowBody = (await flatAllowWithContractorPermission.json()) as ErrorResponseDto;
    assert.equal(flatAllowBody.code, 'CONFLICT');
    const emptyGrantList = await fetch(
      `${url}/api/v1/sites/${site.id}/zones/${zone.id}/access-grants`,
      { headers: { Authorization: `Bearer ${adminToken}` } },
    );
    assert.equal(emptyGrantList.status, 200);
    assert.equal(((await emptyGrantList.json()) as { total: number }).total, 0);

    const denyGrantResponse = await post(
      `/sites/${site.id}/zones/${zone.id}/access-grants`,
      {
        workerId: worker.id,
        effect: 'DENY',
        // Main's independent DENY does not require an approved assignment window.
        validFrom: '2026-09-28T00:00:00.000Z',
        validUntil: null,
      },
      managerToken,
    );
    assert.equal(denyGrantResponse.status, 201);
    const denyGrantBody = (await denyGrantResponse.json()) as { id: string; effect: string };
    assert.equal(denyGrantBody.effect, 'DENY');

    const grantList = await fetch(`${url}/api/v1/sites/${site.id}/zones/${zone.id}/access-grants`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(grantList.status, 200);
    const grantListBody = (await grantList.json()) as {
      items: { id: string; effect: string }[];
      total: number;
    };
    assert.equal(grantListBody.total, 1);
    assert.equal(grantListBody.items[0]!.effect, 'DENY');
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
      managerToken,
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
        headers: { Authorization: `Bearer ${managerToken}` },
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
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${managerToken}` },
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
