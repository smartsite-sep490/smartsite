import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { EntityManager } from 'typeorm';
import { QrAccess1791417600000 } from '../../src/database/migrations/1791417600000-QrAccess.js';
import { ErdVisitorAccess1791504000000 } from '../../src/database/migrations/1791504000000-ErdVisitorAccess.js';
import { ErdZonePermissions1791504000003 } from '../../src/database/migrations/1791504000003-ErdZonePermissions.js';
import { Mf06MainAuthorityJournal1791590400002 } from '../../src/database/migrations/1791590400002-Mf06MainAuthorityJournal.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

const database = createIsolatedTestDatabase({ legacy: true }),
  db = database.dataSource;
const candidate = new Mf06MainAuthorityJournal1791590400002();
async function prepare(base: ReturnType<typeof createIsolatedTestDatabase>) {
  await base.initialize();
  const runner = base.dataSource.createQueryRunner();
  try {
    await runner.startTransaction();
    await new QrAccess1791417600000().up(runner);
    await new ErdVisitorAccess1791504000000().up(runner);
    await new ErdZonePermissions1791504000003().up(runner);
    // Minimal retained-main prerequisite shape, not a full main upgrade claim.
    await runner.query(
      'ALTER TABLE site ADD COLUMN access_policy_version integer NOT NULL DEFAULT 1',
    );
    await runner.commitTransaction();
  } catch (error) {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    throw error;
  } finally {
    await runner.release();
  }
}
before(async () => {
  await prepare(database);
  const runner = db.createQueryRunner();
  try {
    await runner.startTransaction();
    await candidate.up(runner);
    await runner.commitTransaction();
  } catch (error) {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    throw error;
  } finally {
    await runner.release();
  }
});

async function graph() {
  const ids = {
    site: randomUUID(),
    contractor: randomUUID(),
    worker: randomUUID(),
    actor: randomUUID(),
    participation: randomUUID(),
    assignment: randomUUID(),
    cp: randomUUID(),
    wp: randomUUID(),
    deny: randomUUID(),
    zone: randomUUID(),
    camera: randomUUID(),
    region: randomUUID(),
  };
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash,must_change_password) VALUES($1,$1::uuid::text,'Synthetic actor','not-runtime-password',false)",
    [ids.actor],
  );
  await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Site')", [
    ids.site,
  ]);
  await db.query(
    "INSERT INTO contractor(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Contractor')",
    [ids.contractor],
  );
  await db.query(
    "INSERT INTO worker(id,site_id,contractor_id,external_id,display_name) VALUES($1,$2,$3,$1::uuid::text,'Synthetic Worker')",
    [ids.worker, ids.site, ids.contractor],
  );
  await db.query(
    "INSERT INTO zone(id,site_id,code,name,type,restriction_policy) VALUES($1,$2,$1::uuid::text,'Synthetic Zone','RESTRICTED','AUTHORIZATION_REQUIRED')",
    [ids.zone, ids.site],
  );
  await db.query(
    "INSERT INTO contractor_site_participation(id,site_id,contractor_id,valid_from,valid_until) VALUES($1,$2,$3,'2026-10-01Z','2026-11-01Z')",
    [ids.participation, ids.site, ids.contractor],
  );
  await db.query(
    "INSERT INTO worker_site_zone_assignment(id,worker_id,site_id,contractor_id,site_contractor_id,zone_ids,status,valid_from,valid_until,requested_by_user_id) VALUES($1,$2,$3,$4,$5,ARRAY[$6::uuid],'APPROVED','2026-10-01Z','2026-11-01Z',$7)",
    [ids.assignment, ids.worker, ids.site, ids.contractor, ids.participation, ids.zone, ids.actor],
  );
  await db.query(
    "INSERT INTO contractor_zone_permission(id,site_contractor_id,zone_id,valid_from,valid_until,granted_by) VALUES($1,$2,$3,'2026-10-01Z','2026-11-01Z',$4)",
    [ids.cp, ids.participation, ids.zone, ids.actor],
  );
  await db.query(
    "INSERT INTO worker_zone_permission(id,worker_assignment_id,contractor_zone_permission_id,valid_from,valid_until,granted_by) VALUES($1,$2,$3,'2026-10-01Z','2026-11-01Z',$4)",
    [ids.wp, ids.assignment, ids.cp, ids.actor],
  );
  await db.query(
    "INSERT INTO zone_access_grant(id,site_id,zone_id,worker_id,effect,valid_from,valid_until) VALUES($1,$2,$3,$4,'DENY','2026-10-01Z','2026-11-01Z')",
    [ids.deny, ids.site, ids.zone, ids.worker],
  );
  await db.query(
    "INSERT INTO camera(id,site_id,external_id,code,name) VALUES($1,$2,$1::uuid::text,$1::uuid::text,'Synthetic camera')",
    [ids.camera, ids.site],
  );
  await db.query(
    "INSERT INTO camera_observation_region(id,camera_id,zone_id,polygon,coordinate_space) VALUES($1,$2,$3,$4,'NORMALIZED_0_1')",
    [
      ids.region,
      ids.camera,
      ids.zone,
      JSON.stringify([
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ]),
    ],
  );
  return ids;
}
async function command(manager: EntityManager, actor: string, id = randomUUID()) {
  await manager.query(
    "INSERT INTO mf06_authority_command(command_id,actor_user_id,operation,request_hash) VALUES($1,$2,'SYNTHETIC_TEST',$3)",
    [id, actor, 'a'.repeat(64)],
  );
  await manager.query("SELECT set_config('smartsite.mf06_command_id',$1,true)", [id]);
  return id;
}
async function rejection(action: Promise<unknown>, code = '23514') {
  await assert.rejects(action, (error: unknown) => (error as { code?: string }).code === code);
}

