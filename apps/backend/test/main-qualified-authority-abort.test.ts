import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigService } from '@nestjs/config';
import type { DataSource } from 'typeorm';
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
  return { prepare: reader.prepareForEvent.bind(reader), touched: () => databaseTouched };
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
