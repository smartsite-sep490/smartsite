import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DataSource, EntityManager } from 'typeorm';
import { Mf06AssessmentWorker } from '../src/modules/safety/assessments/mf06-assessment-worker.service.js';
import { MAIN_AUTHORITY_SNAPSHOT_TABLES } from '../src/modules/zones/main-authority-read-snapshot.js';

function fixture(schema: string | undefined = 'owned_test') {
  const queries: string[] = [];
  const calls = { finalized: 0, retries: 0, failed: 0 };
  let lockError: Error | undefined;
  const manager = {
    query: async (sql: string) => {
      queries.push(sql);
      if (sql.startsWith('LOCK TABLE') && lockError) throw lockError;
      return sql.includes('pg_my_temp_schema') ? [{ present: false }] : [{ valid: true }];
    },
  } as unknown as EntityManager;
  const db = {
    driver: { schema },
    transaction: async (isolation: string, action: (m: EntityManager) => Promise<unknown>) => {
      assert.equal(isolation, 'SERIALIZABLE');
      return action(manager);
    },
  } as unknown as DataSource;
  const claim = {
    requestId: 'request',
    leaseToken: 'lease',
    headRevision: 1,
    attemptCount: 1,
    leaseExpiresAt: new Date(Date.now() + 30000).toISOString(),
    deadlineAt: new Date(Date.now() + 60000).toISOString(),
  };
  const leases = {
    claim: async () => claim,
    retry: async () => {
      calls.retries++;
      return 'RETRY' as const;
    },
    fail: async () => {
      calls.failed++;
      return 'FAILED' as const;
    },
    cancel: async () => 'CANCELLED' as const,
  };
  const work = {
    finalizationScope: 'AUTHORITY_SNAPSHOT',
    prepare: async () => null,
    finalize: async () => {
      calls.finalized++;
      return { state: 'REPLAY' as const };
    },
  };
  const options = {
    enabled: true,
    resolverTimeoutMs: 1000,
    drainTimeoutMs: 1000,
    maxDatabaseAttempts: 2,
  };
  // The replay result needs only its state in this orchestration fixture.
  const create = () => new Mf06AssessmentWorker(db, leases, work as never, options);
  return {
    queries,
    calls,
    work,
    create,
    setLockError: (error: Error) => {
      lockError = error;
    },
  };
}

test('authority finalization is writable and fenced before the first data SELECT', async () => {
  const f = fixture();
  const worker = f.create();
  f.work.finalizationScope = 'changed-after-construction';
  assert.equal(await worker.runOnce(), 'COMPLETED');
  const lockIndex = f.queries.findIndex((q) => q.startsWith('LOCK TABLE'));
  assert.ok(lockIndex >= 0);
  const firstSelect = f.queries.findIndex((q) => q.startsWith('SELECT'));
  assert.ok(firstSelect > lockIndex);
  assert.equal(
    f.queries[lockIndex],
    `LOCK TABLE ${MAIN_AUTHORITY_SNAPSHOT_TABLES.map((t) => `"owned_test"."${t}"`).join(',')} IN SHARE MODE`,
  );
  assert.ok(f.queries.includes('SET TRANSACTION READ WRITE'));
  assert.equal(f.calls.finalized, 1);
});

test('authority finalization rejects absent selected schema before finalizer', async () => {
  const f = fixture('');
  assert.equal(await f.create().runOnce(), 'FAILED');
  assert.equal(f.calls.finalized, 0);
});

test('authority fence lock timeout retries without entering the finalizer', async () => {
  const f = fixture();
  f.setLockError(Object.assign(new Error('synthetic lock timeout'), { code: '55P03' }));
  assert.equal(await f.create().runOnce(), 'RETRY');
  assert.equal(f.calls.retries, 1);
  assert.equal(f.calls.finalized, 0);
});

test('unknown authority finalization scope cannot silently use an unfenced transaction', () => {
  const f = fixture();
  f.work.finalizationScope = 'unknown';
  assert.throws(f.create, /MF06_INVALID_WORKER_OPTIONS/);
});