test('retained-main sources include representative membership metadata and relevant revisions', async () => {
  const f = await graph();
  const kinds = (
    await db.query('SELECT source_kind FROM mf06_authority_source ORDER BY source_kind')
  ).map((r: { source_kind: string }) => r.source_kind);
  assert.deepEqual(kinds, [
    'ASSIGNMENT',
    'CAMERA',
    'CONTRACTOR',
    'CONTRACTOR_PERMISSION',
    'PARTICIPATION',
    'REGION',
    'REPRESENTATIVE_ASSIGNMENT',
    'REPRESENTATIVE_GRANT',
    'SITE',
    'USER_ACCOUNT',
    'USER_ROLE',
    'WORKER',
    'WORKER_PERMISSION',
    'ZONE_GRANT',
    'ZONE_POLICY',
  ]);
  const changes = [
    ['SITE', 'site', 'access_policy_version=access_policy_version+1', f.site],
    ['WORKER', 'worker', 'is_active=false', f.worker],
    ['CONTRACTOR', 'contractor', 'is_active=false', f.contractor],
    ['PARTICIPATION', 'contractor_site_participation', 'is_active=false', f.participation],
    [
      'ASSIGNMENT',
      'worker_site_zone_assignment',
      "status='CANCELLED',version=version+1",
      f.assignment,
    ],
    [
      'CONTRACTOR_PERMISSION',
      'contractor_zone_permission',
      "revoked_at='2026-10-11T12:00:00.000001Z'",
      f.cp,
    ],
    [
      'WORKER_PERMISSION',
      'worker_zone_permission',
      "revoked_at='2026-10-11T12:00:00.000001Z'",
      f.wp,
    ],
    ['ZONE_GRANT', 'zone_access_grant', "revoked_at='2026-10-11T12:00:00.000001Z'", f.deny],
    ['ZONE_POLICY', 'zone', "restriction_policy='NONE'", f.zone],
    ['CAMERA', 'camera', "status='INACTIVE'", f.camera],
    ['REGION', 'camera_observation_region', 'is_active=false,version=version+1', f.region],
  ] as const;
  for (const [kind, table, mutation, id] of changes) {
    await db.query(`UPDATE ${table} SET ${mutation} WHERE id=$1`, [id]);
    const rows = await db.query(
      'SELECT revision::text,operation,before_payload,after_payload,before_hash,after_hash FROM mf06_authority_fact WHERE source_kind=$1 AND source_id=$2 ORDER BY revision',
      [kind, id],
    );
    assert.deepEqual(
      rows.map((r: { revision: string }) => r.revision),
      ['1', '2'],
    );
    assert.equal(rows[1].operation, 'UPDATE');
    assert.deepEqual(rows[1].before_payload, rows[0].after_payload);
    assert.equal(rows[1].before_hash, rows[0].after_hash);
    for (const payload of [rows[0].after_payload, rows[1].after_payload]) {
      for (const forbidden of [
        'name',
        'display_name',
        'password_hash',
        'encrypted_template',
        'created_at',
      ])
        assert.equal(forbidden in payload, false);
      assert.equal('user_id' in payload, kind === 'WORKER');
    }
    assert.equal(
      (
        await db.query(
          "SELECT bool_and(after_hash=encode(sha256(convert_to(after_payload::text,'UTF8')),'hex')) AS valid FROM mf06_authority_fact WHERE source_kind=$1 AND source_id=$2",
          [kind, id],
        )
      )[0].valid,
      true,
    );
  }
  const payload = (
    await db.query(
      "SELECT after_payload FROM mf06_authority_fact WHERE source_kind='WORKER_PERMISSION' AND source_id=$1 AND revision=2",
      [f.wp],
    )
  )[0].after_payload;
  assert.match(payload.revoked_at, /\.000001/);
});

