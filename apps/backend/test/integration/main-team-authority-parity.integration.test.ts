import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { teamArchiveFixture } from '../support/main-team-authority.fixture.js';
import { sealMainAuthorityArchive } from '../../src/modules/zones/main-authority-archive-codec.js';
import { projectMainArchivedPermissions } from '../../src/modules/zones/main-archived-permission-projection.js';
import { ZoneEntryAuthorizationService } from '../../src/modules/zones/zone-entry-authorization.service.js';
import { ZoneAuthorizationService } from '../../src/modules/zones/zone-authorization.service.js';
import { ZoneRestrictionPolicy } from '../../src/database/entities/enums.js';

const database = createIsolatedTestDatabase(),
  db = database.dataSource;
before(async () => {
  await database.initialize();
  const [actual]: { schema: string; migrations: number }[] = await db.query(
    'SELECT current_schema() AS schema,(SELECT count(*)::int FROM migrations) AS migrations',
  );
  assert.match(actual!.schema, /^isolated_test_[a-f0-9]{32}$/);
  assert.equal(actual!.migrations, 66, 'Parity fixture must use the retained Main66 release graph');
});
after(async () => {
  await database.dispose();
});
type Fixture = ReturnType<typeof teamArchiveFixture>;

async function seed(f: Fixture) {
  const actor = randomUUID();
  const archivedTeams: string[] = [];
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash,is_active,must_change_password) VALUES($1,$1::uuid::text,'Synthetic actor','unusable-test-hash',true,false)",
    [actor],
  );
  const extras: Record<string, Record<string, unknown>> = {
    SITE: { code: randomUUID(), name: 'Synthetic Site' },
    CONTRACTOR: { code: randomUUID(), name: 'Synthetic Contractor' },
    WORKER: { external_id: randomUUID(), display_name: 'Synthetic Worker' },
    ZONE_POLICY: { code: randomUUID(), name: 'Synthetic Zone', type: 'RESTRICTED' },
    ASSIGNMENT: { requested_by_user_id: actor },
    CONTRACTOR_PERMISSION: { granted_by: actor },
    WORKER_PERMISSION: { granted_by: actor },
    TEAM: { name: 'Synthetic Team', normalized_name: randomUUID(), created_by: actor },
    TEAM_MEMBERSHIP: { assigned_by: actor, reason: 'Synthetic fixture' },
    TEAM_PERMISSION: { granted_by: actor },
  };
  // Fixture insertion order follows real foreign keys, not archive serialization order.
  for (const kind of [
    'SITE',
    'CONTRACTOR',
    'WORKER',
    'ZONE_POLICY',
    'PARTICIPATION',
    'ASSIGNMENT',
    'CONTRACTOR_PERMISSION',
    'WORKER_PERMISSION',
    'ZONE_GRANT',
    'TEAM',
    'TEAM_MEMBERSHIP',
    'TEAM_PERMISSION',
  ]) {
    const source = f.payload.sources.find((s) => s.sourceKind === kind)!;
    assert.match(source.tableName, /^[a-z_]+$/);
    for (const row of source.rows) {
      const value = { ...row, ...extras[kind] },
        columns = Object.keys(value);
      // Main permits joining active teams only; archive after seeding membership.
      if (kind === 'TEAM' && value.is_active === false) {
        value.is_active = true;
        archivedTeams.push(value.id as string);
      }
      for (const column of columns) assert.match(column, /^[a-z_]+$/);
      await db.query(
        `INSERT INTO ${source.tableName} (${columns.join(',')}) VALUES(${columns.map((_, i) => '$' + (i + 1)).join(',')})`,
        Object.values(value),
      );
    }
  }
  for (const team of archivedTeams)
    await db.query('UPDATE contractor_team SET is_active=false WHERE id=$1', [team]);
}

