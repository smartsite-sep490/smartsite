import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { ErdVisitorAccess1791504000000 } from '../../src/database/migrations/1791504000000-ErdVisitorAccess.js';
import { QrAccess1791417600000 } from '../../src/database/migrations/1791417600000-QrAccess.js';
import { ErdZonePermissions1791504000003 } from '../../src/database/migrations/1791504000003-ErdZonePermissions.js';
import { ZoneEntryAuthorizationService } from '../../src/modules/zones/zone-entry-authorization.service.js';
import { ZoneRestrictionPolicy } from '../../src/database/entities/enums.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

const database = createIsolatedTestDatabase({ legacy: true }),
  db = database.dataSource;
const service = new ZoneEntryAuthorizationService();
const evaluatedAt = new Date('2026-10-11T12:00:00.000Z');
before(async () => {
  await database.initialize();
  const runner = db.createQueryRunner();
  try {
    await runner.startTransaction();
    // Exact retained-main DDL, intentionally not registered on the unreconciled graph.
    await new QrAccess1791417600000().up(runner);
    await new ErdVisitorAccess1791504000000().up(runner);
    await new ErdZonePermissions1791504000003().up(runner);
    await runner.commitTransaction();
  } catch (error) {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    throw error;
  } finally {
    await runner.release();
  }
});
after(() => database.dispose());

async function fixture() {
  const site = randomUUID(),
    contractor = randomUUID(),
    worker = randomUUID(),
    actor = randomUUID(),
    zone = randomUUID();
  const participation = randomUUID(),
    assignment = randomUUID(),
    cp = randomUUID(),
    wp = randomUUID();
  await db.query('INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,$1::uuid::text)', [site]);
  await db.query('INSERT INTO contractor(id,code,name) VALUES($1,$1::uuid::text,$1::uuid::text)', [
    contractor,
  ]);
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'Synthetic actor','not-a-runtime-password')",
    [actor],
  );
  await db.query(
    "INSERT INTO worker(id,site_id,contractor_id,external_id,display_name) VALUES($1,$2,$3,$1::uuid::text,'Synthetic worker')",
    [worker, site, contractor],
  );
  await db.query(
    "INSERT INTO zone(id,site_id,code,name,type,restriction_policy) VALUES($1,$2,$1::uuid::text,'Synthetic Zone','RESTRICTED','AUTHORIZATION_REQUIRED')",
    [zone, site],
  );
  await db.query(
    `INSERT INTO contractor_site_participation(id,contractor_id,site_id,valid_from,valid_until,is_active)
    VALUES($1,$2,$3,'2026-10-11T00:00:00Z','2026-10-12T00:00:00Z',true)`,
    [participation, contractor, site],
  );
  await db.query(
    `INSERT INTO worker_site_zone_assignment(id,worker_id,contractor_id,site_id,zone_ids,status,valid_from,valid_until,requested_by_user_id,site_contractor_id)
    VALUES($1,$2,$3,$4,ARRAY[$5::uuid],'APPROVED','2026-10-11T01:00:00Z','2026-10-11T23:00:00Z',$6,$7)`,
    [assignment, worker, contractor, site, zone, actor, participation],
  );
  await db.query(
    `INSERT INTO contractor_zone_permission(id,site_contractor_id,zone_id,valid_from,valid_until,granted_by)
    VALUES($1,$2,$3,'2026-10-11T02:00:00Z','2026-10-11T22:00:00Z',$4)`,
    [cp, participation, zone, actor],
  );
  await db.query(
    `INSERT INTO worker_zone_permission(id,worker_assignment_id,contractor_zone_permission_id,valid_from,valid_until,granted_by)
    VALUES($1,$2,$3,'2026-10-11T03:00:00Z','2026-10-11T21:00:00Z',$4)`,
    [wp, assignment, cp, actor],
  );
  return { site, contractor, worker, actor, zone, participation, assignment, cp, wp };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function decide(f: Fixture, overrides = {}) {
  return service.decide(db.manager, {
    eventId: randomUUID(),
    siteId: f.site,
    zoneId: f.zone,
    verifiedWorkerId: f.worker,
    trackId: 1,
    evaluatedAt,
    restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
    ...overrides,
  });
}