test('display-name changes and no-op metadata writes do not create false revisions', async () => {
  const f = await graph();
  await db.query(
    "UPDATE contractor SET name='Another synthetic label',is_active=is_active WHERE id=$1",
    [f.contractor],
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS count FROM mf06_authority_fact WHERE source_kind='CONTRACTOR' AND source_id=$1",
        [f.contractor],
      )
    )[0].count,
    1,
  );
});

test('attributed mutation and its command share the same database-owned transaction', async () => {
  const f = await graph();
  const id = await db.transaction(async (manager) => {
    const commandId = await command(manager, f.actor);
    await manager.query('UPDATE contractor SET is_active=false WHERE id=$1', [f.contractor]);
    return commandId;
  });
  const row = (
    await db.query(
      'SELECT c.actor_user_id,f.command_id,f.transaction_id=c.transaction_id AS same_tx,f.revision::text FROM mf06_authority_fact f JOIN mf06_authority_command c USING(command_id) WHERE f.command_id=$1',
      [id],
    )
  )[0];
  assert.deepEqual(row, { actor_user_id: f.actor, command_id: id, same_tx: true, revision: '2' });
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int AS count FROM mf06_authority_commit_witness WHERE command_id=$1',
        [id],
      )
    )[0].count,
    0,
  );
  await db.query(
    "INSERT INTO mf06_authority_commit_witness(command_id,transaction_id,confirmed_at) VALUES($1,'0'::xid8,'2099-01-01Z')",
    [id],
  );
  const witness = (
    await db.query(
      'SELECT w.transaction_id=c.transaction_id AS same_tx,w.confirmed_at>=c.started_at AS ordered,w.confirmed_at<clock_timestamp() AS not_client_future FROM mf06_authority_commit_witness w JOIN mf06_authority_command c USING(command_id) WHERE command_id=$1',
      [id],
    )
  )[0];
  assert.deepEqual(witness, { same_tx: true, ordered: true, not_client_future: true });
});

test('a witness cannot certify the still-open transaction', async () => {
  const f = await graph(),
    runner = db.createQueryRunner();
  try {
    await runner.startTransaction();
    const id = await command(runner.manager, f.actor);
    await runner.query('UPDATE contractor SET is_active=false WHERE id=$1', [f.contractor]);
    await runner.query('SAVEPOINT held_witness');
    await rejection(
      runner.query(
        "INSERT INTO mf06_authority_commit_witness(command_id,transaction_id) VALUES($1,'0'::xid8)",
        [id],
      ),
    );
    await runner.query('ROLLBACK TO SAVEPOINT held_witness');
    await runner.commitTransaction();
    await db.query(
      "INSERT INTO mf06_authority_commit_witness(command_id,transaction_id) VALUES($1,'0'::xid8)",
      [id],
    );
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
  }
});

test('rollback removes source change, head revision, facts and command atomically', async () => {
  const f = await graph(),
    id = randomUUID(),
    runner = db.createQueryRunner();
  try {
    await runner.startTransaction();
    await command(runner.manager, f.actor, id);
    await runner.query('UPDATE contractor SET is_active=false WHERE id=$1', [f.contractor]);
    await runner.rollbackTransaction();
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
  }
  assert.equal(
    (await db.query('SELECT is_active FROM contractor WHERE id=$1', [f.contractor]))[0].is_active,
    true,
  );
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int AS count FROM mf06_authority_command WHERE command_id=$1',
        [id],
      )
    )[0].count,
    0,
  );
  assert.equal(
    (
      await db.query(
        "SELECT revision::text FROM mf06_authority_head WHERE source_kind='CONTRACTOR' AND source_id=$1",
        [f.contractor],
      )
    )[0].revision,
    '1',
  );
});

