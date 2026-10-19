import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DataSource } from 'typeorm';
import { Mf06AssessmentWorker } from '../src/modules/safety/assessments/mf06-assessment-worker.service.js';
import type { Mf06JobClaim } from '../src/modules/safety/assessments/mf06-job-lease.service.js';

const now = Date.parse('2026-10-19T12:00:00Z');
function harness(
  leaseMs: number,
  deadlineMs = 1000,
  prepareImpl?: (signal: AbortSignal) => Promise<unknown>,
  beforeTransaction?: () => void,
) {
  const claim: Mf06JobClaim = {
    requestId: '11111111-1111-4111-8111-111111111111',
    leaseToken: '22222222-2222-4222-8222-222222222222',
    headRevision: 2,
    attemptCount: 1,
    leaseExpiresAt: new Date(now + leaseMs).toISOString(),
    deadlineAt: new Date(now + deadlineMs).toISOString(),
  };
  const calls = { prepare: 0, finalize: 0, transactions: 0, retry: [] as string[], fail: 0 };
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const db = {
    transaction: async (_isolation: string, operation: (manager: unknown) => Promise<unknown>) => {
      calls.transactions++;
      beforeTransaction?.();
      return operation({});
    },
  } as unknown as DataSource;
  const worker = new Mf06AssessmentWorker(
    db,
    {
      claim: async () => claim,
      cancel: async () => 'CANCELLED',
      retry: async (_claim, reason) => {
        calls.retry.push(reason);
        return 'RETRY';
      },
      fail: async () => {
        calls.fail++;
        return 'FAILED';
      },
    },
    {
      prepare: async (_claim, signal) => {
        calls.prepare++;
        entered();
        return prepareImpl ? prepareImpl(signal) : {};
      },
      finalize: async () => {
        calls.finalize++;
        return { state: 'STALE', reason: 'SYNTHETIC_TEST' };
      },
    },
    { enabled: true, resolverTimeoutMs: 100, drainTimeoutMs: 100, maxDatabaseAttempts: 3 },
  );
  return { worker, calls, started, claim };
}

for (const leaseMs of [0, -1]) {
  test(`expired lease (${leaseMs}ms) cannot dispatch external preparation`, async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now });
    const { worker, calls } = harness(leaseMs);
    assert.equal(await worker.runOnce(), 'STALE');
    assert.equal(calls.prepare, 0);
    assert.equal(calls.transactions, 0);
    assert.deepEqual(calls.retry, []);
    assert.equal(calls.fail, 0);
  });
}

test('expired deadline cannot dispatch preparation even with an unexpired lease', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now });
  const { worker, calls } = harness(1000, 0);
  assert.equal(await worker.runOnce(), 'STALE');
  assert.equal(calls.prepare, 0);
  assert.equal(calls.transactions, 0);
});

test('invalid lease timestamps cannot become an unbounded preparation budget', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now });
  const { worker, calls, claim } = harness(1000);
  Object.assign(claim, { leaseExpiresAt: 'not-a-timestamp' });
  assert.equal(await worker.runOnce(), 'STALE');
  assert.equal(calls.prepare, 0);
});

for (const boundary of ['lease', 'deadline'] as const) {
  test(`${boundary} expiry aborts pending preparation before the resolver timeout`, async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now });
    let actualSignal!: AbortSignal;
    let resolveLate!: (value: unknown) => void;
    const { worker, calls, started } = harness(
      boundary === 'lease' ? 20 : 1000,
      boundary === 'deadline' ? 20 : 1000,
      async (signal) => {
        actualSignal = signal;
        return new Promise((resolve) => {
          resolveLate = resolve;
        });
      },
    );
    const result = worker.runOnce();
    await started;
    t.mock.timers.tick(20);
    assert.equal(actualSignal.aborted, true);
    assert.equal(await result, 'STALE');
    resolveLate({ ignored: true });
    await Promise.resolve();
    assert.equal(calls.transactions, 0);
    assert.equal(calls.finalize, 0);
    assert.deepEqual(calls.retry, []);
    assert.equal(calls.fail, 0);
  });
}

test('lease expiry before the first preparation microtask does not dispatch I/O', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now });
  const { worker, calls } = harness(20);
  const result = worker.runOnce();
  queueMicrotask(() => t.mock.timers.tick(20));
  assert.equal(await result, 'STALE');
  assert.equal(calls.prepare, 0);
  assert.equal(calls.transactions, 0);
});

test('ordinary resolver timeout inside a valid lease retains existing retry semantics', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now });
  const { worker, calls, started } = harness(1000, 1000, async () => new Promise(() => {}));
  const result = worker.runOnce();
  await started;
  t.mock.timers.tick(100);
  assert.equal(await result, 'RETRY');
  assert.deepEqual(calls.retry, ['RESOLVER_TIMEOUT']);
  assert.equal(calls.transactions, 0);
});

test('expiry while waiting for a database transaction prevents finalizer dispatch', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now });
  const { worker, calls } = harness(20, 1000, undefined, () => t.mock.timers.tick(20));
  assert.equal(await worker.runOnce(), 'STALE');
  assert.equal(calls.prepare, 1);
  assert.equal(calls.transactions, 1);
  assert.equal(calls.finalize, 0);
});

test('expiry between serialization attempts stops retries without repeating external I/O', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now });
  const { worker, calls } = harness(20, 1000, undefined, () => {
    t.mock.timers.tick(20);
    throw Object.assign(new Error('Synthetic serialization retry'), { code: '40001' });
  });
  assert.equal(await worker.runOnce(), 'STALE');
  assert.equal(calls.prepare, 1);
  assert.equal(calls.transactions, 1);
  assert.equal(calls.finalize, 0);
  assert.deepEqual(calls.retry, []);
});
