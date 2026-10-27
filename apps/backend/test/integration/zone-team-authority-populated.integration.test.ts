import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { ZoneTeamAuthorityHistory1792886400000 } from '../../src/database/migrations/1792886400000-ZoneTeamAuthorityHistory.js';
import { MainAuthorityBaselineService } from '../../src/modules/zones/main-authority-baseline.service.js';
import { MainAuthorityCapturedStateReader } from '../../src/modules/zones/main-authority-captured-state.reader.js';
import { executeMainConfigurationCommand } from '../../src/common/configuration/main-configuration-authority.js';

const database = createIsolatedTestDatabase(),
  db = database.dataSource;
before(() => database.initialize());
after(() => database.dispose());

test('additive team capture preserves populated epoch bytes, identities and historical reads', async () => {
  const actor = randomUUID(),
    site = randomUUID(),
    zone = randomUUID();
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash,is_active,must_change_password) VALUES($1,$1::uuid::text,'Synthetic Admin','unusable',true,false)",
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
    "INSERT INTO zone(id,site_id,code,name,type,restriction_policy,required_ppe) VALUES($1,$2,$1::uuid::text,'Synthetic Zone','RESTRICTED','AUTHORIZATION_REQUIRED','{}')",
    [zone, site],
  );
  const context = { actorUserId: actor, reauthorize: async () => {} };
  const baseline = await new MainAuthorityBaselineService(db).capture(context, 'a'.repeat(64));
  await executeMainConfigurationCommand(
    db,
    context,
    'ZONE_POLICY_UPDATE',
    { zoneId: zone, policy: 'NONE' },
    (manager) => manager.query("UPDATE zone SET restriction_policy='NONE' WHERE id=$1", [zone]),
  );
  const [clock] = (await db.query(
    `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') at`,
  )) as { at: string }[];
  const input = {
    epochId: baseline.epochId,
    siteId: site,
    zoneId: zone,
    workerId: null,
    capturedAt: clock!.at,
    purpose: 'RETROSPECTIVE_REVIEW' as const,
  };
  const read = () =>
    db.transaction('SERIALIZABLE', async (manager) => {
      await manager.query('SET TRANSACTION READ ONLY');
      return new MainAuthorityCapturedStateReader().read(manager, input);
    });
  const prior = await read();
  assert.equal(prior.status, 'RECONSTRUCTED');
  const history = async () => ({
    baseline: await db.query(
      'SELECT to_jsonb(b)::text body FROM authorization_history_baseline b ORDER BY epoch_id',
    ),
    facts: await db.query(
      'SELECT to_jsonb(f)::text body FROM authorization_history_revision f ORDER BY fact_id',
    ),
    registry: await db.query(
      'SELECT to_jsonb(s)::text body FROM authorization_history_source s ORDER BY source_kind',
    ),
    identity: await db.query("SELECT 'authorization_history_baseline'::regclass::oid::text oid"),
  });
  const original = await history();
  assert.equal(original.baseline.length, 1);
  assert(original.facts.length > 0);
  const runner = db.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await new ZoneTeamAuthorityHistory1792886400000().up(runner);
    await runner.commitTransaction();
  } catch (error) {
    await runner.rollbackTransaction();
    throw error;
  } finally {
    await runner.release();
  }
  assert.notEqual(
    (await db.query("SELECT to_regclass('zone_team_authority_revision') AS relation"))[0].relation,
    null,
    'Candidate must actually execute, rather than silently skip the current namespace',
  );
  assert.deepEqual(await history(), original);
  const reconstructed = await read();
  assert.equal(reconstructed.status, 'RECONSTRUCTED');
  if (reconstructed.status !== 'RECONSTRUCTED') return;
  assert.equal(reconstructed.authorityCoverageEstablished, false);
  assert.equal(reconstructed.identityEstablished, false);
  if (prior.status !== 'RECONSTRUCTED') return;
  assert.deepEqual(reconstructed.archive.payload.sources, prior.archive.payload.sources);
  assert.deepEqual(reconstructed.archive.payload.baseline, prior.archive.payload.baseline);
  const policy = reconstructed.archive.payload.sources
    .find((source) => source.sourceKind === 'ZONE_POLICY')!
    .rows.find((row) => row.id === zone)!;
  assert.equal(policy.restriction_policy, 'NONE');
  assert.equal(
    await db.showMigrations(),
    false,
    'Unregistered candidate never enters the runtime migration graph',
  );
});
