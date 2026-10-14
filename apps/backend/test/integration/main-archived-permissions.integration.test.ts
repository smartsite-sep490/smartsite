import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { MainAuthorityBaselineService } from '../../src/modules/zones/main-authority-baseline.service.js';
import { MainAuthorityCapturedStateReader } from '../../src/modules/zones/main-authority-captured-state.reader.js';
import { projectMainArchivedPermissions } from '../../src/modules/zones/main-archived-permission-projection.js';
import { ZoneEntryAuthorizationService } from '../../src/modules/zones/zone-entry-authorization.service.js';
import { ZoneAuthorizationService } from '../../src/modules/zones/zone-authorization.service.js';
import { ZoneRestrictionPolicy } from '../../src/database/entities/enums.js';
import { executeMainConfigurationCommand } from '../../src/common/configuration/main-configuration-authority.js';
const database = createIsolatedTestDatabase(),
  db = database.dataSource;
before(async () => {
  await database.initialize();
});
after(async () => {
  await database.dispose();
});
async function fixture() {
  const actor = randomUUID(),
    site = randomUUID(),
    zone = randomUUID(),
    worker = randomUUID(),
    contractor = randomUUID(),
    participation = randomUUID(),
    assignment = randomUUID(),
    cp = randomUUID(),
    wp = randomUUID();
  const from = new Date(Date.now() - 3600000).toISOString(),
    until = new Date(Date.now() + 3600000).toISOString();
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash,is_active,must_change_password) VALUES($1,$1::uuid::text,'Synthetic Admin','synthetic-unusable-hash',true,false)",
    [actor],
  );
  await db.query(
    "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'ADMIN',NULL)",
    [randomUUID(), actor],
  );
  await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Site')", [
    site,
  ]);
  await db.query(
    "INSERT INTO contractor(id,code,name,is_active) VALUES($1,$1::uuid::text,'Synthetic Contractor',true)",
    [contractor],
  );
  await db.query(
    "INSERT INTO worker(id,site_id,contractor_id,external_id,display_name,is_active) VALUES($1,$2,$3,$1::uuid::text,'Synthetic Worker',true)",
    [worker, site, contractor],
  );
  await db.query(
    "INSERT INTO zone(id,site_id,code,name,type,restriction_policy,required_ppe) VALUES($1,$2,$1::uuid::text,'Synthetic Zone','RESTRICTED','AUTHORIZATION_REQUIRED','{}')",
    [zone, site],
  );
  await db.query(
    'INSERT INTO contractor_site_participation(id,contractor_id,site_id,is_active,valid_from,valid_until) VALUES($1,$2,$3,true,$4::timestamptz,$5::timestamptz)',
    [participation, contractor, site, from, until],
  );
  await db.query(
    "INSERT INTO worker_site_zone_assignment(id,worker_id,site_id,site_contractor_id,zone_ids,requested_by_user_id,status,version,valid_from,valid_until) VALUES($1,$2,$3,$4,ARRAY[$5::uuid],$6,'APPROVED',1,$7::timestamptz,$8::timestamptz)",
    [assignment, worker, site, participation, zone, actor, from, until],
  );
  await db.query(
    'INSERT INTO contractor_zone_permission(id,site_contractor_id,zone_id,valid_from,valid_until,granted_by) VALUES($1,$2,$3,$4::timestamptz,$5::timestamptz,$6)',
    [cp, participation, zone, from, until, actor],
  );
  await db.query(
    'INSERT INTO worker_zone_permission(id,worker_assignment_id,contractor_zone_permission_id,valid_from,valid_until,granted_by) VALUES($1,$2,$3,$4::timestamptz,$5::timestamptz,$6)',
    [wp, assignment, cp, from, until, actor],
  );
  const context = { actorUserId: actor, reauthorize: async () => {} };
  const baseline = await new MainAuthorityBaselineService(db).capture(context, 'a'.repeat(64));
  return {
    actor,
    site,
    zone,
    worker,
    contractor,
    participation,
    assignment,
    cp,
    wp,
    from,
    until,
    context,
    baseline,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function archive(f: Fixture, exactAt?: string) {
  const at =
    exactAt ??
    ((
      await db.query(
        `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at`,
      )
    )[0].at as string);
  const context = {
    siteId: f.site,
    zoneId: f.zone,
    workerId: f.worker,
    capturedAt: at,
    purpose: 'RETROSPECTIVE_REVIEW' as const,
  };
  const read = await db.transaction('SERIALIZABLE', async (manager) => {
    await manager.query('SET TRANSACTION READ ONLY');
    return new MainAuthorityCapturedStateReader().read(manager, {
      ...context,
      epochId: f.baseline.epochId,
    });
  });
  assert.equal(read.status, 'RECONSTRUCTED');
  if (read.status !== 'RECONSTRUCTED') throw Error('Expected synthetic reconstructed archive');
  return { context, archive: read.archive };
}

async function rawSqlOracle(f: Fixture, capturedAt: string) {
  // Test adapter only: run the existing unmodified MAIN SQL with its native raw
  // timestamp parameter. The live current reader still accepts a millisecond Date.
  assert.equal(typeof capturedAt, 'string', 'Raw SQL oracle requires the actual timestamp text');
  const manager = new Proxy(db.manager, {
    get(target, key) {
      if (key === 'query')
        return (sql: string, parameters?: unknown[]) => {
          if (sql.includes('FROM worker_zone_permission wp')) {
            assert.equal(parameters?.length, 5);
            return target.query(sql, [...parameters!.slice(0, 4), capturedAt]);
          }
          return target.query(sql, parameters);
        };
      const value: unknown = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const result = await new ZoneEntryAuthorizationService().decide(manager, {
    eventId: randomUUID(),
    siteId: f.site,
    zoneId: f.zone,
    verifiedWorkerId: f.worker,
    trackId: 1,
    evaluatedAt: new Date(capturedAt),
    restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
  });
  return result;
}
function projection(saved: Awaited<ReturnType<typeof archive>>) {
  return projectMainArchivedPermissions(saved.archive, {
    ...saved.context,
    sha256: saved.archive.sha256,
  });
}
async function current(f: Fixture, at: string) {
  return new ZoneEntryAuthorizationService().decide(db.manager, {
    eventId: randomUUID(),
    siteId: f.site,
    zoneId: f.zone,
    verifiedWorkerId: f.worker,
    trackId: 1,
    evaluatedAt: new Date(at),
    restrictionPolicy: ZoneRestrictionPolicy.AUTHORIZATION_REQUIRED,
  });
}
async function checkParity(f: Fixture) {
  const saved = await archive(f),
    projected = projection(saved),
    main = await current(f, saved.context.capturedAt);
  if (projected.status === 'UNAVAILABLE') {
    assert.equal(main.status, 'UNAVAILABLE');
    return;
  }
  assert.equal(projected.authorityCoverageEstablished, false);
  assert.equal(projected.identityEstablished, false);
  // Test-only parity using a synthetic trusted Worker ID, never runtime admission.
  const decision = new ZoneAuthorizationService().authorizeActivePermissions(
    f.worker,
    projected.effects,
  );
  assert.equal(decision.status, main.status);
  assert.equal(decision.reasonCode, main.reasonCode);
}
test('canonical39 archived projection agrees with the existing MAIN SQL ALLOW chain', async () => {
  await checkParity(await fixture());
});
test('canonical39 independent DENY retains priority alongside the MAIN ALLOW chain', async () => {
  const f = await fixture();
  await executeMainConfigurationCommand(
    db,
    f.context,
    'ZONE_DENY_CREATE',
    { workerId: f.worker },
    async (manager) => {
      await manager.query(
        "INSERT INTO zone_access_grant(id,site_id,zone_id,worker_id,effect,valid_from,valid_until) VALUES($1,$2,$3,$4,'DENY',$5::timestamptz,$6::timestamptz)",
        [randomUUID(), f.site, f.zone, f.worker, f.from, f.until],
      );
    },
  );
  await checkParity(f);
});
test('inactive Contractor and pending assignment agree with MAIN without fabricating authority', async () => {
  for (const [kind, sql] of [
    ['contractor', 'UPDATE contractor SET is_active=false WHERE id=$1'],
    ['assignment', "UPDATE worker_site_zone_assignment SET status='PENDING' WHERE id=$1"],
  ] as const) {
    const f = await fixture();
    await executeMainConfigurationCommand(
      db,
      f.context,
      kind === 'contractor' ? 'CONTRACTOR_CREATE' : 'ASSIGNMENT_DECISION',
      { testOnly: kind },
      async (manager) => {
        await manager.query(sql, [f[kind]]);
      },
    );
    await checkParity(f);
  }
});
test('inactive Worker agrees with unavailable MAIN identity, not DENIED', async () => {
  const f = await fixture();
  await executeMainConfigurationCommand(
    db,
    f.context,
    'WORKER_ROSTER_CREATE',
    { testOnly: f.worker },
    async (manager) => {
      await manager.query('UPDATE worker SET is_active=false WHERE id=$1', [f.worker]);
    },
  );
  await checkParity(f);
});
test('historical permission projection stays ALLOW after current Contractor permission revocation', async () => {
  const f = await fixture(),
    saved = await archive(f);
  await executeMainConfigurationCommand(
    db,
    f.context,
    'CONTRACTOR_ZONE_REVOKE',
    { id: f.cp },
    async (manager) => {
      await manager.query(
        'UPDATE contractor_zone_permission SET revoked_at=clock_timestamp() WHERE id=$1',
        [f.cp],
      );
    },
  );
  const old = projection(saved);
  assert.equal(old.status, 'PROJECTED');
  if (old.status !== 'PROJECTED') throw Error('Expected private projection');
  assert.deepEqual(old.effects, ['ALLOW']);
  assert.equal(
    (await current(f, (await archive(f)).context.capturedAt)).reasonCode,
    'NO_VALID_ALLOW',
  );
  const latest = projection(await archive(f));
  assert.equal(latest.status, 'PROJECTED');
  if (latest.status !== 'PROJECTED') throw Error('Expected private projection');
  assert.deepEqual(latest.effects, []);
  assert.equal(
    (await db.query('SELECT epoch_id FROM mf06_authority_control WHERE singleton=1'))[0].epoch_id,
    null,
  );
});

test('archived ALLOW expiry at one microsecond agrees with native MAIN SQL at the raw point', async () => {
  const f = await fixture();
  const [point] = await db.query(
    `SELECT to_char((clock_timestamp()+interval '200 ms') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at`,
  );
  let until = '';
  await executeMainConfigurationCommand(
    db,
    f.context,
    'WORKER_ZONE_GRANT',
    { testOnly: 'micro-expiry' },
    async (manager) => {
      const [rows, affected]: [Array<{ until: string }>, number] = await manager.query(
        `UPDATE worker_zone_permission SET valid_until=$2::timestamptz+interval '1 microsecond' WHERE id=$1 RETURNING to_char(valid_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS until`,
        [f.wp, point.at],
      );
      // UPDATE RETURNING has [records, affected] in this TypeORM driver;
      // INSERT/SELECT return records directly. Do not silently use undefined.
      assert.equal(affected, 1);
      assert.equal(typeof rows[0]?.until, 'string');
      until = rows[0]!.until;
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 300));
  for (const [at, wanted] of [
    [point.at, ['ALLOW']],
    [until, []],
  ] as const) {
    const result = projection(await archive(f, at));
    assert.equal(result.status, 'PROJECTED');
    if (result.status !== 'PROJECTED') throw Error('Expected private projection');
    assert.deepEqual(result.effects, wanted);
    const sql = await rawSqlOracle(f, at);
    assert.equal(sql.reasonCode, wanted.length ? 'VALID_ALLOW' : 'NO_VALID_ALLOW');
  }
});

test('archived DENY starts and expires at native MAIN SQL microsecond boundaries', async () => {
  const f = await fixture();
  const [point] = await db.query(
    `SELECT to_char((clock_timestamp()+interval '200 ms') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at`,
  );
  let from = '',
    until = '';
  await executeMainConfigurationCommand(
    db,
    f.context,
    'ZONE_DENY_CREATE',
    { testOnly: 'micro-deny' },
    async (manager) => {
      const [row] = await manager.query(
        `INSERT INTO zone_access_grant(id,site_id,zone_id,worker_id,effect,valid_from,valid_until) VALUES($1,$2,$3,$4,'DENY',$5::timestamptz+interval '1 microsecond',$5::timestamptz+interval '2 microseconds') RETURNING to_char(valid_from AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS start,to_char(valid_until AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS finish`,
        [randomUUID(), f.site, f.zone, f.worker, point.at],
      );
      from = row.start as string;
      until = row.finish as string;
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 300));
  for (const [at, wanted] of [
    [point.at, ['ALLOW']],
    [from, ['ALLOW', 'DENY']],
    [until, ['ALLOW']],
  ] as const) {
    const result = projection(await archive(f, at));
    assert.equal(result.status, 'PROJECTED');
    if (result.status !== 'PROJECTED') throw Error('Expected private projection');
    assert.deepEqual(result.effects, wanted);
    const sql = await rawSqlOracle(f, at);
    assert.equal(
      sql.reasonCode,
      wanted.some((effect) => effect === 'DENY') ? 'EXPLICIT_DENY' : 'VALID_ALLOW',
    );
  }
});
