import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { DataSource } from 'typeorm';
import { UserRole } from '../src/database/entities/user.entity.js';
import { WorkerEntity } from '../src/database/entities/worker.entity.js';
import type { AuthenticatedUser } from '../src/modules/auth/auth.service.js';
import { ShiftRequestReaderService } from '../src/modules/workforce/shift-request-reader.service.js';
import { PublicHttpException } from '../src/common/http/public-http-exception.js';

const siteId = randomUUID();
const actor: AuthenticatedUser = {
  id: randomUUID(),
  username: 'synthetic',
  displayName: 'Synthetic Worker',
  isActive: true,
  mustChangePassword: false,
  roleAssignments: [{ role: UserRole.WORKER, siteId }],
};
const denied = (error: unknown) =>
  error instanceof PublicHttpException && error.publicPayload.code === 'FORBIDDEN';

test('mixed request reads deny wrong role, changed password and inactive accounts before DB access', async () => {
  const reader = new ShiftRequestReaderService(undefined as unknown as DataSource);
  await assert.rejects(reader.list(actor, siteId, { view: 'REVIEW' }), denied);
  await assert.rejects(
    reader.list({ ...actor, mustChangePassword: true }, siteId, { view: 'WORKER' }),
    denied,
  );
  await assert.rejects(
    reader.list({ ...actor, isActive: false }, siteId, { view: 'WORKER' }),
    denied,
  );
});

test('missing Worker scope and unavailable permission data cannot become an allowed empty page', async () => {
  let reads = 0;
  let mapped = false;
  const source = {
    getRepository(entity: unknown) {
      assert.equal(entity, WorkerEntity);
      return {
        findOneBy: async () =>
          mapped ? { id: randomUUID(), siteId, contractorId: randomUUID(), isActive: true } : null,
      };
    },
    manager: {
      getRepository() {
        return {
          findOneBy: async () => {
            throw new Error('Synthetic permission database unavailable');
          },
          findBy: async () => [],
        };
      },
    },
    query: async () => {
      reads++;
      return [];
    },
  } as unknown as DataSource;
  const reader = new ShiftRequestReaderService(source);
  await assert.rejects(reader.list(actor, siteId, { view: 'WORKER' }), denied);
  mapped = true;
  await assert.rejects(
    reader.list(actor, siteId, { view: 'WORKER' }),
    /Synthetic permission database unavailable/,
  );
  assert.equal(reads, 0);
});
