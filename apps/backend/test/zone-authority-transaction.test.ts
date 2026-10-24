import assert from 'node:assert/strict';
import { test } from 'node:test';
import { QueryFailedError, type DataSource, type EntityManager } from 'typeorm';
import { withZoneAuthorityTransaction } from '../src/modules/zones/zone-authority-transaction.js';
import { PublicHttpException } from '../src/common/http/public-http-exception.js';

function conflict(code: string) {
  return new QueryFailedError(
    'synthetic query',
    [],
    Object.assign(new Error('synthetic conflict'), { code }),
  );
}

test('authority transactions retain SERIALIZABLE by default', async () => {
  const levels: unknown[] = [];
  const source = {
    transaction: async (level: unknown, work: (manager: EntityManager) => Promise<unknown>) => {
      levels.push(level);
      return work({} as EntityManager);
    },
  } as unknown as Pick<DataSource, 'transaction'>;
  assert.equal(await withZoneAuthorityTransaction(source, async () => 'committed'), 'committed');
  assert.deepEqual(levels, ['SERIALIZABLE']);
});

test('revocation deadlock retry restarts the complete callback with a fresh manager', async () => {
  const levels: unknown[] = [];
  const managers: EntityManager[] = [];
  let completed = 0;
  const source = {
    transaction: async (level: unknown, work: (manager: EntityManager) => Promise<unknown>) => {
      levels.push(level);
      return work({} as EntityManager);
    },
  } as unknown as Pick<DataSource, 'transaction'>;
  const value = await withZoneAuthorityTransaction(
    source,
    async (manager) => {
      managers.push(manager);
      if (managers.length === 1) throw conflict('40P01');
      completed++;
      return 'revoked';
    },
    'READ COMMITTED',
  );
  assert.equal(value, 'revoked');
  assert.equal(completed, 1);
  assert.deepEqual(levels, ['READ COMMITTED', 'READ COMMITTED']);
  assert.notEqual(managers[0], managers[1]);
});

test('serialization retries exhaust at three complete attempts without a commit acknowledgement', async () => {
  let attempts = 0;
  const source = {
    transaction: async (_level: unknown, work: (manager: EntityManager) => Promise<unknown>) =>
      work({} as EntityManager),
  } as unknown as Pick<DataSource, 'transaction'>;
  await assert.rejects(
    withZoneAuthorityTransaction(source, async () => {
      attempts++;
      throw conflict('40001');
    }),
    (error: unknown) =>
      error instanceof PublicHttpException &&
      error.getStatus() === 503 &&
      error.publicPayload.code === 'SERVICE_UNAVAILABLE',
  );
  assert.equal(attempts, 3);
});

test('authority retries never retry or acknowledge an authorization failure', async () => {
  let attempts = 0;
  const denied = new Error('synthetic authorization denial');
  const source = {
    transaction: async (_level: unknown, work: (manager: EntityManager) => Promise<unknown>) =>
      work({} as EntityManager),
  } as unknown as Pick<DataSource, 'transaction'>;
  await assert.rejects(
    withZoneAuthorityTransaction(
      source,
      async () => {
        attempts++;
        throw denied;
      },
      'READ COMMITTED',
    ),
    (error: unknown) => error === denied,
  );
  assert.equal(attempts, 1);
});