test('stale or malformed command context cannot attribute another transaction', async () => {
  const f = await graph();
  const old = await db.transaction((manager) => command(manager, f.actor));
  for (const text of [old, 'not-a-uuid']) {
    await db.transaction(async (manager) => {
      await manager.query("SELECT set_config('smartsite.mf06_command_id',$1,true)", [text]);
      await manager.query('UPDATE contractor SET is_active=NOT is_active WHERE id=$1', [
        f.contractor,
      ]);
    });
  }
  const rows = await db.query(
    "SELECT command_id FROM mf06_authority_fact WHERE source_kind='CONTRACTOR' AND source_id=$1 AND revision>1",
    [f.contractor],
  );
  assert.equal(rows.length, 2);
  assert.equal(
    rows.every((r: { command_id: unknown }) => r.command_id === null),
    true,
  );
});

test('inactive actor cannot issue an attributed command', async () => {
  const f = await graph();
  await db.query('UPDATE app_user SET is_active=false WHERE id=$1', [f.actor]);
  await rejection(db.transaction((manager) => command(manager, f.actor)));
});

test('unattributed changes gap an epoch and direct READY promotion is refused', async () => {
  const f = await graph(),
    epoch = randomUUID();
  await db.query('INSERT INTO mf06_authority_epoch(epoch_id,writer_manifest_hash) VALUES($1,$2)', [
    epoch,
    'a'.repeat(64),
  ]);
  await db.query('UPDATE mf06_authority_control SET epoch_id=$1 WHERE singleton=1', [epoch]);
  try {
    await db.query('UPDATE contractor SET is_active=false WHERE id=$1', [f.contractor]);
    assert.equal(
      (await db.query('SELECT state FROM mf06_authority_epoch WHERE epoch_id=$1', [epoch]))[0]
        .state,
      'GAPPED',
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS count FROM mf06_authority_gap WHERE epoch_id=$1 AND source_id=$2 AND reason='UNATTRIBUTED_WRITE'",
          [epoch, f.contractor],
        )
      )[0].count,
      1,
    );
    await rejection(
      db.query("UPDATE mf06_authority_epoch SET state='READY' WHERE epoch_id=$1", [epoch]),
    );
    await rejection(
      db.query(
        "INSERT INTO mf06_authority_epoch(epoch_id,writer_manifest_hash,state) VALUES($1,$2,'READY')",
        [randomUUID(), 'b'.repeat(64)],
      ),
    );
  } finally {
    await db.query('UPDATE mf06_authority_control SET epoch_id=NULL WHERE singleton=1');
  }
});

test('source deletion retains a tombstone without a foreign key blocking business deletion', async () => {
  const id = randomUUID();
  await db.query(
    "INSERT INTO contractor(id,code,name) VALUES($1,$1::uuid::text,'Synthetic deleted contractor')",
    [id],
  );
  await db.query('DELETE FROM contractor WHERE id=$1', [id]);
  const rows = await db.query(
    "SELECT operation,after_payload FROM mf06_authority_fact WHERE source_kind='CONTRACTOR' AND source_id=$1 ORDER BY revision",
    [id],
  );
  assert.deepEqual(
    rows.map((r: { operation: string }) => r.operation),
    ['INSERT', 'DELETE'],
  );
  assert.equal(rows[1].after_payload, null);
  assert.equal(
    (
      await db.query(
        "SELECT after_payload FROM mf06_authority_head WHERE source_kind='CONTRACTOR' AND source_id=$1",
        [id],
      )
    )[0].after_payload,
    null,
  );
});

test('source TRUNCATE records an uncovered gap and the whole operation can roll back', async () => {
  const runner = db.createQueryRunner();
  try {
    await runner.startTransaction();
    await runner.query('TRUNCATE camera_observation_region CASCADE');
    assert.equal(
      (
        await runner.query(
          "SELECT count(*)::int AS count FROM mf06_authority_gap WHERE transaction_id=pg_current_xact_id() AND source_kind='REGION' AND reason='UNCOVERED_TRUNCATE'",
        )
      )[0].count,
      1,
    );
    await runner.rollbackTransaction();
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
  }
});

for (const table of [
  'mf06_authority_source',
  'mf06_authority_command',
  'mf06_authority_fact',
  'mf06_authority_head',
  'mf06_authority_gap',
  'mf06_authority_commit_witness',
]) {
  test(`${table} cannot be deleted or truncated through ordinary SQL`, async () => {
    await rejection(db.query(`DELETE FROM ${table}`));
    await rejection(db.query(`TRUNCATE ${table} CASCADE`));
  });
}

