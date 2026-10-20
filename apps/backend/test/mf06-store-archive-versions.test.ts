import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { DataSource } from 'typeorm';
import {
  Mf06AssessmentStore,
  type Mf06AssessmentAppendInput,
} from '../src/modules/safety/assessments/mf06-assessment-store.service.js';
import {
  decodeStoredMainAuthorityArchive,
  sealMainAuthorityArchive,
} from '../src/modules/zones/main-authority-archive-codec.js';
import { archivedPermissionsFixture } from './support/main-archived-permissions.fixture.js';
import { teamArchiveFixture } from './support/main-team-authority.fixture.js';

function input(version: 'V1' | 'V2' | 'V2_NAMED'): Mf06AssessmentAppendInput {
  const fixture = version === 'V1' ? archivedPermissionsFixture() : teamArchiveFixture();
  if (version === 'V2_NAMED') {
    const membership = fixture.payload.sources.find(
      (source) => source.sourceKind === 'TEAM_MEMBERSHIP',
    );
    assert(membership);
    membership.fields = [
      'id',
      'site_id',
      'contractor_id',
      'team_id',
      'worker_id',
      'joined_at',
      'left_at',
    ];
  }
  const sealed = sealMainAuthorityArchive(fixture.payload, fixture.context);
  assert.equal(sealed.status, 'VALID');
  if (sealed.status !== 'VALID') throw Error('Invalid synthetic archive');
  return {
    claim: { requestId: randomUUID(), leaseToken: randomUUID(), headRevision: 2 },
    commandId: randomUUID(),
    siteId: fixture.context.siteId,
    bindingHash: 'a'.repeat(64),
    evaluatorVersion: 'SYNTHETIC_FORMAT_COMPATIBILITY',
    outcome: 'UNAVAILABLE',
    reasonCode: 'AUTHORITY_UNAVAILABLE',
    provenance: 'SYNTHETIC_TEST',
    workerId: fixture.context.workerId,
    profileRevision: null,
    frameSha256: null,
    cropSha256: null,
    authorityArtifact: sealed.archive,
  };
}

function harness(schema: unknown = 'isolated_test_synthetic') {
  let transactionCount = 0;
  const db = {
    driver: { schema },
    transaction: async (isolation: string, work: (manager: unknown) => Promise<unknown>) => {
      assert.equal(isolation, 'SERIALIZABLE');
      transactionCount++;
      // The request is absent: format acceptance must not fabricate a persisted result.
      return work({ query: async () => [] });
    },
  } as unknown as DataSource;
  return { store: new Mf06AssessmentStore(db), count: () => transactionCount };
}

test('Store refuses missing, system and malformed schema instead of using a pooled search_path', async () => {
  for (const schema of ['', null, 'pg_temp', 'information_schema', 'bad\0schema'])
    await assert.rejects(harness(schema).store.finalize(input('V2')), /MF06_SCHEMA_UNAVAILABLE/);
});

for (const version of ['V1', 'V2', 'V2_NAMED'] as const) {
  test(`valid ${version} reaches the original scoped request lookup without asserting authority`, async () => {
    const h = harness();
    assert.deepEqual(await h.store.finalize(input(version)), {
      state: 'UNAVAILABLE',
      reason: 'REQUEST_NOT_FOUND_IN_SCOPE',
    });
    assert.equal(h.count(), 1);
  });
}

for (const change of ['unknown-format', 'mixed-version', 'wrong-digest'] as const) {
  test(`rejects ${change} before database I/O`, async () => {
    const value = structuredClone(input('V2'));
    assert(value.authorityArtifact);
    if (change === 'unknown-format') Object.assign(value.authorityArtifact, { format: 'UNKNOWN' });
    if (change === 'mixed-version')
      value.authorityArtifact.format = 'MF06_MAIN_AUTHORITY_ARCHIVE_V1';
    if (change === 'wrong-digest') value.authorityArtifact.sha256 = '0'.repeat(64);
    const h = harness();
    assert.deepEqual(await h.store.finalize(value), {
      state: 'UNAVAILABLE',
      reason: 'INVALID_INPUT',
    });
    assert.equal(h.count(), 0);
  });
}

test('does not accept arbitrary membership field permutations as another V2 profile', () => {
  const fixture = teamArchiveFixture();
  const membership = fixture.payload.sources.find(
    (source) => source.sourceKind === 'TEAM_MEMBERSHIP',
  );
  assert(membership);
  membership.fields = [
    'site_id',
    'id',
    'contractor_id',
    'team_id',
    'worker_id',
    'joined_at',
    'left_at',
  ];
  assert.deepEqual(sealMainAuthorityArchive(fixture.payload, fixture.context), {
    status: 'UNAVAILABLE',
    reason: 'SOURCE_REGISTRY_MISMATCH',
  });
});

test('reads earlier Root V2 metadata without rewriting its fields, payload or digest', () => {
  const archive = input('V2').authorityArtifact;
  assert(archive);
  const before = JSON.stringify(archive);
  const decoded = decodeStoredMainAuthorityArchive(archive, {
    ...archive.payload.context,
    sha256: archive.sha256,
  });
  assert.equal(decoded.status, 'VALID');
  if (decoded.status !== 'VALID') throw Error('Earlier V2 unexpectedly unavailable');
  assert.equal(JSON.stringify(decoded.archive), before);
});
