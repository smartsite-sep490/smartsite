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
  type Mf06WorkerOptions as Mf06AssessmentWorkerOptions,
} from '../src/modules/safety/assessments/mf06-assessment-worker.service.js';

// -----------------------------------------------------------------------------
// Test Types and Lightweight Mock Harness
// -----------------------------------------------------------------------------

export type Mf06WorkerLeases = Pick<Mf06JobLeaseService, 'claim' | 'retry' | 'fail' | 'cancel'>;

export interface Mf06WorkerWork {
  prepare(claim: Mf06JobClaim, signal: AbortSignal): Promise<unknown>;
  finalize(
    manager: EntityManager,
    claim: Mf06JobClaim,
    prepared: unknown,
    signal: AbortSignal,
  ): Promise<Mf06AssessmentStoreResult>;
}

const sampleClaim: Mf06JobClaim = {
  requestId: '11111111-1111-4111-8111-111111111111',
  leaseToken: '22222222-2222-4222-8222-222222222222',
  headRevision: 2,
  attemptCount: 1,
  leaseExpiresAt: '2026-10-12T18:00:00.000Z',
  deadlineAt: '2026-10-12T18:05:00.000Z',
};

const defaultOptions: Mf06AssessmentWorkerOptions = {
  enabled: true,
  resolverTimeoutMs: 50,
  drainTimeoutMs: 50,
  maxDatabaseAttempts: 3,
};

function createMocks(
  config: {
    claimResult?: Mf06JobClaim | null;
    prepareImpl?: (claim: Mf06JobClaim, signal: AbortSignal) => Promise<unknown>;
    finalizeImpl?: (
      manager: EntityManager,
      claim: Mf06JobClaim,
      prepared: unknown,
      signal: AbortSignal,
    ) => Promise<Mf06AssessmentStoreResult>;
    transactionImpl?: (
      isolation: string,
      fn: (manager: EntityManager) => Promise<unknown>,
    ) => Promise<unknown>;
  } = {},
) {
  const dummyManager = { query: async () => [] } as unknown as EntityManager;
  const calls = {
    claim: [] as (AbortSignal | undefined)[],
    retry: [] as { claim: Mf06JobClaim; errorCode: string }[],
    fail: [] as { claim: Mf06JobClaim; errorCode: string }[],
    cancel: [] as Mf06JobClaim[],
    prepare: [] as { claim: Mf06JobClaim; signal: AbortSignal }[],
    finalize: [] as { manager: EntityManager; claim: Mf06JobClaim; prepared: unknown }[],
    transactions: [] as string[],
  };

  const leases: Mf06WorkerLeases = {
    claim: async (signal?: AbortSignal) => {
      calls.claim.push(signal);
      return config.claimResult !== undefined ? config.claimResult : sampleClaim;
    },
    retry: async (claim: Mf06JobClaim, errorCode: string) => {
      calls.retry.push({ claim, errorCode });
      return 'RETRY';
    },
    fail: async (claim: Mf06JobClaim, errorCode: string) => {
      calls.fail.push({ claim, errorCode });
      return 'FAILED';
    },
    cancel: async (claim: Mf06JobClaim) => {
      calls.cancel.push(claim);
      return 'CANCELLED';
    },
  };

  const work: Mf06WorkerWork = {
    prepare: async (claim: Mf06JobClaim, signal: AbortSignal) => {
      calls.prepare.push({ claim, signal });
      return config.prepareImpl ? config.prepareImpl(claim, signal) : { preparedData: true };
    },
    finalize: async (
      manager: EntityManager,
      claim: Mf06JobClaim,
      prepared: unknown,
      signal: AbortSignal,
    ) => {
      calls.finalize.push({ manager, claim, prepared });
      return config.finalizeImpl
        ? config.finalizeImpl(manager, claim, prepared, signal)
        : {
            state: 'RECORDED',
            assessment: {
              assessmentId: '33333333-3333-4333-8333-333333333333',
            } as unknown as Mf06AssessmentStoreResult extends { assessment: infer T } ? T : never,
          };
    },
  };

  const db = {
    transaction: async (isolation: string, fn: (manager: EntityManager) => Promise<unknown>) => {
      calls.transactions.push(isolation);
      if (config.transactionImpl) return config.transactionImpl(isolation, fn);
      return fn(dummyManager);
    },
  } as unknown as DataSource;

  return { db, leases, work, calls, dummyManager };
}

