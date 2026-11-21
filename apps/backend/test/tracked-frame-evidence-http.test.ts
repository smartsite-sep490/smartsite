import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DataSource, type EntityManager } from 'typeorm';
import sharp from 'sharp';
import { TrackedFrameEvidenceController } from '../src/integrations/ai/tracked-frame-evidence.controller.js';
import { TrackedFrameEvidenceUpload } from '../src/integrations/ai/tracked-frame-evidence-upload.js';
import { ServiceAuthGuard } from '../src/modules/auth/service-auth.guard.js';
import { HttpExceptionFilter } from '../src/common/http/http-exception.filter.js';
import { createTestConfig } from './support/config.js';

test('tracked evidence HTTP requires both credentials and bounded exact multipart fields', async () => {
  const bytes = await sharp({
    create: { width: 32, height: 24, channels: 3, background: '#567890' },
  })
    .jpeg()
    .toBuffer();
  const hash = createHash('sha256').update(bytes).digest('hex');
  const token = 'synthetic-evidence-service';
  const secret = 'q'.repeat(43);
  const event = {
    eventId: '11111111-1111-4111-8111-111111111111',
    frameDimensions: { width: 32, height: 24 },
    evidence: [{ kind: 'FRAME', sha256: hash }],
  };
  const context = { opaque: 'original-binding-test' };
  let authentications = 0;
  let writes = 0;
  const source = {
    transaction: <T>(work: (manager: EntityManager) => Promise<T>) => work({} as EntityManager),
  } as DataSource;
  const upload = new TrackedFrameEvidenceUpload(
    {
      async authenticate(_manager, raw, boundContext, credential) {
        assert.equal(credential, secret);
        assert.deepEqual(raw, event);
        assert.deepEqual(boundContext, context);
        authentications++;
        return {
          classification: 'LIVE',
          eventId: event.eventId,
          payloadHash: 'a'.repeat(64),
          bindingHash: 'b'.repeat(64),
          payload: raw,
        };
      },
    },
    {
      async saveAiFrame(content, expectedHash, scope) {
        assert.deepEqual(content, bytes);
        assert.equal(expectedHash, hash);
        assert.deepEqual(scope, { eventId: event.eventId, payloadHash: 'a'.repeat(64) });
        writes++;
      },
    },
    true,
  );
  const module = await Test.createTestingModule({
    controllers: [TrackedFrameEvidenceController],
    providers: [
      ServiceAuthGuard,
      { provide: ConfigService, useValue: createTestConfig({ SMARTSITE_AI_SERVICE_TOKEN: token }) },
      { provide: DataSource, useValue: source },
      { provide: TrackedFrameEvidenceUpload, useValue: upload },
    ],
  }).compile();
  const app = module.createNestApplication<NestExpressApplication>();
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.listen(0, '127.0.0.1');
  try {
    const url = `${await app.getUrl()}/api/v1/integrations/ai/tracked-parts/evidence`;
    const headers = { authorization: `Bearer ${token}`, 'x-worker-generation-secret': secret };
    const form = (image = bytes) => {
      const value = new FormData();
      value.append('schemaVersion', '1.0.0');
      value.append('event', JSON.stringify(event));
      value.append('context', JSON.stringify(context));
      value.append('frame', new Blob([new Uint8Array(image)], { type: 'image/jpeg' }), 'frame.jpg');
      return value;
    };
    const post = (body: FormData, auth = headers, target = url) =>
      fetch(target, { method: 'POST', headers: auth, body });
    assert.equal((await post(form(), { ...headers, authorization: 'Bearer wrong' })).status, 401);
    assert.equal(
      (await post(form(), { ...headers, 'x-worker-generation-secret': '' })).status,
      401,
    );
    assert.equal((await post(form(), headers, `${url}?enabled=true`)).status, 400);
    const unknown = form();
    unknown.append('trustedZoneId', 'forged');
    assert.equal((await post(unknown)).status, 400);
    const duplicate = form();
    duplicate.append('event', JSON.stringify(event));
    assert.equal((await post(duplicate)).status, 400);
    const malformed = form();
    malformed.set('event', '{broken-json');
    assert.equal((await post(malformed)).status, 400);
    const absent = form();
    absent.delete('frame');
    assert.equal((await post(absent)).status, 400);
    assert.equal((await post(form(Buffer.alloc(1_048_577)))).status, 413);
    assert.equal(authentications, 0);
    assert.equal(writes, 0);
    const response = await post(form());
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
      schemaVersion: '1.0.0',
      kind: 'EVIDENCE_STORED',
      eventId: event.eventId,
      payloadHash: 'a'.repeat(64),
      bindingHash: 'b'.repeat(64),
      sha256: hash,
    });
    assert.equal(authentications, 2);
    assert.equal(writes, 1);
  } finally {
    await app.close();
  }
});