test('raw fact or head insertion cannot fabricate a source revision', async () => {
  await rejection(
    db.query(
      "INSERT INTO mf06_authority_head(source_kind,source_id,revision,after_payload) VALUES('CONTRACTOR',$1,1,$2)",
      [randomUUID(), { id: randomUUID(), is_active: true }],
    ),
  );
  await rejection(
    db.query(
      "INSERT INTO mf06_authority_fact(source_kind,source_id,revision,operation,after_payload,transaction_id) VALUES('CONTRACTOR',$1,1,'INSERT',$2,pg_current_xact_id())",
      [randomUUID(), { id: randomUUID(), is_active: true }],
    ),
  );
});

test('populated-down refuses before removing source capture or audit data', async () => {
  const runner = db.createQueryRunner();
  try {
    await runner.startTransaction();
    await rejection(candidate.down(runner));
    await runner.rollbackTransaction();
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
  }
  const id = randomUUID();
  await db.query(
    "INSERT INTO contractor(id,code,name) VALUES($1,$1::uuid::text,'Synthetic after refused down')",
    [id],
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS count FROM mf06_authority_fact WHERE source_kind='CONTRACTOR' AND source_id=$1",
        [id],
      )
    )[0].count,
    1,
  );
});

test('source registry cannot be extended outside the reviewed migration', async () => {
  await rejection(
    db.query(
      "INSERT INTO mf06_authority_source(source_kind,table_name,fields,protocol_version) VALUES('UNREVIEWED','unreviewed',ARRAY['id'],'MAIN_ROW_JOURNAL_V1')",
    ),
  );
});

test('control singleton cannot be erased while source triggers depend on it', async () => {
  await rejection(db.query('DELETE FROM mf06_authority_control'));
  await rejection(db.query('TRUNCATE mf06_authority_control'));
});

test('empty migration roundtrip restores the owned schema and never backfills old rows', async () => {
  const other = createIsolatedTestDatabase({ legacy: true }),
    source = other.dataSource;
  let runner;
  try {
    await prepare(other);
    runner = source.createQueryRunner();
    const id = randomUUID();
    await source.query(
      "INSERT INTO contractor(id,code,name) VALUES($1,$1::uuid::text,'Synthetic before migration')",
      [id],
    );
    const beforeTables = await source.query(
      'SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() ORDER BY table_name',
    );
    const beforeFunctions = await source.query(
      'SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() ORDER BY p.proname',
    );
    await runner.startTransaction();
    await candidate.up(runner);
    await runner.commitTransaction();
    assert.equal(
      (await source.query('SELECT count(*)::int AS count FROM mf06_authority_fact'))[0].count,
      0,
    );
    assert.equal(
      (await source.query('SELECT count(*)::int AS count FROM mf06_authority_epoch'))[0].count,
      0,
    );
    await runner.startTransaction();
    await candidate.down(runner);
    await runner.commitTransaction();
    assert.deepEqual(
      await source.query(
        'SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() ORDER BY table_name',
      ),
      beforeTables,
    );
    assert.deepEqual(
      await source.query(
        'SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname=current_schema() ORDER BY p.proname',
      ),
      beforeFunctions,
    );
    assert.equal(
      (await source.query('SELECT is_active FROM contractor WHERE id=$1', [id]))[0].is_active,
      true,
    );
  } finally {
    if (runner?.isTransactionActive) await runner.rollbackTransaction();
    if (runner) await runner.release();
    await other.dispose();
  }
});

test('missing main prerequisite is refused before journal DDL', async () => {
  const other = createIsolatedTestDatabase({ legacy: true }),
    source = other.dataSource;
  let runner;
  try {
    await prepare(other);
    await source.query('ALTER TABLE site DROP COLUMN access_policy_version');
    runner = source.createQueryRunner();
    await runner.startTransaction();
    await assert.rejects(
      candidate.up(runner),
      /Retained-main authority prerequisite missing: site.access_policy_version/,
    );
    await runner.rollbackTransaction();
    assert.equal(
      (await source.query("SELECT to_regclass('mf06_authority_fact') IS NULL AS absent"))[0].absent,
      true,
    );
  } finally {
    if (runner?.isTransactionActive) await runner.rollbackTransaction();
    if (runner) await runner.release();
    await other.dispose();
  }
});