// -----------------------------------------------------------------------------
// Test Suite
// -----------------------------------------------------------------------------

describe('Mf06AssessmentWorker unit tests', () => {
  describe('constructor bounds and options validation', () => {
    it('accepts valid options within strict ranges', () => {
      const { db, leases, work } = createMocks();
      assert.doesNotThrow(() => new Mf06AssessmentWorker(db, leases, work, defaultOptions));
      assert.doesNotThrow(
        () =>
          new Mf06AssessmentWorker(db, leases, work, {
            enabled: false,
            resolverTimeoutMs: 1,
            drainTimeoutMs: 1,
            maxDatabaseAttempts: 1,
          }),
      );
      assert.doesNotThrow(
        () =>
          new Mf06AssessmentWorker(db, leases, work, {
            enabled: true,
            resolverTimeoutMs: 30000,
            drainTimeoutMs: 30000,
            maxDatabaseAttempts: 3,
          }),
      );
    });

    it('rejects invalid or missing options without implicit defaults', () => {
      const { db, leases, work } = createMocks();
      assert.throws(
        () =>
          new Mf06AssessmentWorker(
            db,
            leases,
            work,
            null as unknown as Mf06AssessmentWorkerOptions,
          ),
      );
      assert.throws(
        () =>
          new Mf06AssessmentWorker(db, leases, work, {} as unknown as Mf06AssessmentWorkerOptions),
      );
      assert.throws(
        () =>
          new Mf06AssessmentWorker(db, leases, work, { ...defaultOptions, resolverTimeoutMs: 0 }),
      );
      assert.throws(
        () =>
          new Mf06AssessmentWorker(db, leases, work, {
            ...defaultOptions,
            resolverTimeoutMs: 30001,
          }),
      );
      assert.throws(
        () => new Mf06AssessmentWorker(db, leases, work, { ...defaultOptions, drainTimeoutMs: 0 }),
      );
      assert.throws(
        () =>
          new Mf06AssessmentWorker(db, leases, work, { ...defaultOptions, drainTimeoutMs: 30001 }),
      );
      assert.throws(
        () =>
          new Mf06AssessmentWorker(db, leases, work, { ...defaultOptions, maxDatabaseAttempts: 0 }),
      );
      assert.throws(
        () =>
          new Mf06AssessmentWorker(db, leases, work, { ...defaultOptions, maxDatabaseAttempts: 4 }),
      );
      assert.throws(
        () =>
          new Mf06AssessmentWorker(db, leases, work, {
            ...defaultOptions,
            maxDatabaseAttempts: 1.5,
          }),
      );
    });
  });

  describe('runOnce concurrency, disabled, and abort handling', () => {
    it('returns IDLE with zero queries when disabled', async () => {
      const { db, leases, work, calls } = createMocks();
      const worker = new Mf06AssessmentWorker(db, leases, work, {
        ...defaultOptions,
        enabled: false,
      });
      const outcome = await worker.runOnce();
      assert.equal(outcome, 'IDLE');
      assert.equal(calls.claim.length, 0);
      assert.equal(calls.prepare.length, 0);
      assert.equal(calls.transactions.length, 0);
    });

    it('returns IDLE when passed an already-aborted signal', async () => {
      const { db, leases, work, calls } = createMocks();
      const worker = new Mf06AssessmentWorker(db, leases, work, defaultOptions);
      const controller = new AbortController();
      controller.abort();
      const outcome = await worker.runOnce(controller.signal);
      assert.equal(outcome, 'IDLE');
      assert.equal(calls.claim.length, 0);
    });

    it('returns IDLE for concurrent runOnce on same instance (busy gate)', async () => {
      let resolvePrepare!: (val: unknown) => void;
      const preparePromise = new Promise((resolve) => {
        resolvePrepare = resolve;
      });
      const { db, leases, work, calls } = createMocks({ prepareImpl: async () => preparePromise });
      const worker = new Mf06AssessmentWorker(db, leases, work, defaultOptions);

      const firstRun = worker.runOnce();
      const secondRun = await worker.runOnce();
      assert.equal(secondRun, 'IDLE', 'Concurrent runOnce must return IDLE without stealing work');

      resolvePrepare({ done: true });
      assert.equal(await firstRun, 'COMPLETED');
      assert.equal(calls.claim.length, 1);
    });

    it('returns IDLE when claim returns null (no work available)', async () => {
      const { db, leases, work, calls } = createMocks({ claimResult: null });
      const worker = new Mf06AssessmentWorker(db, leases, work, defaultOptions);
      assert.equal(await worker.runOnce(), 'IDLE');
      assert.equal(calls.claim.length, 1);
      assert.equal(calls.prepare.length, 0);
      assert.equal(calls.transactions.length, 0);
    });
  });

  describe('prepare execution, timeouts, and error classifications', () => {
    it('retries with RESOLVER_TIMEOUT when uncooperative prepare exceeds timeout', async () => {
      const { db, leases, work, calls } = createMocks({
        prepareImpl: (_claim, signal) =>
          new Promise((_, reject) => {
            signal.addEventListener('abort', () => reject(new Error('aborted by timeout')));
          }),
      });
      const worker = new Mf06AssessmentWorker(db, leases, work, {
        ...defaultOptions,
        resolverTimeoutMs: 15,
      });
      const outcome = await worker.runOnce();

      assert.equal(outcome, 'RETRY');
      assert.equal(calls.retry.length, 1);
      assert.equal(calls.retry[0]?.errorCode, 'RESOLVER_TIMEOUT');
      assert.equal(
        calls.transactions.length,
        0,
        'Late prepare must never open finalization transaction',
      );
    });

    it('ensures uncooperative late prepare resolution never executes finalize', async () => {
      let resolveLate!: (val: unknown) => void;
      const { db, leases, work, calls } = createMocks({
        prepareImpl: () =>
          new Promise((resolve) => {
            resolveLate = resolve;
          }),
      });
      const worker = new Mf06AssessmentWorker(db, leases, work, {
        ...defaultOptions,
        resolverTimeoutMs: 15,
      });
      const outcome = await worker.runOnce();
      assert.equal(outcome, 'RETRY');

      resolveLate({ lateData: true });
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(calls.finalize.length, 0);
      assert.equal(calls.transactions.length, 0);
    });

    it('cancels claim when external signal aborts active prepare', async () => {
      const controller = new AbortController();
      const { db, leases, work, calls } = createMocks({
        prepareImpl: async () => {
          controller.abort();
          throw new Error('aborted');
        },
      });
      const worker = new Mf06AssessmentWorker(db, leases, work, defaultOptions);
      const outcome = await worker.runOnce(controller.signal);

      assert.equal(outcome, 'CANCELLED');
      assert.equal(calls.cancel.length, 1);
      assert.equal(calls.cancel[0]?.requestId, sampleClaim.requestId);
      assert.equal(calls.finalize.length, 0);
    });

    it('retries with RESOLVER_UNAVAILABLE on Mf06RetryableWorkError', async () => {
      const { db, leases, work, calls } = createMocks({
        prepareImpl: async () => {
          throw new Mf06RetryableWorkError('RESOLVER_UNAVAILABLE');
        },
      });
      const worker = new Mf06AssessmentWorker(db, leases, work, defaultOptions);
      const outcome = await worker.runOnce();

      assert.equal(outcome, 'RETRY');
      assert.equal(calls.retry.length, 1);
      assert.equal(calls.retry[0]?.errorCode, 'RESOLVER_UNAVAILABLE');
      assert.equal(calls.transactions.length, 0);
    });

    it('fails with PROCESSING_FAILED on unclassified permanent prepare error', async () => {
      const { db, leases, work, calls } = createMocks({
        prepareImpl: async () => {
          throw new Error('Unparseable corrupt payload');
        },
      });
      const worker = new Mf06AssessmentWorker(db, leases, work, defaultOptions);
      const outcome = await worker.runOnce();

      assert.equal(outcome, 'FAILED');
      assert.equal(calls.fail.length, 1);
      assert.equal(calls.fail[0]?.errorCode, 'PROCESSING_FAILED');
      assert.equal(calls.transactions.length, 0);
    });
  });

  describe('finalization, serializable transaction retries, and status mappings', () => {
    it('executes finalize via exact SERIALIZABLE manager without repeating prepare on 40001 retry', async () => {
      let attempts = 0;
      const { db, leases, work, calls, dummyManager } = createMocks({
        finalizeImpl: async (manager) => {
          assert.equal(manager, dummyManager, 'Must pass exact transaction manager');
          attempts++;
          if (attempts < 2) {
            const err = new Error('serialization failure') as Error & { code: string };
            err.code = '40001';
            throw err;
          }
          return {
            state: 'RECORDED',
            assessment: { assessmentId: 'rec-1' } as unknown as Mf06AssessmentStoreResult extends {
              assessment: infer T;
            }
              ? T
              : never,
          };
        },
      });
      const worker = new Mf06AssessmentWorker(db, leases, work, defaultOptions);
      const outcome = await worker.runOnce();

      assert.equal(outcome, 'COMPLETED');
      assert.equal(
        calls.prepare.length,
        1,
        'Prepare must be called exactly once and not repeated across DB retries',
      );
      assert.equal(calls.finalize.length, 2, 'Finalize must retry after 40001 serialization error');
      assert.equal(calls.transactions[0], 'SERIALIZABLE');
      assert.equal(calls.transactions[1], 'SERIALIZABLE');
    });

    it('retries job with DATABASE_UNAVAILABLE when serialization retries exceed maxDatabaseAttempts', async () => {
      const { db, leases, work, calls } = createMocks({
        finalizeImpl: async () => {
          const err = new Error('serialization failure') as Error & { code: string };
          err.code = '40001';
          throw err;
        },
      });
      const worker = new Mf06AssessmentWorker(db, leases, work, {
        ...defaultOptions,
        maxDatabaseAttempts: 3,
      });
      const outcome = await worker.runOnce();

      assert.equal(outcome, 'RETRY');
      assert.equal(calls.finalize.length, 3, 'Must stop at maxDatabaseAttempts (3)');
      assert.equal(calls.retry.length, 1);
      assert.equal(calls.retry[0]?.errorCode, 'DATABASE_UNAVAILABLE');
    });

    it('fails with PROCESSING_FAILED on unexpected generic database error during finalize', async () => {
      const { db, leases, work, calls } = createMocks({
        finalizeImpl: async () => {
          throw new Error('Unrecoverable connection error');
        },
      });
      const worker = new Mf06AssessmentWorker(db, leases, work, defaultOptions);
      const outcome = await worker.runOnce();

      assert.equal(outcome, 'FAILED');
      assert.equal(calls.fail.length, 1);
      assert.equal(calls.fail[0]?.errorCode, 'PROCESSING_FAILED');
    });

    it('maps store results correctly: RECORDED/REPLAY -> COMPLETED, STALE -> STALE, CONFLICT/UNAVAILABLE -> FAILED(INVALID_CONTEXT)', async () => {
      // 1. REPLAY -> COMPLETED
      const replayMocks = createMocks({
        finalizeImpl: async () => ({
          state: 'REPLAY',
          assessment: { assessmentId: 'rep-1' } as unknown as Mf06AssessmentStoreResult extends {
            assessment: infer T;
          }
            ? T
            : never,
        }),
      });
      assert.equal(
        await new Mf06AssessmentWorker(
          replayMocks.db,
          replayMocks.leases,
          replayMocks.work,
          defaultOptions,
        ).runOnce(),
        'COMPLETED',
      );

      // 2. STALE -> STALE
      const staleMocks = createMocks({
        finalizeImpl: async () => ({ state: 'STALE', reason: 'REVISION_STALE' }),
      });
      assert.equal(
        await new Mf06AssessmentWorker(
          staleMocks.db,
          staleMocks.leases,
          staleMocks.work,
          defaultOptions,
        ).runOnce(),
        'STALE',
      );
      assert.equal(staleMocks.calls.fail.length, 0);

      // 3. CONFLICT -> FAILED with INVALID_CONTEXT
      const conflictMocks = createMocks({
        finalizeImpl: async () => ({ state: 'CONFLICT', reason: 'PAYLOAD_HASH_MISMATCH' }),
      });
      assert.equal(
        await new Mf06AssessmentWorker(
          conflictMocks.db,
          conflictMocks.leases,
          conflictMocks.work,
          defaultOptions,
        ).runOnce(),
        'FAILED',
      );
      assert.equal(conflictMocks.calls.fail[0]?.errorCode, 'INVALID_CONTEXT');

      // 4. UNAVAILABLE store input -> FAILED with INVALID_CONTEXT
      const unavailMocks = createMocks({
        finalizeImpl: async () => ({ state: 'UNAVAILABLE', reason: 'INVALID_INPUT' }),
      });
      assert.equal(
        await new Mf06AssessmentWorker(
          unavailMocks.db,
          unavailMocks.leases,
          unavailMocks.work,
          defaultOptions,
        ).runOnce(),
        'FAILED',
      );
      assert.equal(unavailMocks.calls.fail[0]?.errorCode, 'INVALID_CONTEXT');

      // 5. Domain UNAVAILABLE outcome recorded in store returns COMPLETED (not mislabeled as FAILED)
      const domainUnavailMocks = createMocks({
        finalizeImpl: async () => ({
          state: 'RECORDED',
          assessment: {
            assessmentId: 'unavail-1',
            outcome: 'UNAVAILABLE',
          } as unknown as Mf06AssessmentStoreResult extends { assessment: infer T } ? T : never,
        }),
      });
      assert.equal(
        await new Mf06AssessmentWorker(
          domainUnavailMocks.db,
          domainUnavailMocks.leases,
          domainUnavailMocks.work,
          defaultOptions,
        ).runOnce(),
        'COMPLETED',
      );
    });

    it('does not cancel claim retroactively if abort occurs after finalize has committed', async () => {
      const controller = new AbortController();
      const { db, leases, work, calls } = createMocks({
        transactionImpl: async (_isolation, fn) => {
          const result = await fn({} as EntityManager);
          controller.abort();
          return result;
        },
      });
      const worker = new Mf06AssessmentWorker(db, leases, work, defaultOptions);
      const outcome = await worker.runOnce(controller.signal);

      assert.equal(outcome, 'COMPLETED', 'Committed outcome must be preserved');
      assert.equal(calls.cancel.length, 0, 'Must not retroactively cancel committed claim');
    });
  });

  describe('drain lifecycle and shutdown', () => {
    it('aborts active prepare and permanently stops new claims idempotently', async () => {
      let prepareAborted = false;
      const { db, leases, work } = createMocks({
        prepareImpl: (_claim, signal) =>
          new Promise((_, reject) => {
            signal.addEventListener('abort', () => {
              prepareAborted = true;
              reject(new Error('drained'));
            });
          }),
      });
      const worker = new Mf06AssessmentWorker(db, leases, work, defaultOptions);

      const runPromise = worker.runOnce();
      await new Promise((r) => setTimeout(r, 5));
      await worker.drain();
      await runPromise;

      assert.equal(prepareAborted, true, 'Active prepare must be aborted on drain');
      assert.equal(await worker.runOnce(), 'IDLE', 'Subsequent runOnce must be permanently IDLE');

      await assert.doesNotReject(() => worker.drain());
    });

    it('rejects with MF06_DRAIN_TIMEOUT if final transaction is blocked beyond drainTimeoutMs', async () => {
      const { db, leases, work } = createMocks({
        finalizeImpl: () => new Promise(() => {}),
      });
      const worker = new Mf06AssessmentWorker(db, leases, work, {
        ...defaultOptions,
        drainTimeoutMs: 15,
      });

      const runPromise = worker.runOnce();
      await new Promise((r) => setTimeout(r, 5));

      await assert.rejects(
        () => worker.drain(),
        (err: Error) => err.message === 'MF06_DRAIN_TIMEOUT',
      );

      runPromise.catch(() => {});
    });
  });
});
