import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DataSource, EntityManager } from 'typeorm';
import type {
  Mf06JobClaim,
  Mf06JobLeaseService,
} from '../src/modules/safety/assessments/mf06-job-lease.service.js';
import type { Mf06AssessmentStoreResult } from '../src/modules/safety/assessments/mf06-assessment-store.service.js';
import {
  Mf06AssessmentWorker,
  Mf06RetryableWorkError,
  type Mf06AssessmentWorkPort,
  type Mf06WorkerOptions,
} from '../src/modules/safety/assessments/mf06-assessment-worker.service.js';

type WorkerLeases = Pick<Mf06JobLeaseService, 'claim' | 'retry' | 'fail' | 'cancel'>;
const RetryableWorkError = Mf06RetryableWorkError as unknown as new (code: string) => Error;

function makeClaim(
  attemptCount = 1,
  leaseToken = '22222222-2222-4222-8222-222222222222',
): Mf06JobClaim {
  return {
    requestId: '11111111-1111-4111-8111-111111111111',
    leaseToken,
    headRevision: 2,
    attemptCount,
    leaseExpiresAt: new Date(Date.now() + 300_000).toISOString(),
    deadlineAt: new Date(Date.now() + 600_000).toISOString(),
  };
}

const workerOptions: Mf06WorkerOptions = {
  enabled: true,
  resolverTimeoutMs: 50,
  drainTimeoutMs: 50,
  maxDatabaseAttempts: 3,
};

function createHarness(config: {
  claims: Mf06JobClaim[];
  prepareImpl: (claim: Mf06JobClaim, signal: AbortSignal) => Promise<unknown>;
  finalizeImpl?: (
    manager: EntityManager,
    claim: Mf06JobClaim,
    prepared: unknown,
    signal: AbortSignal,
  ) => Promise<Mf06AssessmentStoreResult>;
}) {
  const manager = { query: async () => [] } as unknown as EntityManager;
  const queue = [...config.claims];
  const calls = {
    claim: [] as (AbortSignal | undefined)[],
    retry: [] as { claim: Mf06JobClaim; errorCode: string }[],
    fail: [] as { claim: Mf06JobClaim; errorCode: string }[],
    cancel: [] as Mf06JobClaim[],
    prepare: [] as { claim: Mf06JobClaim; signal: AbortSignal }[],
    finalize: [] as { manager: EntityManager; claim: Mf06JobClaim; prepared: unknown }[],
    transactions: [] as string[],
  };
  const leases: WorkerLeases = {
    claim: async (signal?: AbortSignal) => (calls.claim.push(signal), queue.shift() ?? null),
    retry: async (claim, errorCode) => (calls.retry.push({ claim, errorCode }), 'RETRY'),
    fail: async (claim, errorCode) => (calls.fail.push({ claim, errorCode }), 'FAILED'),
    cancel: async (claim) => (calls.cancel.push(claim), 'CANCELLED'),
  };
  const work: Mf06AssessmentWorkPort = {
    prepare: async (claim, signal) => (
      calls.prepare.push({ claim, signal }),
      config.prepareImpl(claim, signal)
    ),
    finalize: async (txManager, claim, prepared, signal) => {
      calls.finalize.push({ manager: txManager, claim, prepared });
      if (config.finalizeImpl) return config.finalizeImpl(txManager, claim, prepared, signal);
      return {
        state: 'RECORDED',
        assessment: { assessmentId: '33333333-3333-4333-8333-333333333333' } as never,
      };
    },
  };
  const db = {
    transaction: async (isolation: string, fn: (em: EntityManager) => Promise<unknown>) => {
      calls.transactions.push(isolation);
      return fn(manager);
    },
  } as unknown as DataSource;
  return { db, leases, work, calls };
}

describe('Mf06AssessmentWorker DATABASE_UNAVAILABLE re-prepare unit tests', () => {
  it('retries post-fence PostgreSQL availability failures on a fresh lease', async () => {
    for (const code of ['55P03', '57014', '55000']) {
      const claim = makeClaim();
      const { db, leases, work, calls } = createHarness({
        claims: [claim],
        prepareImpl: async () => ({}),
        finalizeImpl: async () => {
          throw Object.assign(new Error('Synthetic PG failure'), { driverError: { code } });
        },
      });
      assert.equal(
        await new Mf06AssessmentWorker(db, leases, work, workerOptions).runOnce(),
        'RETRY',
      );
      assert.equal(calls.transactions.length, 1);
      assert.deepEqual(calls.retry, [{ claim, errorCode: 'DATABASE_UNAVAILABLE' }]);
      assert.equal(calls.fail.length, 0);
    }
  });
  it('retries with DATABASE_UNAVAILABLE when prepare throws Mf06RetryableWorkError(DATABASE_UNAVAILABLE)', async () => {
    const claim = makeClaim(1);
    const { db, leases, work, calls } = createHarness({
      claims: [claim],
      prepareImpl: async () => {
        throw new RetryableWorkError('DATABASE_UNAVAILABLE');
      },
    });
    const worker = new Mf06AssessmentWorker(db, leases, work, workerOptions);
    assert.equal(await worker.runOnce(), 'RETRY');
    assert.equal(calls.prepare.length, 1);
    assert.equal(calls.transactions.length, 0);
    assert.equal(calls.finalize.length, 0);
    assert.deepEqual(calls.retry, [{ claim, errorCode: 'DATABASE_UNAVAILABLE' }]);
    assert.equal(calls.fail.length, 0);
    assert.equal(calls.cancel.length, 0);
  });

  it('retries after 1 DB TX when finalize throws DATABASE_UNAVAILABLE and prepares fresh on next lease', async () => {
    const firstClaim = makeClaim(1, '22222222-2222-4222-8222-222222222222');
    const secondClaim = makeClaim(2, '44444444-4444-4444-8444-444444444444');
    const preparedSnapshots: unknown[] = [];
    const { db, leases, work, calls } = createHarness({
      claims: [firstClaim, secondClaim],
      prepareImpl: async (claim) => {
        const snapshot = { attempt: claim.attemptCount, seq: preparedSnapshots.length + 1 };
        preparedSnapshots.push(snapshot);
        return snapshot;
      },
      finalizeImpl: async () => {
        if (calls.finalize.length === 1) throw new RetryableWorkError('DATABASE_UNAVAILABLE');
        return { state: 'RECORDED', assessment: { assessmentId: 'rec-2' } as never };
      },
    });
    const worker = new Mf06AssessmentWorker(db, leases, work, workerOptions);
    assert.equal(await worker.runOnce(), 'RETRY');
    assert.equal(calls.prepare.length, 1);
    assert.equal(calls.transactions.length, 1, 'Must not rerun stale prepared object 3 times');
    assert.equal(calls.finalize.length, 1);
    assert.equal(calls.finalize[0]?.prepared, preparedSnapshots[0]);
    assert.deepEqual(calls.retry, [{ claim: firstClaim, errorCode: 'DATABASE_UNAVAILABLE' }]);
    assert.equal(calls.fail.length, 0);
    assert.equal(calls.cancel.length, 0);

    assert.equal(await worker.runOnce(), 'COMPLETED');
    assert.equal(calls.prepare.length, 2);
    assert.equal(calls.transactions.length, 2);
    assert.notEqual(preparedSnapshots[1], preparedSnapshots[0]);
    assert.equal(calls.finalize[1]?.prepared, preparedSnapshots[1]);
    assert.equal(calls.fail.length, 0);
    assert.equal(calls.cancel.length, 0);
  });
});
