import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DataSource } from 'typeorm';
import {
  Mf06JobLeaseService,
  type Mf06LeaseOptions,
} from '../src/modules/safety/assessments/mf06-job-lease.service.js';

test('private lease options require explicit finite bounds without inherited production defaults', () => {
  const db = {} as DataSource;
  const valid = { leaseSeconds: 60, maxAttempts: 3, retryDelaySeconds: 1 };
  for (const invalid of [
    undefined,
    null,
    {},
    { ...valid, leaseSeconds: 0 },
    { ...valid, leaseSeconds: 301 },
    { ...valid, maxAttempts: 0 },
    { ...valid, maxAttempts: 11 },
    { ...valid, retryDelaySeconds: 0 },
    { ...valid, retryDelaySeconds: Infinity },
    { ...valid, maxAttempts: 1.5 },
    { ...valid, leaseSeconds: '60' },
  ]) {
    assert.throws(
      () => new Mf06JobLeaseService(db, invalid as Mf06LeaseOptions),
      /MF06_INVALID_LEASE_OPTIONS/,
    );
  }
});

test('already aborted lease claim never opens a transaction or accesses the queue', async () => {
  const db = {
    transaction: () => {
      throw new Error('Must not query');
    },
  } as unknown as DataSource;
  const service = new Mf06JobLeaseService(db, {
    leaseSeconds: 60,
    maxAttempts: 3,
    retryDelaySeconds: 1,
  });
  assert.equal(await service.claim(AbortSignal.abort()), null);
});

test('missing, empty, or NUL-containing driver schema fails closed before opening a transaction', async () => {
  const validOptions = { leaseSeconds: 60, maxAttempts: 3, retryDelaySeconds: 1 };
  const validClaim = {
    requestId: '11111111-1111-4111-8111-111111111111',
    leaseToken: '22222222-2222-4222-8222-222222222222',
    headRevision: 2,
    attemptCount: 1,
    leaseExpiresAt: '2026-10-10T00:01:00.000Z',
    deadlineAt: '2026-10-10T00:05:00.000Z',
  };
  for (const badSchema of [undefined, null, '', 'bad\0schema']) {
    const db = {
      driver: { schema: badSchema },
      transaction: () => {
        throw new Error('Must not open transaction');
      },
    } as unknown as DataSource;
    const service = new Mf06JobLeaseService(db, validOptions);
    await assert.rejects(() => service.claim(), /MF06_SCHEMA_UNAVAILABLE/);
    await assert.rejects(() => service.expire(), /MF06_SCHEMA_UNAVAILABLE/);
    await assert.rejects(
      () => service.retry(validClaim, 'RESOLVER_TIMEOUT'),
      /MF06_SCHEMA_UNAVAILABLE/,
    );
  }
});
