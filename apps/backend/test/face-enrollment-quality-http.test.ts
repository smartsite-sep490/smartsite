import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { UserAuthGuard } from '../src/modules/auth/user-auth.guard.js';
import { FaceEnrollmentController } from '../src/modules/workforce/face-enrollment.controller.js';
import { FaceEnrollmentService } from '../src/modules/workforce/face-enrollment.service.js';

test('multipart quality requests preserve left/right and never default a missing target to front', async () => {
  const checked: string[] = [];
  const module = await Test.createTestingModule({
    controllers: [FaceEnrollmentController],
    providers: [
      {
        provide: FaceEnrollmentService,
        useValue: {
          async assessSampleQuality(
            _actor: unknown,
            _workerId: string,
            _sample: unknown,
            target: string,
          ) {
            checked.push(target);
            return {
              status: 'QUALITY_FAILED',
              reasonCode: `FACE_POSE_${target.toUpperCase()}_REQUIRED`,
            };
          },
        },
      },
    ],
  })
    .overrideGuard(UserAuthGuard)
    .useValue({ canActivate: () => true })
    .compile();
  const app = module.createNestApplication<NestExpressApplication>({ logger: false });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.listen(0, '127.0.0.1');
  try {
    const url = `${await app.getUrl()}/workers/00000000-0000-4000-8000-000000000001/face-enrollment-quality`;
    for (const target of ['left', 'right', undefined, 'invalid']) {
      const form = new FormData();
      form.append('sample', new Blob(['synthetic JPEG'], { type: 'image/jpeg' }), 'sample.jpg');
      if (target !== undefined) form.append('target', target);
      const response = await fetch(url, { method: 'POST', body: form });
      assert.equal(response.status, target === 'left' || target === 'right' ? 200 : 400);
      if (response.ok)
        assert.equal(
          (await response.json()).reasonCode,
          `FACE_POSE_${target!.toUpperCase()}_REQUIRED`,
        );
    }
    assert.deepEqual(checked, ['left', 'right']);
  } finally {
    await app.close();
  }
});
