import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource } from 'typeorm';
import { PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import { AppModule } from '../../src/app.module.js';
import { configureApplication } from '../../src/configure-app.js';
import { validateEnvironment, type BackendEnvironment } from '../../src/config/environment.js';
import { createLoggerParams } from '../../src/observability/logger.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { UserRole } from '../../src/database/entities/user.entity.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { provisionCameraWorkerGeneration } from '../../src/modules/cameras/camera-worker-generations.js';
import {
  CameraConfigurationReferenceEntity,
  CameraViewRevisionEntity,
} from '../../src/database/entities/camera-configuration-reference.entity.js';

const database = createIsolatedTestDatabase({ canonical: true });
before(() => database.initialize());
after(() => database.dispose());

test('software-only AppModule supports Site, scoped Zone and Camera metadata without any AI calls', async () => {
  const suffix = randomUUID().slice(0, 8);
  const fixturePassword = 'SyntheticFixture123!';
  await new UsersService(
    database.dataSource,
    new SiteConfigurationService(database.dataSource),
  ).create({
    username: `software-admin-${suffix}`,
    displayName: 'Synthetic software Admin',
    temporaryPassword: fixturePassword,
    roleAssignments: [{ role: UserRole.ADMIN, siteId: null }],
  });
  const environment = validateEnvironment({
    NODE_ENV: 'test',
    DATABASE_URL: process.env.TEST_DATABASE_URL,
    LOG_FORMAT: 'json',
    SMARTSITE_AI_SERVICE_TOKEN: 'synthetic-unused-service-token-only',
    MF06_ENQUEUE_ENABLED: 'false',
    MF06_ASSESSMENT_READ_ENABLED: 'false',
    CORS_ORIGINS: 'http://localhost:5181',
    STORAGE_LOCAL_ROOT: join(tmpdir(), 'smartsite-software-http-unused-media'),
  });
  assert.equal(environment.MF06_ENQUEUE_ENABLED, false);
  assert.equal(environment.MF06_ASSESSMENT_READ_ENABLED, false);
  assert.deepEqual(environment.SMARTSITE_AI_PREVIEW_SOURCES, {});
  assert.equal(environment.SMARTSITE_AI_IDENTITY_URL, undefined);
  const config = new ConfigService<BackendEnvironment, true>(environment);
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ConfigService)
    .useValue(config)
    .overrideProvider(PARAMS_PROVIDER_TOKEN)
    .useValue(createLoggerParams(config, { write: () => undefined }))
    .overrideProvider(getDataSourceToken())
    .useValue(database.dataSource)
    .overrideProvider(DataSource)
    .useValue(database.dataSource)
    .compile();
  const app = module.createNestApplication<NestExpressApplication>({
    logger: false,
    bodyParser: false,
  });
  try {
    await configureApplication(app);
    await app.listen(0, '127.0.0.1');
    const documentation = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Synthetic reference-command test').build(),
    );
    assert(
      documentation.paths['/api/v1/sites/{siteId}/cameras/{cameraId}/reference-regions']?.post,
    );
    assert(
      documentation.paths[
        '/api/v1/sites/{siteId}/cameras/{cameraId}/regions/{regionId}/reference-polygon'
      ]?.patch,
    );
    const confirmationSchema = documentation.components?.schemas?.ReferenceRegionResponseDto;
    assert(confirmationSchema && 'required' in confirmationSchema);
    assert(confirmationSchema.required?.includes('geometryConfirmation'));
    const url = await app.getUrl();
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/);
    const request = (method: string, path: string, body?: unknown, token?: string) =>
      fetch(`${url}/api/v1${path}`, {
        method,
        signal: AbortSignal.timeout(5000),
        headers: {
          Origin: 'http://localhost:5181',
          'X-Request-Id': 'software-metadata-fixture',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    const anonymous = await request('GET', '/sites');
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(anonymous.headers.get('x-request-id'), 'software-metadata-fixture');
    assert.equal(anonymous.headers.get('access-control-allow-origin'), 'http://localhost:5181');
    await anonymous.json();
    const adminLogin = await request('POST', '/auth/login', {
      username: `software-admin-${suffix}`,
      password: fixturePassword,
      clientType: 'MOBILE',
    });
    assert.equal(adminLogin.status, 200);
    const admin = (await adminLogin.json()) as { accessToken: string; refreshToken: string };
    const siteResponse = await request(
      'POST',
      '/sites',
      { code: `HTTP-SITE-${suffix}`, name: 'Công trường thử nghiệm' },
      admin.accessToken,
    );
    assert.equal(siteResponse.status, 201);
    const site = (await siteResponse.json()) as { id: string; name: string };
    assert.equal(site.name, 'Công trường thử nghiệm');
    const managerResponse = await request(
      'POST',
      '/users',
      {
        username: `software-manager-${suffix}`,
        displayName: 'Synthetic Manager',
        temporaryPassword: fixturePassword,
        roleAssignments: [{ role: 'SITE_MANAGER', siteId: site.id }],
      },
      admin.accessToken,
    );
    assert.equal(managerResponse.status, 201);
    await managerResponse.json();
    const managerLogin = await request('POST', '/auth/login', {
      username: `software-manager-${suffix}`,
      password: fixturePassword,
      clientType: 'MOBILE',
    });
    assert.equal(managerLogin.status, 200);
    const manager = (await managerLogin.json()) as { accessToken: string; refreshToken: string };
    const zoneInput = {
      code: `HTTP-ZONE-${suffix}`,
      name: 'Khu vực bảo hộ',
      type: 'STANDARD',
      restrictionPolicy: 'NONE',
      requiredPpe: ['HARD_HAT', 'GLOVES'],
    };
    const adminZone = await request(
      'POST',
      `/sites/${site.id}/zones`,
      zoneInput,
      admin.accessToken,
    );
    assert.equal(adminZone.status, 403);
    await adminZone.json();
    const wrongSite = await request(
      'POST',
      `/sites/${randomUUID()}/zones`,
      zoneInput,
      manager.accessToken,
    );
    assert.equal(wrongSite.status, 403);
    await wrongSite.json();
    const zoneResponse = await request(
      'POST',
      `/sites/${site.id}/zones`,
      zoneInput,
      manager.accessToken,
    );
    assert.equal(zoneResponse.status, 201);
    const zone = (await zoneResponse.json()) as {
      id: string;
      siteId: string;
      requiredPpe: string[];
      code: string;
      restrictionPolicy: string;
    };
    assert.equal(zone.siteId, site.id);
    assert.deepEqual(zone.requiredPpe, [...zoneInput.requiredPpe].sort());
    const renamedZone = await request(
      'PATCH',
      `/sites/${site.id}/zones/${zone.id}`,
      { name: 'Khu vực đã đổi tên' },
      manager.accessToken,
    );
    assert.equal(renamedZone.status, 200);
    const renamed = (await renamedZone.json()) as typeof zone & { name: string };
    assert.equal(renamed.id, zone.id);
    assert.equal(renamed.name, 'Khu vực đã đổi tên');
    assert.equal(renamed.code, zone.code);
    assert.equal(renamed.restrictionPolicy, zone.restrictionPolicy);
    assert.deepEqual(renamed.requiredPpe, zone.requiredPpe);
    const cameraInput = {
      code: `HTTP-CAM-${suffix}`,
      externalId: `SYNTHETIC-NO-CAPTURE-${suffix}`,
      name: 'Camera cấu hình',
    };
    const adminCamera = await request(
      'POST',
      `/sites/${site.id}/cameras`,
      cameraInput,
      admin.accessToken,
    );
    assert.equal(adminCamera.status, 403);
    await adminCamera.json();
    const cameraResponse = await request(
      'POST',
      `/sites/${site.id}/cameras`,
      cameraInput,
      manager.accessToken,
    );
    assert.equal(cameraResponse.status, 201);
    const camera = (await cameraResponse.json()) as {
      id: string;
      siteId: string;
      configurationVersion: number;
      externalId: string;
    };
    assert.equal(camera.siteId, site.id);
    assert.equal(camera.externalId, cameraInput.externalId);
    const regionPath = `/sites/${site.id}/cameras/${camera.id}/regions`;
    const polygon = {
      coordinates: [
        [0.05, 0.05],
        [0.95, 0.05],
        [0.95, 0.95],
        [0.05, 0.95],
      ],
    };
    const regionResponse = await request(
      'POST',
      regionPath,
      { zoneId: zone.id, expectedConfigurationVersion: camera.configurationVersion, polygon },
      manager.accessToken,
    );
    assert.equal(regionResponse.status, 201);
    const mutation = (await regionResponse.json()) as {
      region: { id: string; cameraId: string; zoneId: string; polygon: unknown };
      configurationVersion: number;
    };
    assert.equal(mutation.region.cameraId, camera.id);
    assert.equal(mutation.region.zoneId, zone.id);
    assert.deepEqual(mutation.region.polygon, polygon);
    assert.equal(mutation.configurationVersion, camera.configurationVersion + 1);
    const staleRegion = await request(
      'POST',
      regionPath,
      { zoneId: zone.id, expectedConfigurationVersion: camera.configurationVersion, polygon },
      manager.accessToken,
    );
    assert.equal(staleRegion.status, 409);
    await staleRegion.json();
    const invalidCamera = await request(
      'PATCH',
      `/sites/${site.id}/cameras/${camera.id}`,
      { name: 'No policy mutation', status: 'INACTIVE' },
      manager.accessToken,
    );
    assert.equal(invalidCamera.status, 400);
    await invalidCamera.json();
    const cameraList = await request(
      'GET',
      `/sites/${site.id}/cameras?offset=0&limit=1`,
      undefined,
      admin.accessToken,
    );
    assert.equal(cameraList.status, 200);
    const cameras = (await cameraList.json()) as {
      items: Array<{ id: string; configurationVersion: number }>;
      total: number;
    };
    assert.equal(cameras.total, 1);
    assert.equal(cameras.items[0]?.id, camera.id);
    assert.equal(cameras.items[0]?.configurationVersion, mutation.configurationVersion);
    const regionList = await request(
      'GET',
      `${regionPath}?offset=0&limit=1`,
      undefined,
      admin.accessToken,
    );
    assert.equal(regionList.status, 200);
    const regions = (await regionList.json()) as {
      items: Array<{ id: string; geometryConfirmation: unknown }>;
      total: number;
    };
    assert.equal(regions.total, 1);
    assert.equal(regions.items[0]?.id, mutation.region.id);
    const unconfirmed = {
      status: 'UNCONFIRMED',
      referenceId: null,
      viewRevision: null,
      confirmedByUserId: null,
      confirmedAt: null,
    };
    assert.deepEqual(regions.items[0]?.geometryConfirmation, unconfirmed);
    const reopened = await request(
      'GET',
      `${regionPath}/${mutation.region.id}`,
      undefined,
      admin.accessToken,
    );
    assert.equal(reopened.status, 200);
    assert.deepEqual(
      ((await reopened.json()) as { geometryConfirmation: unknown }).geometryConfirmation,
      unconfirmed,
    );
    const [{ id: managerId }] = await database.dataSource.query(
      'SELECT id FROM app_user WHERE username=$1',
      [`software-manager-${suffix}`],
    );
    const sessionId = randomUUID();
    await database.dataSource.getRepository(CameraViewRevisionEntity).insert({
      cameraId: camera.id,
      revision: '1',
      siteId: site.id,
      sessionId,
      sourceKind: 'LIVE',
      width: 120,
      height: 80,
      viewValidity: 'UNCONFIRMED',
      isCurrent: true,
      createdAt: new Date(),
      retiredAt: null,
    });
    const referenceBody = async (version: number) => {
      const [{ now }] = await database.dataSource.query('SELECT clock_timestamp() AS now');
      const referenceId = randomUUID();
      await database.dataSource.getRepository(CameraConfigurationReferenceEntity).insert({
        id: referenceId,
        cameraId: camera.id,
        siteId: site.id,
        viewRevision: '1',
        sessionId,
        sourceKind: 'LIVE',
        width: 120,
        height: 80,
        imageSha256: 'a'.repeat(64),
        configurationVersion: String(version),
        capturedAt: now,
        issuedAt: now,
        expiresAt: new Date(now.getTime() + 300_000),
        issuedByUserId: managerId,
      });
      return {
        expectedConfigurationVersion: version,
        referenceId,
        viewRevision: 1,
        confirmReferenceView: true,
        polygon,
      };
    };
    const referencePath = `/sites/${site.id}/cameras/${camera.id}/reference-regions`;
    const createInput = {
      zoneId: zone.id,
      ...(await referenceBody(mutation.configurationVersion)),
    };
    assert.equal((await request('POST', referencePath, createInput)).status, 401);
    assert.equal(
      (await request('POST', referencePath, createInput, admin.accessToken)).status,
      403,
    );
    const referenceCreate = await request('POST', referencePath, createInput, manager.accessToken);
    assert.equal(referenceCreate.status, 201);
    const referenceMutation = (await referenceCreate.json()) as {
      region: {
        id: string;
        version: number;
        geometryConfirmation: {
          status: string;
          referenceId: string;
          viewRevision: number;
          confirmedByUserId: string;
          confirmedAt: string;
        };
      };
      configurationVersion: number;
    };
    assert.equal(referenceMutation.region.geometryConfirmation.status, 'MANUALLY_CONFIRMED');
    assert.equal(
      referenceMutation.region.geometryConfirmation.referenceId,
      createInput.referenceId,
    );
    assert.equal(referenceMutation.region.geometryConfirmation.confirmedByUserId, managerId);
    const patchPath = `${regionPath}/${referenceMutation.region.id}/reference-polygon`;
    const patchInput = await referenceBody(referenceMutation.configurationVersion);
    assert.equal(
      (
        await request(
          'PATCH',
          patchPath,
          { ...patchInput, confirmedByUserId: managerId },
          manager.accessToken,
        )
      ).status,
      400,
    );
    const referenceUpdate = await request('PATCH', patchPath, patchInput, manager.accessToken);
    assert.equal(referenceUpdate.status, 200);
    const updated = (await referenceUpdate.json()) as typeof referenceMutation;
    assert.equal(updated.region.version, 2);
    assert.equal(updated.configurationVersion, referenceMutation.configurationVersion + 1);
    assert.equal(updated.region.geometryConfirmation.referenceId, patchInput.referenceId);
    const reread = await request(
      'GET',
      `${regionPath}/${updated.region.id}`,
      undefined,
      manager.accessToken,
    );
    assert.equal(reread.status, 200);
    assert.deepEqual(
      ((await reread.json()) as { geometryConfirmation: unknown }).geometryConfirmation,
      updated.region.geometryConfirmation,
    );
    assert.equal((await request('PATCH', patchPath, patchInput, manager.accessToken)).status, 409);
    const bundlePath = `/integrations/ai/cameras/${camera.id}/configuration-bundle`;
    assert(
      documentation.paths['/api/v1/integrations/ai/cameras/{cameraId}/configuration-bundle']?.get,
    );
    assert.equal((await request('GET', bundlePath, undefined, manager.accessToken)).status, 401);
    const serviceToken = environment.SMARTSITE_AI_SERVICE_TOKEN;
    assert.equal((await request('GET', bundlePath, undefined, serviceToken)).status, 404);
    environment.AI_CONFIGURATION_CAMERA_IDS.push(camera.id);
    assert.equal((await request('GET', bundlePath, undefined, serviceToken)).status, 409);
    const confirmedOriginal = await request(
      'PATCH',
      `${regionPath}/${mutation.region.id}/reference-polygon`,
      await referenceBody(updated.configurationVersion),
      manager.accessToken,
    );
    assert.equal(confirmedOriginal.status, 200);
    const latest = (await confirmedOriginal.json()) as { configurationVersion: number };
    const bundleResponse = await request('GET', bundlePath, undefined, serviceToken);
    assert.equal(bundleResponse.status, 200);
    assert.equal(bundleResponse.headers.get('cache-control'), 'no-store');
    const bundle = (await bundleResponse.json()) as {
      configurationVersion: number;
      bundleSha256: string;
      viewRevision: number;
      regions: unknown[];
    };
    assert.equal(bundle.configurationVersion, latest.configurationVersion);
    assert.equal(bundle.regions.length, 2);
    const etag = bundleResponse.headers.get('etag')!;
    assert.equal(etag, `"sha256:${bundle.bundleSha256}"`);
    const cached = () =>
      fetch(`${url}/api/v1${bundlePath}`, {
        headers: { Authorization: `Bearer ${serviceToken}`, 'If-None-Match': etag },
      });
    assert.equal((await cached()).status, 304);
    const applicationStatusPath = `/sites/${site.id}/cameras/${camera.id}/application-status`;
    assert.equal((await request('GET', applicationStatusPath)).status, 401);
    assert.equal(
      (await request('GET', applicationStatusPath, undefined, admin.accessToken)).status,
      200,
    );
    assert.equal(
      (
        await request(
          'GET',
          applicationStatusPath + '?maxAgeMs=3600000',
          undefined,
          manager.accessToken,
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await request(
          'GET',
          `/sites/${randomUUID()}/cameras/${camera.id}/application-status`,
          undefined,
          manager.accessToken,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await request(
          'GET',
          `/sites/${site.id}/cameras/${randomUUID()}/application-status`,
          undefined,
          manager.accessToken,
        )
      ).status,
      404,
    );
    const unconfirmedStatus = await request(
      'GET',
      applicationStatusPath,
      undefined,
      manager.accessToken,
    );
    assert.equal(unconfirmedStatus.status, 200);
    assert.equal(
      ((await unconfirmedStatus.json()) as { applicationState: string }).applicationState,
      'UNCONFIRMED',
    );
    const generation = await provisionCameraWorkerGeneration(
      database.dataSource,
      camera.id,
      environment.AI_CONFIGURATION_CAMERA_IDS,
      60000,
    );
    const ackBody = {
      commandId: randomUUID(),
      workerGenerationId: generation.workerGenerationId,
      streamSessionId: generation.streamSessionId,
      configurationVersion: bundle.configurationVersion,
      bundleSha256: bundle.bundleSha256,
      viewRevision: bundle.viewRevision,
      outcome: 'LOADED',
    };
    const acknowledge = () =>
      fetch(`${url}/api/v1/integrations/ai/cameras/${camera.id}/configuration-ack`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${serviceToken}`,
          'Content-Type': 'application/json',
          'x-worker-generation-secret': generation.secret,
        },
        body: JSON.stringify(ackBody),
      });
    const receipt = await acknowledge();
    assert.equal(receipt.status, 200);
    assert.equal(receipt.headers.get('cache-control'), 'no-store');
    assert.equal(((await receipt.json()) as { replayed: boolean }).replayed, false);
    const applicationStatus = await request(
      'GET',
      applicationStatusPath,
      undefined,
      manager.accessToken,
    );
    assert.equal(applicationStatus.status, 200);
    assert.equal(applicationStatus.headers.get('cache-control'), 'no-store');
    const application = (await applicationStatus.json()) as {
      applicationState: string;
      viewValidity: string;
    };
    assert.equal(application.applicationState, 'LOADED');
    assert.equal(application.viewValidity, 'UNCONFIRMED');
    assert.equal(
      (await request('GET', applicationStatusPath, undefined, serviceToken)).status,
      401,
    );
    const replay = await acknowledge();
    assert.equal(replay.status, 200);
    assert.equal(((await replay.json()) as { replayed: boolean }).replayed, true);
    assert.equal(
      Number(
        (
          await database.dataSource.query(
            'SELECT count(*) AS count FROM camera_configuration_application_receipt WHERE camera_id=$1',
            [camera.id],
          )
        )[0].count,
      ),
      1,
    );
    const inactive = await request(
      'PATCH',
      `/sites/${site.id}/cameras/${camera.id}/status`,
      { expectedConfigurationVersion: latest.configurationVersion, status: 'INACTIVE' },
      manager.accessToken,
    );
    assert.equal(inactive.status, 200);
    assert.equal((await cached()).status, 409);
    assert.equal((await acknowledge()).status, 409);
    const inactiveApplicationStatus = await request(
      'GET',
      applicationStatusPath,
      undefined,
      manager.accessToken,
    );
    assert.equal(inactiveApplicationStatus.status, 200);
    assert.equal(
      ((await inactiveApplicationStatus.json()) as { applicationState: string }).applicationState,
      'STALE',
    );
    const logout = await request('POST', '/auth/logout', {
      clientType: 'MOBILE',
      refreshToken: manager.refreshToken,
    });
    assert.equal(logout.status, 204);
    const revoked = await request('GET', `/sites/${site.id}/zones`, undefined, manager.accessToken);
    assert.equal(revoked.status, 401);
    await revoked.json();
  } finally {
    await app.close();
  }
});
