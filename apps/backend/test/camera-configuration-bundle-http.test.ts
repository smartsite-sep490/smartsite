import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { AiConfigurationController } from '../src/integrations/ai/ai-configuration.controller.js';
import { CameraConfigurationService } from '../src/modules/cameras/camera-configuration.service.js';
import { ServiceAuthGuard } from '../src/modules/auth/service-auth.guard.js';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter.js';
import { conflict } from '../src/common/configuration/commands.js';
import { createTestConfig } from './support/config.js';

test('issued bundle HTTP authorizes before conditional reads and never treats caching as worker ACK', async () => {
  const cameraId = randomUUID(),
    other = randomUUID(),
    token = 'synthetic-bundle-service-token';
  const content = {
    schemaVersion: '1.0.0',
    cameraId,
    cameraExternalId: 'SYNTHETIC',
    configurationVersion: 3,
    viewRevision: 2,
    issuedAt: '2026-10-27T00:00:00.000Z',
    regions: [],
  };
  const bundle = { ...content, bundleSha256: computeCanonicalPayloadHash(content) };
  let reads = 0,
    unavailable = false;
  const module = await Test.createTestingModule({
    controllers: [AiConfigurationController],
    providers: [
      ServiceAuthGuard,
      {
        provide: ConfigService,
        useValue: createTestConfig({
          SMARTSITE_AI_SERVICE_TOKEN: token,
          AI_CONFIGURATION_CAMERA_IDS: cameraId,
        }),
      },
      {
        provide: CameraConfigurationService,
        useValue: {
          async readConfigurationBundleForCamera(id: string) {
            assert.equal(id.toLowerCase(), cameraId);
            reads++;
            if (unavailable) conflict('Issued camera configuration is unavailable');
            return bundle;
          },
          async buildConfigurationForCamera() {
            return {
              schemaVersion: '1.0.0',
              configurationVersion: 3,
              cameraExternalId: 'SYNTHETIC',
              regions: [],
            };
          },
        },
      },
    ],
  }).compile();
  const app = module.createNestApplication<NestExpressApplication>({ logger: false });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new HttpExceptionFilter());
  try {
    await app.listen(0, '127.0.0.1');
    const base = `${await app.getUrl()}/api/v1/integrations/ai/cameras`;
    const url = `${base}/${cameraId}/configuration-bundle`;
    const get = (credential = token, match?: string) =>
      fetch(url, {
        headers: {
          Authorization: `Bearer ${credential}`,
          ...(match ? { 'If-None-Match': match } : {}),
        },
      });
    for (const credential of ['', 'human-session-jwt', 'wrong-service-token']) {
      assert.equal((await get(credential, '*')).status, 401);
    }
    for (const id of [other, 'not-a-uuid'])
      assert.equal(
        (
          await fetch(`${base}/${id}/configuration-bundle`, {
            headers: { Authorization: `Bearer ${token}`, 'If-None-Match': '*' },
          })
        ).status,
        404,
      );
    assert.equal(reads, 0);
    const response = await get();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), bundle);
    const etag = `"sha256:${bundle.bundleSha256}"`;
    assert.equal(response.headers.get('etag'), etag);
    for (const match of [etag, `W/${etag}`, '*']) {
      const cached = await get(token, match);
      assert.equal(cached.status, 304);
      assert.equal(await cached.text(), '');
      assert.equal(cached.headers.get('cache-control'), 'no-store');
    }
    assert.equal(reads, 4);
    unavailable = true;
    assert.equal((await get(token, etag)).status, 409);
    assert.equal((await get(token, '*')).status, 409);
    assert.equal(reads, 6);
    const legacy = await fetch(`${base}/${cameraId}/configuration`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(legacy.status, 200);
    assert.equal(((await legacy.json()) as { schemaVersion: string }).schemaVersion, '1.0.0');
  } finally {
    await app.close();
  }
});
