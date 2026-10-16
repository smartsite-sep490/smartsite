import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, after, test } from 'node:test';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { ContractorTeamsService } from '../../src/modules/workforce/teams/contractor-teams.service.js';
import { UserRole } from '../../src/database/entities/user.entity.js';
import type { AuthenticatedUser } from '../../src/modules/auth/auth.service.js';
import { MainAuthorityBaselineService } from '../../src/modules/zones/main-authority-baseline.service.js';
import { MainAuthorityCapturedStateReader } from '../../src/modules/zones/main-authority-captured-state.reader.js';
import { projectMainArchivedPermissions } from '../../src/modules/zones/main-archived-permission-projection.js';

const database = createIsolatedTestDatabase({ canonical: true }),
  db = database.dataSource;
before(() => database.initialize());
after(() => database.dispose());

test('canonical registry captures team, membership, permission and assignment Zone membership without widening frozen V1', async () => {
  const sources = await db.query(
    "SELECT source_kind,fields FROM mf06_authority_source WHERE source_kind IN ('TEAM','TEAM_MEMBERSHIP','TEAM_PERMISSION','ASSIGNMENT') ORDER BY source_kind",
  );
  assert.deepEqual(
    sources.map((row: { source_kind: string }) => row.source_kind),
    ['ASSIGNMENT', 'TEAM', 'TEAM_MEMBERSHIP', 'TEAM_PERMISSION'],
  );
  assert.equal(sources[0].fields.includes('zone_ids'), true);
});

test('team source mutation and journal facts roll back together; unattributed changes never establish trust', async () => {
  const actor = randomUUID(),
    site = randomUUID(),
    contractor = randomUUID(),
    team = randomUUID();
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'Synthetic team actor','not-a-login-hash')",
    [actor],
  );
  await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic team Site')", [
    site,
  ]);
  await db.query(
    "INSERT INTO contractor(id,code,name) VALUES($1,$1::uuid::text,'Synthetic team Contractor')",
    [contractor],
  );
  await assert.rejects(
    db.transaction(async (manager) => {
      await manager.query(
        "INSERT INTO contractor_team(id,site_id,contractor_id,name,normalized_name,created_by) VALUES($1,$2,$3,'Synthetic team','synthetic team',$4)",
        [team, site, contractor, actor],
      );
      const facts = await manager.query(
        'SELECT command_id,source_kind FROM mf06_authority_fact WHERE source_id=$1',
        [team],
      );
      assert.deepEqual(facts, [{ command_id: null, source_kind: 'TEAM' }]);
      throw new Error('Synthetic rollback');
    }),
    /Synthetic rollback/,
  );
  assert.deepEqual(await db.query('SELECT id FROM contractor_team WHERE id=$1', [team]), []);
  assert.deepEqual(
    await db.query('SELECT fact_id FROM mf06_authority_fact WHERE source_id=$1', [team]),
    [],
  );
  await db.query(
    "INSERT INTO contractor_team(id,site_id,contractor_id,name,normalized_name,created_by) VALUES($1,$2,$3,'Synthetic team','synthetic team',$4)",
    [team, site, contractor, actor],
  );
  const gaps = await db.query('SELECT reason FROM mf06_authority_gap WHERE source_id=$1', [team]);
  assert(gaps.some((row: { reason: string }) => row.reason === 'UNATTRIBUTED_WRITE'));
  await db.query('UPDATE contractor_team SET is_active=false WHERE id=$1', [team]);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM mf06_authority_fact WHERE source_kind='TEAM' AND source_id=$1",
        [team],
      )
    )[0].n,
    2,
  );
});

