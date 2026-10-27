import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { CameraPreviewController } from '../src/modules/cameras/camera-preview.controller.js';
import {
  CAMERA_PREVIEW_FETCH,
  CameraPreviewService,
} from '../src/modules/cameras/camera-preview.service.js';
import { CameraConfigurationService } from '../src/modules/cameras/camera-configuration.service.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { UserAuthGuard } from '../src/modules/auth/user-auth.guard.js';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter.js';
import { requestIdMiddleware } from '../src/common/http/request-id.js';
import { createTestConfig } from './support/config.js';

test('preview HTTP retains user authentication and rejects cross-site or client source substitution', async (t) => {
  const siteId = '11111111-1111-4111-8111-111111111111';
  const cameraId = '22222222-2222-4222-8222-222222222222';
  let calls = 0;
  const module = await Test.createTestingModule({
    controllers: [CameraPreviewController],
    providers: [
      CameraPreviewService,
      UserAuthGuard,
      {
        provide: ConfigService,
        useValue: createTestConfig({
          SMARTSITE_AI_PREVIEW_SOURCES: '{"camera-a":"http://127.0.0.1:8001"}',
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
                mustChangePassword: false,
                roleAssignments: [{ role: 'SAFETY_OFFICER', siteId }],
              },
            };
          },
        },
      },
      {
        provide: CameraConfigurationService,
        useValue: {
          async get() {
            return { id: cameraId, siteId, externalId: 'camera-a', status: 'ACTIVE' };
          },
        },
      },
      {
        provide: CAMERA_PREVIEW_FETCH,
        useValue: async () => {
          calls++;
          return Response.json({
            sourceKind: 'LIVE',
            frame: {
              type: 'frame',
              previewVersion: 1,
              cameraExternalId: 'camera-a',
              sessionId: siteId,
              sequenceNumber: '1',
              capturedAt: new Date().toISOString(),
              width: 640,
              height: 480,
              imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
              detections: [],
              zoneDetections: [],
              zonePolygons: [],
            },
          });
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
  const origin = await app.getUrl();
  const path = `/api/v1/sites/${siteId}/cameras/${cameraId}/preview`;
  const headers = { Authorization: 'Bearer valid.session.signature' };
  assert.equal((await fetch(origin + path)).status, 401);
  assert.equal(
    (await fetch(origin + path, { headers: { Authorization: 'Bearer bad.session.signature' } }))
      .status,
    401,
  );
  assert.equal((await fetch(origin + path.replace(siteId, cameraId), { headers })).status, 403);
  const substituted = await fetch(origin + path + '?upstreamUrl=http://private.invalid', {
    headers,
  });
  assert.equal(substituted.status, 400);
  assert.equal(calls, 0);
  const allowed = await fetch(origin + path, { headers });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get('cache-control'), 'no-store');
  const body = await allowed.json();
  assert.equal(body.cameraExternalId, 'camera-a');
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(body).includes('smartsite_local_dev_service_token_only'), false);
});

test('real HTTP upstreams keep two camera sources isolated and do not expose service credentials', async (t) => {
  const siteId = '11111111-1111-4111-8111-111111111111';
  const a = '22222222-2222-4222-8222-222222222222';
  const b = '33333333-3333-4333-8333-333333333333';
  let upstreamReads = 0;
  const origins: Record<string, string> = {};
  for (const externalId of ['camera-a', 'camera-b']) {
    const source = createServer((request, response) => {
      upstreamReads++;
      assert.equal(request.headers.authorization, 'Bearer smartsite_local_dev_service_token_only');
      assert.equal(request.url, `/v1/realtime/preview/latest?cameraExternalId=${externalId}`);
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          sourceKind: externalId === 'camera-a' ? 'LIVE' : 'REPLAY',
          frame: {
            type: 'frame',
            previewVersion: 1,
            cameraExternalId: externalId,
            sessionId: siteId,
            sequenceNumber: '1',
            capturedAt: new Date().toISOString(),
            width: 640,
            height: 480,
            imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
            detections: [],
            zoneDetections: [],
            zonePolygons: [],
          },
        }),
      );
    });
    source.listen(0, '127.0.0.1');
    await once(source, 'listening');
    origins[externalId] = `http://127.0.0.1:${(source.address() as { port: number }).port}`;
    t.after(
      () =>
        new Promise<void>((resolve, reject) =>
          source.close((error) => (error ? reject(error) : resolve())),
        ),
    );
  }
  const module = await Test.createTestingModule({
    controllers: [CameraPreviewController],
    providers: [
      CameraPreviewService,
      UserAuthGuard,
      {
        provide: ConfigService,
        useValue: createTestConfig({ SMARTSITE_AI_PREVIEW_SOURCES: JSON.stringify(origins) }),
      },
      {
        provide: AuthService,
        useValue: {
          async authenticate(token: string) {
            if (token !== 'valid.session.signature') throw new UnauthorizedException();
            return {
              user: {
                mustChangePassword: false,
                roleAssignments: [{ role: 'SAFETY_OFFICER', siteId }],
              },
            };
          },
        },
      },
      {
        provide: CameraConfigurationService,
        useValue: {
          async get(site: string, id: string) {
            return {
              id,
              siteId: site,
              externalId: id === a ? 'camera-a' : 'camera-b',
              status: 'ACTIVE',
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
  const origin = await app.getUrl();
  const headers = { Authorization: 'Bearer valid.session.signature' };
  const path = (id: string) => `${origin}/api/v1/sites/${siteId}/cameras/${id}/preview`;
  const [ra, rb] = await Promise.all([fetch(path(a), { headers }), fetch(path(b), { headers })]);
  assert.equal(ra.status, 200);
  assert.equal(rb.status, 200);
  const [fa, fb] = await Promise.all([ra.json(), rb.json()]);
  assert.equal(fa.cameraId, a);
  assert.equal(fa.frame.cameraExternalId, 'camera-a');
  assert.equal(fa.sourceKind, 'LIVE');
  assert.equal(fb.cameraId, b);
  assert.equal(fb.frame.cameraExternalId, 'camera-b');
  assert.equal(fb.sourceKind, 'REPLAY');
  assert.equal(upstreamReads, 2);
  assert.equal(JSON.stringify([fa, fb]).includes('smartsite_local_dev_service_token_only'), false);
});
