import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
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

const database = createIsolatedTestDatabase({ canonical: true });
before(() => database.initialize());
after(() => database.dispose());

test('full AppModule configuration image works before any Region and withholds pixels after real session logout', async () => {
  assert.equal(database.dataSource.migrations.length, 58);
  assert.equal(await database.dataSource.showMigrations(), false);
  const suffix = randomUUID().slice(0, 8);
  const password = 'SyntheticFixture123!';
  const username = `configuration-image-${suffix}`;
  await new UsersService(
    database.dataSource,
    new SiteConfigurationService(database.dataSource),
  ).create({
    username,
    displayName: 'Synthetic configuration Admin',
    temporaryPassword: password,
    roleAssignments: [{ role: UserRole.ADMIN, siteId: null }],
  });
  const externalId = `configuration-image-${suffix}`;
  const serviceToken = 'synthetic-configuration-image-service-token-only';
  const jpeg = Buffer.from([
    255, 216, 255, 192, 0, 17, 8, 0, 80, 0, 120, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0, 255, 217,
  ]);
  const sha = createHash('sha256').update(jpeg).digest('hex');
  let sourceReads = 0;
  let hold = false;
  let entered!: () => void;
  let release!: () => void;
  const sourceEntered = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const source = createServer(async (request, response) => {
    sourceReads++;
    assert.equal(request.url, `/v1/realtime/configuration-image?cameraExternalId=${externalId}`);
    assert.equal(request.headers.authorization, `Bearer ${serviceToken}`);
    if (hold) {
      entered();
      await held;
    }
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify({
        schemaVersion: 1,
        purpose: 'REGION_CONFIGURATION',
        sourceKind: 'LIVE',
        frame: {
          cameraExternalId: externalId,
          sessionId: '11111111-1111-4111-8111-111111111111',
          sequenceNumber: String(sourceReads),
          capturedAt: new Date().toISOString(),
          width: 120,
          height: 80,
          imageDataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
          imageSha256: sha,
        },
      }),
    );
  });
  source.listen(0, '127.0.0.1');
  await once(source, 'listening');
  const sourceOrigin = `http://127.0.0.1:${(source.address() as { port: number }).port}`;
  let app: NestExpressApplication | undefined;
  try {
    const config = new ConfigService<BackendEnvironment, true>(
      validateEnvironment({
        NODE_ENV: 'test',
        DATABASE_URL: process.env.TEST_DATABASE_URL,
        LOG_FORMAT: 'json',
        SMARTSITE_AI_SERVICE_TOKEN: serviceToken,
        SMARTSITE_AI_PREVIEW_SOURCES: JSON.stringify({ [externalId]: sourceOrigin }),
        MF06_ENQUEUE_ENABLED: 'false',
        MF06_ASSESSMENT_READ_ENABLED: 'false',
        CORS_ORIGINS: 'http://localhost:5181',
        STORAGE_LOCAL_ROOT: join(tmpdir(), 'smartsite-configuration-image-unused-media'),
      }),
    );
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
    app = module.createNestApplication<NestExpressApplication>({
      logger: false,
      bodyParser: false,
    });
    await configureApplication(app);
    await app.listen(0, '127.0.0.1');
    const origin = await app.getUrl();
    const request = (method: string, path: string, body?: unknown, token?: string) =>
      fetch(`${origin}/api/v1${path}`, {
        method,
        signal: AbortSignal.timeout(5000),
        headers: {
          Origin: 'http://localhost:5181',
          'X-Request-Id': 'configuration-image-integration',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const login = await request('POST', '/auth/login', {
      username,
      password,
      clientType: 'MOBILE',
    });
    assert.equal(login.status, 200);
    const session = (await login.json()) as { accessToken: string; refreshToken: string };
    const siteResponse = await request(
      'POST',
      '/sites',
      { code: `CFG-${suffix}`, name: 'Synthetic configuration Site' },
      session.accessToken,
    );
    assert.equal(siteResponse.status, 201);
    const site = (await siteResponse.json()) as { id: string };
    const cameraResponse = await request(
      'POST',
      `/sites/${site.id}/cameras`,
      { code: `CFG-${suffix}`, name: 'Synthetic source without Region', externalId },
      session.accessToken,
    );
    assert.equal(cameraResponse.status, 201);
    const camera = (await cameraResponse.json()) as { id: string; configurationVersion: number };
    const path = `/sites/${site.id}/cameras/${camera.id}/configuration-image`;
    assert.equal((await request('GET', path)).status, 401);
    assert.equal(
      (await request('GET', path + '?sourceUrl=forbidden', undefined, session.accessToken)).status,
      400,
    );
    assert.equal(sourceReads, 0);
    const imageResponse = await request('GET', path, undefined, session.accessToken);
    assert.equal(imageResponse.status, 200);
    assert.equal(imageResponse.headers.get('cache-control'), 'no-store');
    assert.equal(imageResponse.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(imageResponse.headers.get('x-request-id'), 'configuration-image-integration');
    assert.equal(imageResponse.headers.get('access-control-allow-origin'), 'http://localhost:5181');
    const image = await imageResponse.json();
    assert.equal(image.cameraId, camera.id);
    assert.equal(image.siteId, site.id);
    assert.equal(image.configurationVersion, camera.configurationVersion);
    assert.equal(image.frame.imageSha256, sha);
    assert.equal(JSON.stringify(image).includes(serviceToken), false);
    assert.equal(sourceReads, 1);
    const regions = await request(
      'GET',
      `/sites/${site.id}/cameras/${camera.id}/regions`,
      undefined,
      session.accessToken,
    );
    assert.equal(regions.status, 200);
    assert.equal((await regions.json()).total, 0);
    hold = true;
    const pending = request('GET', path, undefined, session.accessToken);
    await Promise.race([
      sourceEntered,
      pending.then(() => {
        throw new Error('Fixture source was not reached');
      }),
    ]);
    const logout = await request('POST', '/auth/logout', {
      clientType: 'MOBILE',
      refreshToken: session.refreshToken,
    });
    assert.equal(logout.status, 204);
    release();
    const denied = await pending;
    assert.equal(denied.status, 401);
    const deniedBody = await denied.text();
    assert.equal(deniedBody.includes('imageDataUrl'), false);
    assert.equal(deniedBody.includes(jpeg.toString('base64')), false);
    assert.equal((await request('GET', path, undefined, session.accessToken)).status, 401);
    assert.equal(sourceReads, 2);
  } finally {
    release();
    await app?.close();
    await new Promise<void>((resolve, reject) =>
      source.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
