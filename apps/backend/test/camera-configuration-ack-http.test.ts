import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { test } from 'node:test';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AiConfigurationController } from '../src/integrations/ai/ai-configuration.controller.js';
import { CameraConfigurationService } from '../src/modules/cameras/camera-configuration.service.js';
import { ServiceAuthGuard } from '../src/modules/auth/service-auth.guard.js';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter.js';
import { createTestConfig } from './support/config.js';

test('configuration ACK HTTP requires both service access and one generation credential', async () => {
  const cameraId = randomUUID(),
    token = 'synthetic-ack-service',
    secret = 'q'.repeat(43);
  const body = {
    commandId: randomUUID(),
    workerGenerationId: randomUUID(),
    streamSessionId: randomUUID(),
    configurationVersion: 1,
    bundleSha256: 'a'.repeat(64),
    viewRevision: 1,
    outcome: 'LOADED',
  };
  let calls = 0;
  const receipt = {
    commandId: body.commandId,
    configurationVersion: 1,
    outcome: 'LOADED',
    receivedAt: '2026-10-27T00:00:00.000Z',
    replayed: false,
  };
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
          async acknowledgeConfigurationForCamera(id: string, credential: string, input: unknown) {
            assert.equal(id, cameraId);
            assert.equal(credential, secret);
            assert.deepEqual(input, body);
            calls++;
            return receipt;
          },
        },
      },
    ],
  }).compile();
  const app = module.createNestApplication<NestExpressApplication>();
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.listen(0, '127.0.0.1');
  try {
    const base = await app.getUrl(),
      url = `${base}/api/v1/integrations/ai/cameras/${cameraId}/configuration-ack`;
    const send = (headers: Record<string, string>, value: unknown = body, target = url) =>
      fetch(target, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(value),
      });
    assert.equal((await send({})).status, 401);
    assert.equal((await send({ authorization: 'Bearer wrong' })).status, 401);
    const bearer = { authorization: `Bearer ${token}` };
    assert.equal((await send(bearer, body, url.replace(cameraId, randomUUID()))).status, 404);
    assert.equal((await send(bearer)).status, 401);
    assert.equal((await send({ ...bearer, 'x-worker-generation-secret': 'bad' })).status, 401);
    assert.equal(
      (
        await send(
          { ...bearer, 'x-worker-generation-secret': secret },
          { ...body, appliedAt: 'client-time' },
        )
      ).status,
      400,
    );
    const duplicateStatus = await new Promise<number>((resolve, reject) => {
      const request = http.request(
        url,
        {
          method: 'POST',
          headers: [
            'Host',
            new URL(url).host,
            'Content-Length',
            String(Buffer.byteLength(JSON.stringify(body))),
            'Authorization',
            `Bearer ${token}`,
            'Content-Type',
            'application/json',
            'x-worker-generation-secret',
            secret,
            'x-worker-generation-secret',
            secret,
          ],
        },
        (response) => {
          response.resume();
          response.once('end', () => resolve(response.statusCode!));
        },
      );
      request.once('error', reject);
      request.end(JSON.stringify(body));
    });
    assert.equal(duplicateStatus, 401);
    assert.equal(calls, 0);
    const response = await send({ ...bearer, 'x-worker-generation-secret': secret });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), receipt);
    assert.equal(calls, 1);
  } finally {
    await app.close();
  }
});
