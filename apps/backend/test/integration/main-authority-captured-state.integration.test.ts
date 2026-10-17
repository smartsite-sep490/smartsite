import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { EntityManager } from 'typeorm';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { MainAuthorityBaselineService } from '../../src/modules/zones/main-authority-baseline.service.js';
import { executeMainConfigurationCommand } from '../../src/common/configuration/main-configuration-authority.js';
import type { MainAuthorityArchive } from '../../src/modules/zones/main-authority-archive-codec.js';

const database = createIsolatedTestDatabase(),
  db = database.dataSource;
before(async () => {
  await database.initialize();
});
after(async () => {
  await database.dispose();
});
interface Result {
  status: string;
  reason?: string;
  archive?: MainAuthorityArchive;
  authorityCoverageEstablished?: false;
  identityEstablished?: false;
}
async function reader() {
  // The missing reader is a positive capability RED, not a compile-only failure.
  const file = '../../src/modules/zones/main-authority-captured-state.reader.js';
  const module = (await import(file).catch((error: { code?: string }) => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
    throw error;
  })) as {
    MainAuthorityCapturedStateReader?: new () => {
      read(manager: EntityManager, input: object): Promise<Result>;
    };
  };
  assert.equal(
    typeof module.MainAuthorityCapturedStateReader,
    'function',
    'Main captured-state reader must exist',
  );
  return new module.MainAuthorityCapturedStateReader!();
}
async function now() {
  return (
    await db.query(
      `SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at`,
    )
  )[0].at as string;
}
async function fixture() {
  const actor = randomUUID(),
    site = randomUUID(),
    zone = randomUUID();
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
    "INSERT INTO zone(id,site_id,code,name,type,restriction_policy,required_ppe) VALUES($1,$2,$1::uuid::text,'Synthetic Zone','RESTRICTED','AUTHORIZATION_REQUIRED','{}')",
    [zone, site],
  );
  const context = { actorUserId: actor, reauthorize: async () => {} };
  const baseline = await new MainAuthorityBaselineService(db).capture(context, 'a'.repeat(64));
  const input = (capturedAt: string) => ({
    epochId: baseline.epochId,
    siteId: site,
    zoneId: zone,
    workerId: null,
    capturedAt,
    purpose: 'RETROSPECTIVE_REVIEW',
  });
  return { actor, site, zone, context, baseline, input };
}
async function read(input: object) {
  const service = await reader();
  return db.transaction('SERIALIZABLE', async (manager) => {
    await manager.query('SET TRANSACTION READ ONLY');
    return service.read(manager, input);
  });
}
function policy(result: Result, zone: string) {
  assert.equal(result.status, 'RECONSTRUCTED');
  assert.equal(result.authorityCoverageEstablished, false);
  assert.equal(result.identityEstablished, false);
  return result
    .archive!.payload.sources.find((s) => s.sourceKind === 'ZONE_POLICY')!
    .rows.find((r) => r.id === zone)!.restriction_policy;
}
async function change(f: Awaited<ReturnType<typeof fixture>>) {
  await executeMainConfigurationCommand(
    db,
    f.context,
    'ZONE_POLICY_UPDATE',
    { zoneId: f.zone, policy: 'NONE' },
    async (manager) => {
      await manager.query("UPDATE zone SET restriction_policy='NONE' WHERE id=$1", [f.zone]);
    },
  );
}
test('reconstructs canonical MAIN baseline after witness without READY or identity', async () => {
  const f = await fixture();
  const result = await read(f.input(await now()));
  assert.equal(policy(result, f.zone), 'AUTHORIZATION_REQUIRED');
  assert.equal(
    (await db.query('SELECT epoch_id FROM authorization_history_control WHERE singleton=1'))[0]
      .epoch_id,
    null,
  );
  assert.equal(
    (
      await db.query('SELECT state FROM authorization_history_epoch WHERE epoch_id=$1', [
        f.baseline.epochId,
      ])
    )[0].state,
    'STAGING',
  );
});
test('historical policy remains old while current policy changes, with exact post-witness state', async () => {
  const f = await fixture(),
    prior = await now();
  await change(f);
  assert.equal(policy(await read(f.input(prior)), f.zone), 'AUTHORIZATION_REQUIRED');
  assert.equal(policy(await read(f.input(await now())), f.zone), 'NONE');
});
test('does not round the observed/witness uncertainty boundary through JS Date', async () => {
  const f = await fixture();
  await change(f);
  const [fact] = await db.query(
    `SELECT to_char(f.observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS observed,to_char(w.confirmed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS confirmed FROM authorization_history_revision f JOIN authorization_history_commit_receipt w USING(command_id) WHERE f.source_id=$1 ORDER BY f.revision DESC LIMIT 1`,
    [f.zone],
  );
  assert.equal((await read(f.input(fact.observed))).reason, 'COMMIT_TIME_UNCERTAIN');
  assert.equal(policy(await read(f.input(fact.confirmed)), f.zone), 'NONE');
});
test('raw unattributed change yields a gap without rewriting earlier captured state', async () => {
  const f = await fixture(),
    prior = await now();
  await db.query("UPDATE zone SET restriction_policy='NONE' WHERE id=$1", [f.zone]);
  assert.equal(policy(await read(f.input(prior)), f.zone), 'AUTHORIZATION_REQUIRED');
  assert.equal((await read(f.input(await now()))).reason, 'HISTORY_GAP');
});
test('attributed committed row without a post-commit witness is unavailable', async () => {
  const f = await fixture();
  await db.transaction('SERIALIZABLE', async (manager) => {
    const command = randomUUID();
    await manager.query(
      "INSERT INTO authorization_history_command(command_id,actor_user_id,operation,request_hash) VALUES($1,$2,'ZONE_POLICY_UPDATE',$3)",
      [command, f.actor, 'b'.repeat(64)],
    );
    await manager.query("SELECT set_config('smartsite.mf06_command_id',$1,true)", [command]);
    await manager.query("UPDATE zone SET restriction_policy='NONE' WHERE id=$1", [f.zone]);
  });
  assert.equal((await read(f.input(await now()))).reason, 'COMMIT_TIME_UNCERTAIN');
});
test('disabled capture does not permit apparently clean reconstructed metadata', async () => {
  const f = await fixture();
  await db.query('ALTER TABLE zone DISABLE TRIGGER trg_mf06_capture_zone');
  try {
    assert.equal((await read(f.input(await now()))).reason, 'CAPTURE_UNAVAILABLE');
  } finally {
    await db.query('ALTER TABLE zone ENABLE TRIGGER trg_mf06_capture_zone');
  }
});
test('rejects invalid raw time, wrong scope and pre-baseline context', async () => {
  const f = await fixture();
  assert.equal(
    (await read({ ...f.input(await now()), capturedAt: '2026-02-30T01:00:00.000001Z' })).reason,
    'INVALID_SCOPE',
  );
  assert.equal(
    (await read({ ...f.input(await now()), siteId: randomUUID() })).reason,
    'SOURCE_SCOPE_MISMATCH',
  );
  assert.equal((await read(f.input('2020-01-01T00:00:00.000001Z'))).reason, 'PRE_BASELINE');
});
test('does not accept a non-transactional or non-serializable current state read', async () => {
  const f = await fixture(),
    service = await reader();
  assert.equal(
    (await service.read(db.manager, f.input(await now()))).reason,
    'TRANSACTION_REQUIRED',
  );
  await db.transaction('READ COMMITTED', async (manager) =>
    assert.equal(
      (await service.read(manager, f.input(await now()))).reason,
      'SNAPSHOT_TRANSACTION_REQUIRED',
    ),
  );
});