async function commandFixture() {
  const site = randomUUID(),
    contractor = randomUUID(),
    admin = randomUUID(),
    rep = randomUUID(),
    worker = randomUUID(),
    zone = randomUUID(),
    participation = randomUUID(),
    cp = randomUUID();
  for (const id of [admin, rep])
    await db.query(
      "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'Synthetic authority actor','not-a-login-hash')",
      [id],
    );
  await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic team Site')", [
    site,
  ]);
  await db.query(
    "INSERT INTO contractor(id,code,name) VALUES($1,$1::uuid::text,'Synthetic team Contractor')",
    [contractor],
  );
  await db.query(
    "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'ADMIN',NULL),($3,$4,'CONTRACTOR_REPRESENTATIVE',$5)",
    [randomUUID(), admin, randomUUID(), rep, site],
  );
  await db.query(
    'INSERT INTO contractor_representative_assignment(id,user_id,site_id,contractor_id) VALUES($1,$2,$3,$4)',
    [randomUUID(), rep, site, contractor],
  );
  await db.query(
    "INSERT INTO contractor_site_participation(id,site_id,contractor_id,valid_from,valid_until) VALUES($1,$2,$3,clock_timestamp()-interval '2 days',clock_timestamp()+interval '30 days')",
    [participation, site, contractor],
  );
  await db.query(
    "INSERT INTO worker(id,site_id,contractor_id,external_id,display_name) VALUES($1,$2,$3,$1::uuid::text,'Synthetic team Worker')",
    [worker, site, contractor],
  );
  await db.query(
    "INSERT INTO zone(id,site_id,code,name,type,restriction_policy) VALUES($1,$2,$1::uuid::text,'Synthetic team Zone','RESTRICTED','AUTHORIZATION_REQUIRED')",
    [zone, site],
  );
  await db.query(
    'INSERT INTO contractor_zone_permission(id,site_contractor_id,zone_id,valid_from,valid_until,granted_by) SELECT $1,$2,$3,valid_from,valid_until,$4 FROM contractor_site_participation WHERE id=$2',
    [cp, participation, zone, admin],
  );
  await db.query(
    "INSERT INTO worker_site_zone_assignment(id,worker_id,site_id,site_contractor_id,zone_ids,status,valid_from,valid_until,requested_by_user_id) SELECT $1,$2,$3,$4,ARRAY[$5::uuid],'APPROVED',valid_from,valid_until,$6 FROM contractor_site_participation WHERE id=$4",
    [randomUUID(), worker, site, participation, zone, admin],
  );
  const actor: AuthenticatedUser = {
    id: rep,
    username: rep,
    displayName: 'Synthetic Representative',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [{ role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId: site }],
  };
  const service = new ContractorTeamsService(db);
  const created = await service.create(actor, site, contractor, {
    requestId: randomUUID(),
    name: randomUUID(),
  });
  const dates = (
    await db.query('SELECT current_date::text AS start,(current_date+6)::text AS until')
  )[0];
  return { site, contractor, admin, worker, zone, cp, actor, service, team: created.id, dates };
}

test('team calendar grants preserve parent microseconds and reject a changed exact retry', async () => {
  const f = await commandFixture();
  await db.query(
    "UPDATE contractor_zone_permission SET valid_from=current_date::timestamptz+interval '1 microsecond',valid_until=(current_date+5)::timestamptz+interval '9 microseconds' WHERE id=$1",
    [f.cp],
  );
  const input = {
    requestId: randomUUID(),
    contractorZonePermissionId: f.cp,
    startDate: f.dates.start,
    endDate: f.dates.until,
    timezone: 'UTC',
  };
  const granted = await f.service.grantZone(f.actor, f.site, f.contractor, f.team, input);
  const [bounds] = await db.query(
    'SELECT tp.valid_from=cp.valid_from AS same_from,tp.valid_until=cp.valid_until AS same_until FROM team_zone_permission tp JOIN contractor_zone_permission cp ON cp.id=tp.contractor_zone_permission_id WHERE tp.id=$1',
    [granted.id],
  );
  assert.deepEqual(bounds, { same_from: true, same_until: true });
  assert.deepEqual(
    await f.service.grantZone(f.actor, f.site, f.contractor, f.team, input),
    granted,
  );
  await db.query(
    "UPDATE contractor_zone_permission SET valid_from=valid_from+interval '1 microsecond' WHERE id=$1",
    [f.cp],
  );
  await assert.rejects(f.service.grantZone(f.actor, f.site, f.contractor, f.team, input), {
    status: 409,
  });
});

