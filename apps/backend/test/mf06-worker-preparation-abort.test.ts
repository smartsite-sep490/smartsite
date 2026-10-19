import assert from 'node:assert/strict';
import { it } from 'node:test';
import type { DataSource } from 'typeorm';
import { Mf06AssessmentWorker } from '../src/modules/safety/assessments/mf06-assessment-worker.service.js';
import type { Mf06JobClaim } from '../src/modules/safety/assessments/mf06-job-lease.service.js';

it('does not start queued resolver I/O after cancellation before its first microtask', async () => {
  const controller = new AbortController();
  let prepareCalls = 0;
  let transactionCalls = 0;
  let cancelCalls = 0;
  const claim: Mf06JobClaim = {
    requestId: '11111111-1111-4111-8111-111111111111',
    leaseToken: '22222222-2222-4222-8222-222222222222',
    headRevision: 2,
    attemptCount: 1,
    leaseExpiresAt: '2026-10-19T06:00:00.000Z',
    deadlineAt: '2026-10-19T06:05:00.000Z',
  };
  const worker = new Mf06AssessmentWorker(
    {
      transaction: async () => {
        transactionCalls++;
        throw new Error('Finalization must not begin');
      },
    } as unknown as DataSource,
    {
      claim: async () => claim,
      cancel: async (actual) => {
        assert.equal(actual, claim);
        cancelCalls++;
        return 'CANCELLED';
      },
      retry: async () => assert.fail('Cancellation is not a retry'),
      fail: async () => assert.fail('Cancellation is not processing failure'),
    },
    {
      prepare: async () => {
        prepareCalls++;
        throw new Error('No resolver call after cancellation');
      },
      finalize: async () => assert.fail('No finalization after cancellation'),
    },
    { enabled: true, resolverTimeoutMs: 1000, drainTimeoutMs: 1000, maxDatabaseAttempts: 1 },
  );
  const result = worker.runOnce(controller.signal);
  // Claim continuation queues preparation first; this abort runs before preparation executes.
  queueMicrotask(() => controller.abort());
  assert.equal(await result, 'CANCELLED');
  assert.equal(cancelCalls, 1);
  assert.equal(transactionCalls, 0);
  assert.equal(prepareCalls, 0);
});
