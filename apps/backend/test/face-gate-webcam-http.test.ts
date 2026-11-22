import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UserAuthGuard } from '../src/modules/auth/user-auth.guard.js';
import { FaceGateController } from '../src/modules/workforce/access/face-gate.controller.js';
import { FaceGateService } from '../src/modules/workforce/access/face-gate.service.js';

test('Security webcam multipart allows absent source, validates supplied IDs and rejects unknown fields', async () => {
  const calls: unknown[][] = [];
  const module = await Test.createTestingModule({
    controllers: [FaceGateController],
    providers: [
      {
        provide: FaceGateService,
        useValue: {
          observe: async (...args: unknown[]) => {
            calls.push(args);
            return { state: 'NEW_FACE' };
          },
          verify: async (...args: unknown[]) => {
            calls.push(args);
            return { decision: { technicalOutcome: 'UNKNOWN' } };
          },
        },
      },
    ],
  })
    .overrideGuard(UserAuthGuard)
    .useValue({ canActivate: () => true })
    .compile();
  const app = module.createNestApplication({ logger: false });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.listen(0, '127.0.0.1');
  try {
    for (const route of ['face-presence', 'face-verifications']) {
      for (const source of [undefined, randomUUID(), '', 'not-a-uuid', 'null']) {
        const form = new FormData();
        form.append('frame', new Blob(['synthetic'], { type: 'image/jpeg' }), 'frame.jpg');
        form.append(
          route === 'face-presence' ? 'sessionId' : 'direction',
          route === 'face-presence' ? randomUUID() : 'IN',
        );
        if (source !== undefined) form.append('sourceCameraId', source);
        const before = calls.length;
        const response = await fetch(
          (await app.getUrl()) + '/sites/' + randomUUID() + '/gates/' + randomUUID() + '/' + route,
          { method: 'POST', body: form },
        );
        const valid = source === undefined || source.length === 36;
        assert.equal(response.status, valid ? 201 : 400);
        assert.equal(calls.length, before + (valid ? 1 : 0));
        if (valid) assert.equal(calls.at(-1)?.[5], source);
      }
      const form = new FormData();
      form.append('direction', 'IN');
      form.append('trustedWorkerId', randomUUID());
      const response = await fetch(
        (await app.getUrl()) + '/sites/' + randomUUID() + '/gates/' + randomUUID() + '/' + route,
        { method: 'POST', body: form },
      );
      assert.equal(response.status, 400);
    }
  } finally {
    await app.close();
  }
});