test('real team commands attribute facts and historical replay survives revoke and membership removal', async () => {
  const f = await commandFixture();
  const baseline = await new MainAuthorityBaselineService(db).capture(
    { actorUserId: f.admin, reauthorize: async () => undefined },
    'a'.repeat(64),
  );
  const membership = await f.service.assign(f.actor, f.site, f.contractor, f.worker, {
    requestId: randomUUID(),
    teamId: f.team,
    expectedMembershipId: null,
    reason: 'Synthetic membership',
  });
  const permission = await f.service.grantZone(f.actor, f.site, f.contractor, f.team, {
    requestId: randomUUID(),
    contractorZonePermissionId: f.cp,
    startDate: f.dates.start,
    endDate: f.dates.until,
    timezone: 'UTC',
  });
  const clock = async () =>
    (
      await db.query(
        `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at`,
      )
    )[0].at as string;
  const read = async (capturedAt: string) => {
    const context = {
      siteId: f.site,
      zoneId: f.zone,
      workerId: f.worker,
      capturedAt,
      purpose: 'RETROSPECTIVE_REVIEW' as const,
    };
    const result = await db.transaction('SERIALIZABLE', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      return new MainAuthorityCapturedStateReader().read(manager, {
        ...context,
        epochId: baseline.epochId,
      });
    });
    assert.equal(result.status, 'RECONSTRUCTED', JSON.stringify(result));
    if (result.status !== 'RECONSTRUCTED') throw Error('Expected reconstructed archive');
    const projected = projectMainArchivedPermissions(result.archive, {
      ...context,
      sha256: result.archive.sha256,
    });
    assert.equal(projected.status, 'PROJECTED');
    if (projected.status !== 'PROJECTED') throw Error('Expected private projection');
    assert.equal(projected.authorityCoverageEstablished, false);
    return projected.effects;
  };
  const at = await clock();
  assert.deepEqual(await read(at), ['ALLOW']);
  const facts = await db.query(
    'SELECT f.source_kind,c.actor_user_id,w.command_id IS NOT NULL AS witnessed FROM mf06_authority_fact f JOIN mf06_authority_command c USING(command_id) LEFT JOIN mf06_authority_commit_witness w USING(command_id) WHERE f.source_id=ANY($1::uuid[])',
    [[f.team, membership.membershipId, permission.id]],
  );
  assert.equal(facts.length, 3);
  assert(
    facts.every(
      (row: { actor_user_id: string; witnessed: boolean }) =>
        row.actor_user_id === f.actor.id && row.witnessed,
    ),
  );
  await f.service.revokeZone(f.actor, f.site, f.contractor, f.team, permission.id);
  await f.service.assign(f.actor, f.site, f.contractor, f.worker, {
    requestId: randomUUID(),
    teamId: null,
    expectedMembershipId: membership.membershipId,
    reason: 'Synthetic removal',
  });
  await f.service.archive(f.actor, f.site, f.contractor, f.team, {
    expectedVersion: 1,
    reason: 'Synthetic archive',
  });
  assert.deepEqual(await read(await clock()), []);
  assert.deepEqual(await read(at), ['ALLOW']);
});

test('team permission command failure rolls back permission, fact, head, audit and command together', async () => {
  const f = await commandFixture(),
    permission = randomUUID();
  const commands = (await db.query('SELECT count(*)::int AS n FROM mf06_authority_command'))[0].n;
  await db.query(
    "CREATE FUNCTION test_team_fact_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.source_kind='TEAM_PERMISSION' THEN RAISE EXCEPTION 'Synthetic team fact failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_team_fact_failure BEFORE INSERT ON mf06_authority_fact FOR EACH ROW EXECUTE FUNCTION test_team_fact_failure()",
  );
  try {
    await assert.rejects(
      f.service.grantZone(f.actor, f.site, f.contractor, f.team, {
        requestId: permission,
        contractorZonePermissionId: f.cp,
        startDate: f.dates.start,
        endDate: f.dates.until,
        timezone: 'UTC',
      }),
      /Synthetic team fact failure/,
    );
    for (const [table, column] of [
      ['team_zone_permission', 'id'],
      ['mf06_authority_fact', 'source_id'],
      ['mf06_authority_head', 'source_id'],
      ['audit_log', 'entity_id'],
    ]) {
      assert.deepEqual(
        await db.query(`SELECT ${column} FROM ${table} WHERE ${column}=$1`, [permission]),
        [],
      );
    }
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM mf06_authority_command'))[0].n,
      commands,
    );
  } finally {
    await db.query(
      'DROP TRIGGER test_team_fact_failure ON mf06_authority_fact; DROP FUNCTION test_team_fact_failure()',
    );
  }
});

test('role removal and cross-Site team commands are denied before writing authority attempts', async () => {
  const f = await commandFixture();
  const commands = (await db.query('SELECT count(*)::int AS n FROM mf06_authority_command'))[0].n;
  const forbidden = (error: unknown) =>
    (error as { getStatus?: () => number }).getStatus?.() === 403;
  await assert.rejects(
    f.service.create(f.actor, randomUUID(), f.contractor, {
      requestId: randomUUID(),
      name: 'Wrong scope',
    }),
    forbidden,
  );
  await db.query('DELETE FROM user_role_assignment WHERE user_id=$1', [f.actor.id]);
  await assert.rejects(
    f.service.create(f.actor, f.site, f.contractor, {
      requestId: randomUUID(),
      name: 'Revoked role',
    }),
    forbidden,
  );
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM mf06_authority_command'))[0].n,
    commands,
  );
});