test('main anchored chain allows without a flat grant and DENY retains priority', async () => {
  const f = await fixture();
  assert.equal((await decide(f)).reasonCode, 'VALID_ALLOW');
  await db.query(
    `INSERT INTO zone_access_grant(id,site_id,zone_id,worker_id,effect,valid_from,valid_until)
    VALUES($1,$2,$3,$4,'DENY','2026-10-11T11:00:00Z','2026-10-11T13:00:00Z')`,
    [randomUUID(), f.site, f.zone, f.worker],
  );
  assert.equal((await decide(f)).reasonCode, 'EXPLICIT_DENY');
});

for (const [name, sql, key] of [
  ['inactive Worker', 'UPDATE worker SET is_active=false WHERE id=$1', 'worker'],
  ['inactive Contractor', 'UPDATE contractor SET is_active=false WHERE id=$1', 'contractor'],
  [
    'inactive participation',
    'UPDATE contractor_site_participation SET is_active=false WHERE id=$1',
    'participation',
  ],
  [
    'pending assignment',
    "UPDATE worker_site_zone_assignment SET status='PENDING' WHERE id=$1",
    'assignment',
  ],
  [
    'safety-reviewed-only assignment',
    "UPDATE worker_site_zone_assignment SET status='SAFETY_REVIEWED' WHERE id=$1",
    'assignment',
  ],
  [
    'cancelled assignment',
    "UPDATE worker_site_zone_assignment SET status='CANCELLED' WHERE id=$1",
    'assignment',
  ],
  [
    'open-ended assignment',
    'UPDATE worker_site_zone_assignment SET valid_until=NULL WHERE id=$1',
    'assignment',
  ],
  [
    'expired worker permission',
    "UPDATE worker_zone_permission SET valid_until='2026-10-11T12:00:00Z' WHERE id=$1",
    'wp',
  ],
  [
    'future worker permission',
    "UPDATE worker_zone_permission SET valid_from='2026-10-11T12:00:00.001Z' WHERE id=$1",
    'wp',
  ],
  [
    'worker permission before assignment',
    "UPDATE worker_zone_permission SET valid_from='2026-10-11T00:30:00Z' WHERE id=$1",
    'wp',
  ],
  [
    'worker permission beyond Contractor permission',
    "UPDATE worker_zone_permission SET valid_until='2026-10-11T22:30:00Z' WHERE id=$1",
    'wp',
  ],
  [
    'worker permission beyond participation',
    "UPDATE contractor_site_participation SET valid_until='2026-10-11T20:00:00Z' WHERE id=$1",
    'participation',
  ],
  [
    'Contractor permission revoked at entry',
    "UPDATE contractor_zone_permission SET revoked_at='2026-10-11T12:00:00Z' WHERE id=$1",
    'cp',
  ],
  [
    'Worker permission revoked at entry',
    "UPDATE worker_zone_permission SET revoked_at='2026-10-11T12:00:00Z' WHERE id=$1",
    'wp',
  ],
] as const) {
  test(`${name} cannot inherit ALLOW from an otherwise valid chain`, async () => {
    const f = await fixture();
    assert.equal((await decide(f)).status, 'ALLOWED');
    await db.query(sql, [f[key]]);
    const result = await decide(f);
    assert.notEqual(result.status, 'ALLOWED');
    assert.equal(result.reasonCode, key === 'worker' ? 'IDENTITY_UNAVAILABLE' : 'NO_VALID_ALLOW');
  });
}

test('different Contractor participation anchors cannot be joined into ALLOW', async () => {
  const f = await fixture(),
    other = await fixture();
  await db.query('UPDATE contractor_zone_permission SET site_contractor_id=$2 WHERE id=$1', [
    f.cp,
    other.participation,
  ]);
  assert.equal((await decide(f)).reasonCode, 'NO_VALID_ALLOW');
});