async function compare(f: Fixture, expectedStatus: string) {
  const sealed = sealMainAuthorityArchive(f.payload, f.context);
  assert.equal(sealed.status, 'VALID');
  if (sealed.status !== 'VALID') throw Error('Invalid synthetic archive');
  await seed(f);
  const projected = projectMainArchivedPermissions(sealed.archive, {
    ...f.context,
    sha256: sealed.archive.sha256,
  });
  assert.equal(projected.status, 'PROJECTED');
  if (projected.status !== 'PROJECTED') throw Error('Projection unavailable');
  // Keep the exact retained Main SQL; replace only its Date parameter with the
  // original microsecond instant so the differential does not round boundaries.
  let originalSqlCalls = 0;
  const manager = new Proxy(db.manager, {
    get(target, key) {
      if (key === 'query')
        return (sql: string, parameters?: unknown[]) => {
          if (sql.includes('FROM worker_zone_permission wp')) {
            originalSqlCalls++;
            assert(sql.includes('FROM team_zone_permission tp'));
            assert.equal(parameters?.length, 5);
            return target.query(sql, [...parameters!.slice(0, 4), f.context.capturedAt]);
          }
          return target.query(sql, parameters);
        };
      const value: unknown = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const main = await new ZoneEntryAuthorizationService().decide(manager, {
    eventId: randomUUID(),
    siteId: f.context.siteId,
    zoneId: f.context.zoneId,
    verifiedWorkerId: f.context.workerId!,
    trackId: 1,
    evaluatedAt: new Date(f.context.capturedAt),
    restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
  });
  const archived = new ZoneAuthorizationService().authorizeActivePermissions(
    f.context.workerId!,
    projected.effects,
  );
  assert.equal(originalSqlCalls, 1);
  assert.equal(main.status, expectedStatus);
  assert.equal(archived.status, main.status);
  assert.equal(archived.reasonCode, main.reasonCode);
  assert.equal(projected.authorityCoverageEstablished, false);
  assert.equal(projected.identityEstablished, false);
}

for (const [name, mutate, expected] of [
  ['team only', () => {}, 'ALLOWED'],
  [
    'membership starts at event',
    (f: Fixture) => {
      f.row('TEAM_MEMBERSHIP').joined_at = f.context.capturedAt;
    },
    'ALLOWED',
  ],
  [
    'membership ends one microsecond later',
    (f: Fixture) => {
      f.row('TEAM_MEMBERSHIP').left_at = '2026-10-11T12:00:00.000002Z';
    },
    'ALLOWED',
  ],
  [
    'membership ends at event',
    (f: Fixture) => {
      f.row('TEAM_MEMBERSHIP').left_at = f.context.capturedAt;
    },
    'DENIED',
  ],
  [
    'team inactive',
    (f: Fixture) => {
      f.row('TEAM').is_active = false;
    },
    'DENIED',
  ],
  [
    'team permission revoked at event',
    (f: Fixture) => {
      f.row('TEAM_PERMISSION').revoked_at = f.context.capturedAt;
    },
    'DENIED',
  ],
  [
    'team permission expired at event',
    (f: Fixture) => {
      f.row('TEAM_PERMISSION').valid_until = f.context.capturedAt;
    },
    'DENIED',
  ],
  [
    'parent permission revoked',
    (f: Fixture) => {
      f.row('CONTRACTOR_PERMISSION').revoked_at = f.context.capturedAt;
    },
    'DENIED',
  ],
  [
    'assignment excludes Zone',
    (f: Fixture) => {
      f.row('ASSIGNMENT').zone_ids = [randomUUID()];
    },
    'DENIED',
  ],
  [
    'nonapproved assignment',
    (f: Fixture) => {
      f.row('ASSIGNMENT').status = 'PENDING';
    },
    'DENIED',
  ],
  [
    'team interval wider than active assignment',
    (f: Fixture) => {
      f.row('ASSIGNMENT').valid_from = '2026-10-11T11:00:00Z';
      f.row('ASSIGNMENT').valid_until = '2026-10-11T13:00:00Z';
    },
    'ALLOWED',
  ],
  [
    'independent DENY wins over team',
    (f: Fixture) => {
      f.deny();
    },
    'DENIED',
  ],
] as const)
  test(`real Main SQL and V2 archive agree: ${name}`, async () => {
    const fixture = teamArchiveFixture();
    mutate(fixture);
    await compare(fixture, expected);
  });
