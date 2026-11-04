import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
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

test('media HTTP authenticates before streaming and drains a large frame without queuing another image', async (t) => {
  const siteId = '11111111-1111-4111-8111-111111111111';
  const cameraId = '22222222-2222-4222-8222-222222222222';
  let calls = 0;
  // Transport fixture only: intentionally larger than the Node writable high-water mark.
  const frame = {
    type: 'media-frame',
    mediaVersion: 1,
    cameraExternalId: 'camera-a',
    sessionId: siteId,
    sequenceNumber: '1',
    capturedAt: new Date().toISOString(),
    width: 640,
    height: 360,
    imageDataUrl: 'data:image/jpeg;base64,/9j/' + 'A'.repeat(80000),
  };
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
          frame.capturedAt = new Date().toISOString();
          return new Response(JSON.stringify(frame) + '\n', {
            headers: { 'content-type': 'application/x-ndjson' },
          });
        },
      },
    ],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  app.setGlobalPrefix('api/v1');
  app.use(requestIdMiddleware);
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.listen(0, '127.0.0.1');
  t.after(() => app.close());
  const url = (await app.getUrl()) + `/api/v1/sites/${siteId}/cameras/${cameraId}/video-stream`;
  const headers = { Authorization: 'Bearer valid.session.signature' };
  assert.equal((await fetch(url)).status, 401);
  assert.equal(
    (await fetch(url, { headers: { Authorization: 'Bearer bad.session.signature' } })).status,
    401,
  );
  assert.equal((await fetch(url.replace(siteId, cameraId), { headers })).status, 403);
  assert.equal((await fetch(url + '?source=http://private.invalid', { headers })).status, 400);
  assert.equal(calls, 0);
  const response = await fetch(url, { headers: { ...headers, 'X-Request-ID': siteId } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('content-type'), 'application/x-ndjson');
  assert.equal(response.headers.get('x-request-id'), siteId);
  assert.deepEqual(JSON.parse((await response.text()).trim()), frame);
  assert.equal(calls, 1);
});
