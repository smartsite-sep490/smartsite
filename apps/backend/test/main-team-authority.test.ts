import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { archivedPermissionsFixture } from './support/main-archived-permissions.fixture.js';
import {
  sealMainAuthorityArchive,
  decodeStoredMainAuthorityArchive,
} from '../src/modules/zones/main-authority-archive-codec.js';
import { projectMainArchivedPermissions } from '../src/modules/zones/main-archived-permission-projection.js';

function fixture() {
  const f = archivedPermissionsFixture(),
    team = randomUUID(),
    member = randomUUID(),
    permission = randomUUID();
  f.rows('WORKER_PERMISSION').length = 0;
  const range = {
    valid_from: '2026-10-11T00:00:00.000001Z',
    valid_until: '2026-10-12T00:00:00.000001Z',
  };
  const sources: {
    sourceKind: string;
    tableName: string;
    fields: readonly string[];
    rows: Record<string, unknown>[];
  }[] = f.payload.sources.map((source) =>
    source.sourceKind === 'ASSIGNMENT'
      ? {
          ...source,
          fields: [...source.fields, 'zone_ids'],
          rows: source.rows.map((row) => ({ ...row, zone_ids: [f.zone] })),
        }
      : source,
  );
  sources.push(
    {
      sourceKind: 'TEAM',
      tableName: 'contractor_team',
      fields: ['id', 'site_id', 'contractor_id', 'is_active'],
      rows: [{ id: team, site_id: f.site, contractor_id: f.contractor, is_active: true }],
    },
    {
      sourceKind: 'TEAM_MEMBERSHIP',
      tableName: 'contractor_team_membership',
      fields: ['id', 'site_id', 'contractor_id', 'team_id', 'worker_id', 'joined_at', 'left_at'],
      rows: [
        {
          id: member,
          site_id: f.site,
          contractor_id: f.contractor,
          team_id: team,
          worker_id: f.worker,
          joined_at: range.valid_from,
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
          id: permission,
          team_id: team,
          contractor_zone_permission_id: f.cp,
          ...range,
          revoked_at: null,
        },
      ],
    },
  );
  const payload = { ...f.payload, version: 'MF06_MAIN_AUTHORITY_ARCHIVE_V2', sources };
  const rows = (kind: string) => payload.sources.find((source) => source.sourceKind === kind)!.rows;
  const seal = () => {
    const result = sealMainAuthorityArchive(payload, f.context);
    assert.equal(result.status, 'VALID', JSON.stringify(result));
    if (result.status !== 'VALID') throw Error('V2 fixture refused');
    return result.archive;
  };
  const project = () => {
    const archive = seal();
    return projectMainArchivedPermissions(archive, { ...f.context, sha256: archive.sha256 });
  };
  return { ...f, permission, payload, rows, seal, project };
}

test('team archive V2 retains a historical ALLOW without asserting identity or authority coverage', () => {
  const f = fixture(),
    result = f.project();
  assert.equal(result.status, 'PROJECTED');
  if (result.status !== 'PROJECTED') throw Error('Projection unavailable');
  assert.deepEqual(result.effects, ['ALLOW']);
  assert.deepEqual(result.allowPermissionIds, [f.permission]);
  assert.equal(result.authorityCoverageEstablished, false);
  assert.equal(result.identityEstablished, false);
  const archive = f.seal();
  assert.equal(
    decodeStoredMainAuthorityArchive(archive, { ...f.context, sha256: archive.sha256 }).status,
    'VALID',
  );
});

for (const [kind, field, value] of [
  ['TEAM', 'is_active', false],
  ['TEAM', 'site_id', randomUUID()],
  ['TEAM', 'contractor_id', randomUUID()],
  ['TEAM_MEMBERSHIP', 'worker_id', randomUUID()],
  ['TEAM_MEMBERSHIP', 'contractor_id', randomUUID()],
  ['TEAM_MEMBERSHIP', 'site_id', randomUUID()],
  ['TEAM_PERMISSION', 'contractor_zone_permission_id', randomUUID()],
  ['ASSIGNMENT', 'zone_ids', []],
  ['ASSIGNMENT', 'status', 'REVOKED'],
] as const)
  test(`team ALLOW requires matching ${kind}.${field}`, () => {
    const f = fixture();
    f.rows(kind)[0]![field] = value;
    const result = f.project();
    assert.equal(result.status, 'PROJECTED');
    if (result.status === 'PROJECTED') assert.deepEqual(result.effects, []);
  });

for (const [kind, field] of [
  ['TEAM_MEMBERSHIP', 'left_at'],
  ['TEAM_PERMISSION', 'revoked_at'],
  ['TEAM_PERMISSION', 'valid_until'],
] as const)
  test(`team ${field} ends eligibility at the exact captured microsecond`, () => {
    const f = fixture();
    f.rows(kind)[0]![field] = f.context.capturedAt;
    const result = f.project();
    assert.equal(result.status, 'PROJECTED');
    if (result.status === 'PROJECTED') assert.deepEqual(result.effects, []);
  });

test('team membership that starts after capture supplies no historical permission', () => {
  const f = fixture();
  f.rows('TEAM_MEMBERSHIP')[0]!.joined_at = '2026-10-11T12:00:00.000002Z';
  const result = f.project();
  assert.equal(result.status, 'PROJECTED');
  if (result.status === 'PROJECTED') assert.deepEqual(result.effects, []);
});
test('team permission must fit its Contractor permission and participation', () => {
  for (const kind of ['CONTRACTOR_PERMISSION', 'PARTICIPATION']) {
    const f = fixture();
    f.rows(kind)[0]!.valid_until = '2026-10-11T23:00:00.000001Z';
    const result = f.project();
    assert.equal(result.status, 'PROJECTED');
    if (result.status === 'PROJECTED') assert.deepEqual(result.effects, []);
  }
});
test('independent DENY remains alongside a valid team ALLOW', () => {
  const f = fixture();
  f.deny();
  const result = f.project();
  assert.equal(result.status, 'PROJECTED');
  if (result.status === 'PROJECTED') assert.deepEqual(result.effects, ['ALLOW', 'DENY']);
});
test('frozen V1 archives still decode with their original hash and source masks', () => {
  const f = archivedPermissionsFixture(),
    archive = f.seal();
  assert.equal(archive.format, 'MF06_MAIN_AUTHORITY_ARCHIVE_V1');
  const decoded = decodeStoredMainAuthorityArchive(archive, {
    ...f.context,
    sha256: archive.sha256,
  });
  assert.equal(decoded.status, 'VALID');
  if (decoded.status === 'VALID') assert.equal(decoded.archive.sha256, archive.sha256);
});
