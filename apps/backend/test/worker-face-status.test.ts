import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Test } from '@nestjs/testing';
import type { DataSource } from 'typeorm';
import { WorkerEntity } from '../src/database/entities/worker.entity.js';
import {
  FaceProfileEntity,
  FaceProfileStatus,
} from '../src/database/entities/face-profile.entity.js';
import { UserRole } from '../src/database/entities/user.entity.js';
import { UserAuthGuard } from '../src/modules/auth/user-auth.guard.js';
import { FaceEnrollmentService } from '../src/modules/workforce/identity/face-enrollment.service.js';
import { FaceEnrollmentController } from '../src/modules/workforce/identity/face-enrollment.controller.js';
import { PublicHttpException } from '../src/common/http/public-http-exception.js';

const siteId = '00000000-0000-4000-8000-000000000001';
const workerId = '00000000-0000-4000-8000-000000000002';
const actor = {
  id: '00000000-0000-4000-8000-000000000003',
  mustChangePassword: false,
  roleAssignments: [{ role: UserRole.WORKER, siteId }],
};

function fixture(status: FaceProfileStatus | null = FaceProfileStatus.ACTIVE, hasWorker = true) {
  let reads = 0;
  const manager = {
    getRepository(entity: unknown) {
      return {
        async findOne(options: unknown) {
          reads++;
          if (entity === WorkerEntity) {
            assert.deepEqual(options, {
              where: { siteId, userId: actor.id },
              select: { id: true },
            });
            return hasWorker ? { id: workerId } : null;
          }
          assert.equal(entity, FaceProfileEntity);
          assert.deepEqual(options, {
            where: { workerId },
            select: { status: true },
            order: { createdAt: 'DESC', id: 'DESC' },
          });
          return status ? { status } : null;
        },
      };
    },
  };
  const source = { transaction: async (fn: (m: typeof manager) => unknown) => fn(manager) };
  return {
    service: new FaceEnrollmentService(source as unknown as DataSource, undefined as never),
    reads: () => reads,
  };
}

test('own face status returns only the latest status, including never enrolled and deleted', async () => {
  for (const status of [null, ...Object.values(FaceProfileStatus)]) {
    const { service } = fixture(status);
    assert.deepEqual(await service.ownStatus(actor, siteId), { status: status ?? 'NOT_ENROLLED' });
  }
});

test('own face status denies other roles, missing Site role and cross-Site access before reading', async () => {
  for (const roleAssignments of [
    [],
    [{ role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId }],
    [{ role: UserRole.SITE_MANAGER, siteId }],
    [{ role: UserRole.ADMIN, siteId: null }],
    [{ role: UserRole.WORKER, siteId: workerId }],
  ]) {
    const { service, reads } = fixture();
    await assert.rejects(
      service.ownStatus({ ...actor, roleAssignments }, siteId),
      (error: unknown) => error instanceof PublicHttpException && error.getStatus() === 403,
    );
    assert.equal(reads(), 0);
  }
});

test('missing own Worker is not mistaken for a face that has never enrolled', async () => {
  const { service, reads } = fixture(null, false);
  await assert.rejects(
    service.ownStatus(actor, siteId),
    (error: unknown) => error instanceof PublicHttpException && error.getStatus() === 404,
  );
  assert.equal(reads(), 1);
});

test('database failure is propagated rather than claiming there is no face', async () => {
  const error = new Error('synthetic unavailable');
  const service = new FaceEnrollmentService(
    {
      transaction: async () => {
        throw error;
      },
    } as unknown as DataSource,
    undefined as never,
  );
  await assert.rejects(service.ownStatus(actor, siteId), error);
});

test('the scoped own-status HTTP route returns the minimal projection', async () => {
  const { service } = fixture();
  const module = await Test.createTestingModule({
    controllers: [FaceEnrollmentController],
    providers: [{ provide: FaceEnrollmentService, useValue: service }],
  })
    .overrideGuard(UserAuthGuard)
    .useValue({
      canActivate(context: { switchToHttp(): { getRequest(): { user: unknown } } }) {
        context.switchToHttp().getRequest().user = actor;
        return true;
      },
    })
    .compile();
  const app = module.createNestApplication({ logger: false });
  await app.listen(0, '127.0.0.1');
  try {
    const response = await fetch(`${await app.getUrl()}/sites/${siteId}/workers/me/face-status`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ACTIVE' });
  } finally {
    await app.close();
  }
});
