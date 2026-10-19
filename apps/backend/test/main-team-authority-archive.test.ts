import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import {
  sealMainAuthorityArchive,
  decodeStoredMainAuthorityArchive,
} from '../src/modules/zones/main-authority-archive-codec.js';
import { archivedPermissionsFixture } from './support/main-archived-permissions.fixture.js';
import { projectMainArchivedPermissions } from '../src/modules/zones/main-archived-permission-projection.js';

const V2 = 'MF06_MAIN_AUTHORITY_ARCHIVE_V2';
function fixture() {
  const base = archivedPermissionsFixture();
  const team = randomUUID();
  const sources: {
    sourceKind: string;
    tableName: string;
    fields: readonly string[];
    rows: Record<string, unknown>[];
  }[] = structuredClone(base.payload.sources);
  for (const source of sources) {
    if (source.sourceKind === 'ASSIGNMENT') {
      source.fields = [...source.fields, 'zone_ids'];
      source.rows[0]!.zone_ids = [base.zone];
    }
    if (source.sourceKind === 'WORKER_PERMISSION') source.rows = [];
  }
  sources.push(
    {
      sourceKind: 'TEAM',
      tableName: 'contractor_team',
      fields: ['id', 'site_id', 'contractor_id', 'is_active'],
      rows: [{ id: team, site_id: base.site, contractor_id: base.contractor, is_active: true }],
    },
    {
      sourceKind: 'TEAM_MEMBERSHIP',
      tableName: 'contractor_team_membership',
      fields: ['id', 'team_id', 'worker_id', 'site_id', 'contractor_id', 'joined_at', 'left_at'],
      rows: [
        {
          id: randomUUID(),
          team_id: team,
          worker_id: base.worker,
          site_id: base.site,
          contractor_id: base.contractor,
          joined_at: '2026-10-11T00:00:00.000001Z',
          left_at: null,
        },
      ],
    },
    {
      sourceKind: 'TEAM_PERMISSION',
      tableName: 'team_zone_permission',
      fields: [
        'id',
        'team_id',
        'contractor_zone_permission_id',
        'valid_from',
        'valid_until',
        'revoked_at',
      ],
      rows: [
        {
          id: randomUUID(),
          team_id: team,
          contractor_zone_permission_id: base.cp,
          valid_from: '2026-10-11T00:00:00.000001Z',
          valid_until: '2026-10-12T00:00:00.000001Z',
          revoked_at: null,
        },
      ],
    },
  );
  const payload = { ...base.payload, version: V2, sources };
  return {
    ...base,
    payload,
    row: (kind: string) => sources.find((s) => s.sourceKind === kind)!.rows[0]!,
  };
}

test('V2 seals and decodes team-only evidence without asserting identity or coverage', () => {
  const f = fixture();
  const result = sealMainAuthorityArchive(f.payload, f.context);
  assert.equal(result.status, 'VALID');
  if (result.status !== 'VALID') return;
  assert.equal(result.archive.format, V2);
  assert.equal(result.archive.sha256, computeCanonicalPayloadHash(f.payload));
  assert.equal(result.authorityCoverageEstablished, false);
  assert.equal(result.identityEstablished, false);
  assert.equal(
    decodeStoredMainAuthorityArchive(result.archive, {
      ...f.context,
      sha256: result.archive.sha256,
    }).status,
    'VALID',
  );
  assert(Object.isFrozen(result.archive.payload.sources));
  assert.deepEqual(
    projectMainArchivedPermissions(result.archive, { ...f.context, sha256: result.archive.sha256 }),
    { status: 'UNAVAILABLE', reason: 'UNSUPPORTED_VERSION' },
  );
});