test('an observation newer than the transaction snapshot cannot use an older MVCC state', async () => {
  const f = await fixture(),
    service = await reader();
  await db.transaction('SERIALIZABLE', async (manager) => {
    await manager.query('SET TRANSACTION READ ONLY');
    await manager.query('SELECT 1 FROM zone LIMIT 1');
    // A separate command commits while this caller keeps its older MVCC snapshot.
    await change(f);
    const captured = await now();
    const result = await service.read(manager, f.input(captured));
    assert.equal(result.status, 'UNAVAILABLE');
    assert.equal(result.reason, 'OBSERVATION_AFTER_TRANSACTION_START');
  });
});

test('deleted historical rows stay absent until a witnessed recreation with the same ID', async () => {
  const f = await fixture();
  await executeMainConfigurationCommand(
    db,
    f.context,
    'ZONE_POLICY_UPDATE',
    { delete: f.zone },
    async (manager) => {
      await manager.query('DELETE FROM zone WHERE id=$1', [f.zone]);
    },
  );
  const deletedAt = await now();
  assert.equal((await read(f.input(deletedAt))).reason, 'SOURCE_SCOPE_MISMATCH');
  await executeMainConfigurationCommand(
    db,
    f.context,
    'ZONE_CREATE',
    { id: f.zone },
    async (manager) => {
      await manager.query(
        "INSERT INTO zone(id,site_id,code,name,type,restriction_policy,required_ppe) VALUES($1,$2,$1::uuid::text,'Synthetic Recreated Zone','RESTRICTED','NONE','{}')",
        [f.zone, f.site],
      );
    },
  );
  assert.equal((await read(f.input(deletedAt))).reason, 'SOURCE_SCOPE_MISMATCH');
  assert.equal(policy(await read(f.input(await now())), f.zone), 'NONE');
});
