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