for (const [name, mutate, reason] of [
  [
    'missing team source',
    (f: ReturnType<typeof fixture>) => f.payload.sources.pop(),
    'SOURCE_REGISTRY_MISMATCH',
  ],
  [
    'wrong field mask',
    (f: ReturnType<typeof fixture>) => {
      f.payload.sources.at(-1)!.fields = ['id'] as never;
    },
    'SOURCE_REGISTRY_MISMATCH',
  ],
  [
    'wrong membership Site',
    (f: ReturnType<typeof fixture>) => {
      f.row('TEAM_MEMBERSHIP').site_id = randomUUID();
    },
    'SOURCE_SCOPE_MISMATCH',
  ],
  [
    'wrong membership Contractor',
    (f: ReturnType<typeof fixture>) => {
      f.row('TEAM_MEMBERSHIP').contractor_id = randomUUID();
    },
    'SOURCE_SCOPE_MISMATCH',
  ],
  [
    'missing team',
    (f: ReturnType<typeof fixture>) => {
      f.row('TEAM_MEMBERSHIP').team_id = randomUUID();
    },
    'SOURCE_SCOPE_MISMATCH',
  ],
  [
    'invalid Zone array',
    (f: ReturnType<typeof fixture>) => {
      f.row('ASSIGNMENT').zone_ids = ['bad'];
    },
    'MALFORMED_ARCHIVE',
  ],
  [
    'reversed membership interval',
    (f: ReturnType<typeof fixture>) => {
      f.row('TEAM_MEMBERSHIP').left_at = '2026-10-10T00:00:00Z';
    },
    'INVALID_TIME',
  ],
  [
    'reversed permission interval',
    (f: ReturnType<typeof fixture>) => {
      f.row('TEAM_PERMISSION').valid_until = '2026-10-10T00:00:00Z';
    },
    'INVALID_TIME',
  ],
  [
    'extra secret field',
    (f: ReturnType<typeof fixture>) => {
      f.row('TEAM').secret = 'not-allowed';
    },
    'MALFORMED_ARCHIVE',
  ],
] as const)
  test(`V2 rejects ${name}`, () => {
    const f = fixture();
    mutate(f);
    assert.deepEqual(sealMainAuthorityArchive(f.payload, f.context), {
      status: 'UNAVAILABLE',
      reason,
    });
  });

test('V1 hashes and envelope stay V1; V1 cannot silently carry V2 fields', () => {
  const f = archivedPermissionsFixture();
  const archive = f.seal();
  assert.equal(archive.format, 'MF06_MAIN_AUTHORITY_ARCHIVE_V1');
  assert.equal(archive.sha256, computeCanonicalPayloadHash(f.payload));
  const changed = fixture();
  changed.payload.version = 'MF06_MAIN_AUTHORITY_ARCHIVE_V1';
  assert.deepEqual(sealMainAuthorityArchive(changed.payload, changed.context), {
    status: 'UNAVAILABLE',
    reason: 'SOURCE_REGISTRY_MISMATCH',
  });
});

test('V2 envelope and payload versions must agree', () => {
  const f = fixture();
  assert.deepEqual(
    decodeStoredMainAuthorityArchive(
      {
        format: 'MF06_MAIN_AUTHORITY_ARCHIVE_V1',
        payload: f.payload,
        sha256: computeCanonicalPayloadHash(f.payload),
      },
      { ...f.context, sha256: computeCanonicalPayloadHash(f.payload) },
    ),
    { status: 'UNAVAILABLE', reason: 'UNSUPPORTED_VERSION' },
  );
});

test('V2 rejects digest tampering and arbitrary getters without invoking them', () => {
  const f = fixture();
  const result = sealMainAuthorityArchive(f.payload, f.context);
  assert.equal(result.status, 'VALID');
  if (result.status !== 'VALID') return;
  assert.deepEqual(
    decodeStoredMainAuthorityArchive(result.archive, { ...f.context, sha256: '0'.repeat(64) }),
    { status: 'UNAVAILABLE', reason: 'DIGEST_MISMATCH' },
  );
  let calls = 0;
  Object.defineProperty(f.row('TEAM'), 'secret', {
    enumerable: true,
    get() {
      calls++;
      return 'secret';
    },
  });
  assert.deepEqual(sealMainAuthorityArchive(f.payload, f.context), {
    status: 'UNAVAILABLE',
    reason: 'MALFORMED_ARCHIVE',
  });
  assert.equal(calls, 0);
});
