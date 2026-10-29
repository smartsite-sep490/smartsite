import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { QueryFailedError, type DataSource } from 'typeorm';
import type { BackendEnvironment } from '../src/config/environment.js';
import type { MainAuthorityArchiveContext } from '../src/modules/zones/main-authority-archive-codec.js';
import { MainQualifiedAuthorityReader } from '../src/modules/zones/main-qualified-authority.reader.js';

const context: MainAuthorityArchiveContext = {
  siteId: '11111111-1111-4111-8111-111111111111',
  zoneId: '22222222-2222-4222-8222-222222222222',
  workerId: null,
  capturedAt: '2026-10-21T10:00:00.000Z',
  purpose: 'INITIAL_OBSERVATION_ASSESSMENT',
};

function fixture() {
  let databaseTouched = false;
  const source = {
    get driver() {
      databaseTouched = true;
      throw new Error('Release failure must not reach the database');
    },
  } as unknown as DataSource;
  const reader = new MainQualifiedAuthorityReader(
    source,
    {
      manifestPath: 'D:/missing-test-authority-release.json',
      reviewedManifestSha256: '0'.repeat(64),
      releaseRoot: 'D:/missing-test-release',
      releaseCommit: 'a'.repeat(40),
    },
    new ConfigService<BackendEnvironment, true>({ NODE_ENV: 'test' }),
  );
  return { reader, prepare: reader.prepareForEvent.bind(reader), touched: () => databaseTouched };
}

test('event authority preparation propagates pre-aborted caller reason before release or DB I/O', async () => {
  const fx = fixture();
  const controller = new AbortController();
  const reason = new Error('CALLER_CANCELLED_AUTHORITY');
  controller.abort(reason);
  await assert.rejects(fx.prepare(context, controller.signal), (error) => error === reason);
  assert.equal(fx.touched(), false);
});

test('missing release remains an explicit unavailable result for a live caller', async () => {
  const fx = fixture();
  assert.deepEqual(await fx.prepare(context, new AbortController().signal), {
    status: 'UNAVAILABLE',
    reason: 'RELEASE_UNAVAILABLE',
  });
  assert.equal(fx.touched(), false);
});

test('pool acquisition and query connection outages remain retryable database unavailability', () => {
  const { reader } = fixture();
  // Exercise the classifier without fabricating an operational release or database.
  const classify = Reflect.get(reader, 'mapDatabaseError').bind(reader) as (
    error: unknown,
    rethrowRetryable: boolean,
  ) => unknown;
  for (const error of [
    Object.assign(new Error('Synthetic pool refusal'), { code: 'ECONNREFUSED' }),
    Object.assign(new Error('Synthetic pool reset'), { code: 'ECONNRESET' }),
    new QueryFailedError(
      'SELECT 1',
      [],
      Object.assign(new Error('Synthetic connection loss'), { code: '08006' }),
    ),
  ]) {
    assert.deepEqual(classify(error, false), {
      status: 'UNAVAILABLE',
      reason: 'DATABASE_UNAVAILABLE',
    });
    assert.deepEqual(classify(error, true), {
      status: 'UNAVAILABLE',
      reason: 'DATABASE_UNAVAILABLE',
    });
  }
});

test('unknown errors and serializable transaction retries keep their original propagation', () => {
  const { reader } = fixture();
  const classify = Reflect.get(reader, 'mapDatabaseError').bind(reader) as (
    error: unknown,
    rethrowRetryable: boolean,
  ) => unknown;
  const unknown = new Error('Unexpected fixture error');
  const serialization = new QueryFailedError(
    'SELECT 1',
    [],
    Object.assign(new Error('Synthetic serialization retry'), { code: '40001' }),
  );
  assert.throws(
    () => classify(unknown, false),
    (error) => error === unknown,
  );
  assert.throws(
    () => classify(serialization, true),
    (error) => error === serialization,
  );
  assert.deepEqual(classify(serialization, false), {
    status: 'UNAVAILABLE',
    reason: 'DATABASE_UNAVAILABLE',
  });
});