test('wrong Site, Zone, current Contractor or identity candidate never becomes permission', async () => {
  const f = await fixture(),
    other = await fixture();
  assert.equal((await decide(f, { siteId: other.site })).status, 'UNAVAILABLE');
  assert.equal((await decide(f, { zoneId: other.zone })).reasonCode, 'NO_VALID_ALLOW');
  assert.equal(
    (await decide(f, { verifiedWorkerId: undefined, candidateWorkerId: f.worker })).reasonCode,
    'IDENTITY_UNAVAILABLE',
  );
  await db.query('UPDATE worker SET contractor_id=$2 WHERE id=$1', [f.worker, other.contractor]);
  assert.equal((await decide(f)).reasonCode, 'NO_VALID_ALLOW');
});

test('entry at validFrom is included and revocation after entry is not retroactive', async () => {
  const f = await fixture();
  await db.query(
    "UPDATE worker_zone_permission SET valid_from=$2,revoked_at='2026-10-11T12:00:00.001Z' WHERE id=$1",
    [f.wp, evaluatedAt],
  );
  assert.equal((await decide(f)).reasonCode, 'VALID_ALLOW');
});

test('known empty anchored permissions are denied even when a legacy flat ALLOW exists', async () => {
  const f = await fixture();
  await db.query('DELETE FROM worker_zone_permission WHERE id=$1', [f.wp]);
  await db.query(
    `INSERT INTO zone_access_grant(id,site_id,zone_id,worker_id,effect,valid_from,valid_until)
    VALUES($1,$2,$3,$4,'ALLOW','2026-10-11T00:00:00Z','2026-10-12T00:00:00Z')`,
    [randomUUID(), f.site, f.zone, f.worker],
  );
  assert.equal((await decide(f)).reasonCode, 'NO_VALID_ALLOW');
});

test('submillisecond permission expiry is still after entry', async () => {
  const f = await fixture();
  await db.query(
    "UPDATE worker_zone_permission SET valid_until='2026-10-11T12:00:00.000001Z' WHERE id=$1",
    [f.wp],
  );
  assert.equal((await decide(f)).reasonCode, 'VALID_ALLOW');
});

for (const [label, from, until, revoked, expected] of [
  ['future deny', '2026-10-11T12:00:00.000001Z', '2026-10-11T13:00:00Z', null, 'VALID_ALLOW'],
  [
    'deny expires just after entry',
    '2026-10-11T11:00:00Z',
    '2026-10-11T12:00:00.000001Z',
    null,
    'EXPLICIT_DENY',
  ],
  [
    'deny revoked just after entry',
    '2026-10-11T11:00:00Z',
    '2026-10-11T13:00:00Z',
    '2026-10-11T12:00:00.000001Z',
    'EXPLICIT_DENY',
  ],
] as const) {
  test(`submillisecond ${label} retains PostgreSQL temporal precision`, async () => {
    const f = await fixture();
    await db.query(
      `INSERT INTO zone_access_grant(id,site_id,zone_id,worker_id,effect,valid_from,valid_until,revoked_at)
       VALUES($1,$2,$3,$4,'DENY',$5,$6,$7)`,
      [randomUUID(), f.site, f.zone, f.worker, from, until, revoked],
    );
    assert.equal((await decide(f)).reasonCode, expected);
  });
}

test('nonfinite deny time cannot silently clear an otherwise active deny', async () => {
  const f = await fixture();
  await db.query(
    `INSERT INTO zone_access_grant(id,site_id,zone_id,worker_id,effect,valid_from,valid_until)
     VALUES($1,$2,$3,$4,'DENY','infinity',NULL)`,
    [randomUUID(), f.site, f.zone, f.worker],
  );
  assert.equal((await decide(f)).reasonCode, 'AUTHORIZATION_DATA_UNAVAILABLE');
});

test('nonfinite assignment end is not the required finite approved assignment', async () => {
  const f = await fixture();
  await db.query("UPDATE worker_site_zone_assignment SET valid_until='infinity' WHERE id=$1", [
    f.assignment,
  ]);
  assert.equal((await decide(f)).reasonCode, 'NO_VALID_ALLOW');
});
