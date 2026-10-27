import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { teamArchiveFixture } from './support/main-team-authority.fixture.js';
import { sealMainAuthorityArchive } from '../src/modules/zones/main-authority-archive-codec.js';
import { projectMainArchivedPermissions } from '../src/modules/zones/main-archived-permission-projection.js';

function project(f: ReturnType<typeof teamArchiveFixture>) {
  const sealed = sealMainAuthorityArchive(f.payload, f.context);
  assert.equal(sealed.status, 'VALID');
  if (sealed.status !== 'VALID') throw Error('Invalid fixture');
  const result = projectMainArchivedPermissions(sealed.archive, {
    ...f.context,
    sha256: sealed.archive.sha256,
  });
  assert.equal(result.status, 'PROJECTED');
  if (result.status !== 'PROJECTED') throw Error('Projection unavailable');
  assert.equal(result.projectionVersion, 'MAIN_ARCHIVED_ZONE_EFFECTS_V2');
  assert.equal(result.identityEstablished, false);
  assert.equal(result.authorityCoverageEstablished, false);
  return result;
}

test('V2 projects team-only ALLOW without individual permission', () => {
  const f = teamArchiveFixture();
  const result = project(f);
  assert.deepEqual(result.effects, ['ALLOW']);
  assert.deepEqual(result.allowPermissionIds, [f.row('TEAM_PERMISSION').id]);
});

for (const [name, mutate] of [
  [
    'inactive team',
    (f: ReturnType<typeof teamArchiveFixture>) => {
      f.row('TEAM').is_active = false;
    },
  ],
  [
    'inactive contractor',
    (f: ReturnType<typeof teamArchiveFixture>) => {
      f.row('CONTRACTOR').is_active = false;
    },
  ],
  [
    'inactive participation',
    (f: ReturnType<typeof teamArchiveFixture>) => {
      f.row('PARTICIPATION').is_active = false;
    },
  ],
  [
    'membership not started',
    (f: ReturnType<typeof teamArchiveFixture>) => {
      f.row('TEAM_MEMBERSHIP').joined_at = '2026-10-11T12:00:00.000002Z';
    },
  ],
  [
    'membership ends at event',
    (f: ReturnType<typeof teamArchiveFixture>) => {
      f.row('TEAM_MEMBERSHIP').left_at = f.context.capturedAt;
    },
  ],
  [
    'permission revoked at event',
    (f: ReturnType<typeof teamArchiveFixture>) => {
      f.row('TEAM_PERMISSION').revoked_at = f.context.capturedAt;
    },
  ],
  [
    'parent revoked at event',
    (f: ReturnType<typeof teamArchiveFixture>) => {
      f.row('CONTRACTOR_PERMISSION').revoked_at = f.context.capturedAt;
    },
  ],
  [
    'permission expired',
    (f: ReturnType<typeof teamArchiveFixture>) => {
      f.row('TEAM_PERMISSION').valid_until = f.context.capturedAt;
    },
  ],
  [
    'assignment expired',
    (f: ReturnType<typeof teamArchiveFixture>) => {
      f.row('ASSIGNMENT').valid_until = f.context.capturedAt;
    },
  ],
  [
    'missing assignment Zone',
    (f: ReturnType<typeof teamArchiveFixture>) => {
      f.row('ASSIGNMENT').zone_ids = [randomUUID()];
    },
  ],
  [
    'nonapproved assignment',
    (f: ReturnType<typeof teamArchiveFixture>) => {
      f.row('ASSIGNMENT').status = 'PENDING';
    },
  ],
  [
    'permission exceeds parent interval',
    (f: ReturnType<typeof teamArchiveFixture>) => {
      f.row('CONTRACTOR_PERMISSION').valid_until = '2026-10-11T13:00:00Z';
    },
  ],
  [
    'Worker changed Contractor',
    (f: ReturnType<typeof teamArchiveFixture>) => {
      f.row('WORKER').contractor_id = randomUUID();
    },
  ],
] as const)
  test(`V2 has no team ALLOW for ${name}`, () => {
    const f = teamArchiveFixture();
    mutate(f);
    assert.deepEqual(project(f).effects, []);
  });

test('team interval need not be contained in assignment; actual Main only checks assignment active at event', () => {
  const f = teamArchiveFixture();
  f.row('ASSIGNMENT').valid_from = '2026-10-11T11:00:00Z';
  f.row('ASSIGNMENT').valid_until = '2026-10-11T13:00:00Z';
  assert.deepEqual(project(f).effects, ['ALLOW']);
});

test('membership and revocation retain microsecond boundaries and DENY alongside team ALLOW', () => {
  const f = teamArchiveFixture();
  f.row('TEAM_MEMBERSHIP').joined_at = f.context.capturedAt;
  f.row('TEAM_MEMBERSHIP').left_at = '2026-10-11T12:00:00.000002Z';
  f.row('TEAM_PERMISSION').revoked_at = '2026-10-11T12:00:00.000002Z';
  const denyId = f.deny();
  assert.deepEqual(project(f).effects, ['ALLOW', 'DENY']);
  assert.deepEqual(project(f).denyGrantIds, [denyId]);
});