test('concurrent source updates retain contiguous revisions and exact before/after links', async () => {
  const f = await graph(),
    first = db.createQueryRunner(),
    second = db.createQueryRunner();
  let pending: Promise<unknown> | undefined;
  try {
    await first.startTransaction();
    await second.startTransaction();
    await command(first.manager, f.actor);
    await command(second.manager, f.actor);
    const firstPid = (await first.query('SELECT pg_backend_pid() AS pid'))[0].pid;
    const secondPid = (await second.query('SELECT pg_backend_pid() AS pid'))[0].pid;
    await first.query('UPDATE contractor SET is_active=false WHERE id=$1', [f.contractor]);
    pending = second.query('UPDATE contractor SET is_active=true WHERE id=$1', [f.contractor]);
    // Observe the actual blocker rather than treating elapsed sleep as proof.
    let blocked = false;
    for (let n = 0; n < 40; n++) {
      const pids = (await db.query('SELECT pg_blocking_pids($1) AS pids', [secondPid]))[0]
        .pids as number[];
      if (pids.includes(firstPid)) {
        blocked = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(blocked, true);
    await first.commitTransaction();
    await pending;
    await second.commitTransaction();
    const rows = await db.query(
      "SELECT revision::text,before_payload,after_payload,command_id FROM mf06_authority_fact WHERE source_kind='CONTRACTOR' AND source_id=$1 ORDER BY revision",
      [f.contractor],
    );
    assert.deepEqual(
      rows.map((r: { revision: string }) => r.revision),
      ['1', '2', '3'],
    );
    assert.deepEqual(rows[2].before_payload, rows[1].after_payload);
    assert.deepEqual(rows[1].before_payload, rows[0].after_payload);
    assert.notEqual(rows[1].command_id, rows[2].command_id);
    assert.equal(rows[2].after_payload.is_active, true);
  } finally {
    if (first.isTransactionActive) await first.rollbackTransaction();
    if (pending) await pending.catch(() => undefined);
    if (second.isTransactionActive) await second.rollbackTransaction();
    await first.release();
    await second.release();
  }
});

test('caller timezone cannot create a false source-head gap or different timestamp spelling', async () => {
  const f = await graph();
  const id = await db.transaction(async (manager) => {
    await manager.query("SET LOCAL timezone='Pacific/Kiritimati'");
    const commandId = await command(manager, f.actor);
    await manager.query(
      "UPDATE contractor_zone_permission SET revoked_at='2026-10-11T12:00:00.000001Z' WHERE id=$1",
      [f.cp],
    );
    const gaps = await manager.query(
      'SELECT count(*)::int AS count FROM mf06_authority_gap WHERE transaction_id=pg_current_xact_id()',
    );
    assert.equal(gaps[0].count, 0);
    return commandId;
  });
  const rows = await db.query(
    "SELECT before_payload,after_payload FROM mf06_authority_fact WHERE source_kind='CONTRACTOR_PERMISSION' AND source_id=$1 ORDER BY revision",
    [f.cp],
  );
  assert.deepEqual(rows[1].before_payload, rows[0].after_payload);
  assert.equal(rows[1].after_payload.revoked_at, '2026-10-11T12:00:00.000001+00:00');
  assert.equal(
    (await db.query('SELECT command_id FROM mf06_authority_fact WHERE command_id=$1', [id])).length,
    1,
  );
});
after(() => database.dispose());

test('committed relevant source mutation has a journal without claiming historical readiness', async () => {
  const present = (
    await db.query("SELECT to_regclass('mf06_authority_fact') IS NOT NULL AS present")
  )[0].present;
  assert.equal(present, true, 'main authority mutations have no journal storage');
  const id = randomUUID();
  await db.query(
    "INSERT INTO contractor(id,code,name) VALUES($1,$1::uuid::text,'Synthetic contractor')",
    [id],
  );
  const facts = await db.query(
    'SELECT operation,after_payload FROM mf06_authority_fact WHERE source_kind=$1 AND source_id=$2',
    ['CONTRACTOR', id],
  );
  assert.equal(facts.length, 1);
  assert.equal(facts[0].operation, 'INSERT');
  assert.deepEqual(facts[0].after_payload, { id, is_active: true });
  assert.equal(
    (
      await db.query("SELECT count(*)::int AS count FROM mf06_authority_epoch WHERE state='READY'")
    )[0].count,
    0,
  );
});
