import 'reflect-metadata';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { AdminGuard, UserAuthGuard } from '../src/modules/auth/user-auth.guard.js';
import { CameraConfigurationService } from '../src/modules/cameras/camera-configuration.service.js';
import { CameraConfigurationImageService } from '../src/modules/cameras/camera-configuration-image.service.js';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter.js';
import { requestIdMiddleware } from '../src/common/http/request-id.js';
import { createTestConfig } from './support/config.js';

const siteId = '11111111-1111-4111-8111-111111111111';
const cameraId = '22222222-2222-4222-8222-222222222222';
const otherId = '99999999-9999-4999-8999-999999999999';
const jpeg = Buffer.from([
  255, 216, 255, 192, 0, 17, 8, 0, 80, 0, 120, 3, 1, 17, 0, 2, 17, 0, 3, 17, 0, 255, 217,
]);

test('configuration-image HTTP uses real auth/Admin/throttle guards and rejects source substitution before upstream', async (t) => {
  const { CameraConfigurationImageController } = await import(
    new URL('../src/modules/cameras/camera-configuration-image.controller.js', import.meta.url).href
  );
  let sourceReads = 0;
  let role = 'ADMIN';
  let mustChangePassword = false;
  const source = createServer((request, response) => {
    sourceReads++;
    assert.equal(request.url, '/v1/realtime/configuration-image?cameraExternalId=camera-a');
    assert.equal(request.headers.authorization, 'Bearer smartsite_local_dev_service_token_only');
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify({
        schemaVersion: 1,
        purpose: 'REGION_CONFIGURATION',
        sourceKind: 'LIVE',
        frame: {
          cameraExternalId: 'camera-a',
          sessionId: siteId,
          sequenceNumber: '1',
          capturedAt: new Date().toISOString(),
          width: 120,
          height: 80,
          imageDataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
          imageSha256: createHash('sha256').update(jpeg).digest('hex'),
        },
      }),
    );
  });
  source.listen(0, '127.0.0.1');
  await once(source, 'listening');
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        source.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const sourceOrigin = `http://127.0.0.1:${(source.address() as { port: number }).port}`;
  const module = await Test.createTestingModule({
    imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }])],
    controllers: [CameraConfigurationImageController],
    providers: [
      CameraConfigurationImageService,
      UserAuthGuard,
      AdminGuard,
      { provide: APP_GUARD, useClass: ThrottlerGuard },
      {
        provide: ConfigService,
        useValue: createTestConfig({
          SMARTSITE_AI_PREVIEW_SOURCES: JSON.stringify({ 'camera-a': sourceOrigin }),
        }),
      },
      {
        provide: AuthService,
        useValue: {
          async authenticate(token: string) {
            if (token !== 'valid.session.signature') throw new UnauthorizedException();
            return {
              user: {
                isActive: true,
                mustChangePassword,
                roleAssignments: [{ role, siteId: role === 'ADMIN' ? null : siteId }],
              },
            };
          },
        },
      },
      {
        provide: CameraConfigurationService,
        useValue: {
          async get() {
            return {
              id: cameraId,
              siteId,
              externalId: 'camera-a',
              status: 'ACTIVE',
              configurationVersion: 4,
            };
          },
        },
      },
    ],
  }).compile();
  const app = module.createNestApplication<NestExpressApplication>({ logger: false });
  app.setGlobalPrefix('api/v1');
  app.use(requestIdMiddleware);
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close());
  const path = `${await app.getUrl()}/api/v1/sites/${siteId}/cameras/${cameraId}/configuration-image`;
  const headers = {
    Authorization: 'Bearer valid.session.signature',
    'X-Request-Id': 'configuration-image-http-1',
  };
  assert.equal((await fetch(path)).status, 401);
  assert.equal(
    (await fetch(path, { headers: { Authorization: 'Bearer bad.session.signature' } })).status,
    401,
  );
  for (role of ['SAFETY_OFFICER', 'SITE_MANAGER'])
    assert.equal((await fetch(path, { headers })).status, 403);
  role = 'ADMIN';
  mustChangePassword = true;
  assert.equal((await fetch(path, { headers })).status, 403);
  mustChangePassword = false;
  assert.equal((await fetch(path + '?sourceUrl=http://private.invalid', { headers })).status, 400);
  assert.equal((await fetch(path.replace(siteId, otherId), { headers })).status, 404);
  assert.equal((await fetch(path.replace(cameraId, 'invalid-id'), { headers })).status, 400);
  assert.equal(sourceReads, 0);
  const response = await fetch(path, { headers });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-request-id'), headers['X-Request-Id']);
  const image = await response.json();
  assert.equal(image.configurationVersion, 4);
  assert.equal(image.frame.imageSha256, createHash('sha256').update(jpeg).digest('hex'));
  assert.equal(sourceReads, 1);
  assert.equal(JSON.stringify(image).includes('smartsite_local_dev_service_token_only'), false);
  // This fixture bucket verifies the actual global guard, not capacity or production limits.
  const statuses = [];
  for (let i = 0; i < 100; i++)
    statuses.push((await fetch(path + '?forbidden=1', { headers })).status);
  assert.ok(statuses.includes(429));
  assert.equal(sourceReads, 1);
});
