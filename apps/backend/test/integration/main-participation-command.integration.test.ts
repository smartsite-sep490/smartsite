import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { DataSource } from 'typeorm';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
interface Participation {
  id: string;
  contractorId: string;
  siteId: string;
  isActive: boolean;
  validFrom: string;
  validUntil: string | null;
  createdAt: string;
}
interface Result {
  commandId: string;
  replayed: boolean;
  participation: Participation;
}
interface Writer {
  create(input: unknown): Promise<Result>;
}
let WriterClass: (new (source: DataSource) => Writer) | undefined;
const database = createIsolatedTestDatabase({ preAuthorityCutover72: true }),
  db = database.dataSource;
before(async () => {
  try {
    WriterClass = (
      await import(
        new URL('../../src/modules/zones/main-participation-command.service.js', import.meta.url)
          .href
      )
    ).MainParticipationCommandService;
  } catch (e) {
    if ((e as { code?: string }).code !== 'ERR_MODULE_NOT_FOUND') throw e;
  }
  if (!WriterClass) return;
  await database.initialize();
});
after(async () => {
  await database.dispose();
});
async function fixture(role = 'ADMIN') {
  assert.ok(WriterClass, 'Retained-main participation command writer is not implemented');
  const actorUserId = randomUUID(),
    siteId = randomUUID(),
    contractorId = randomUUID();
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash,must_change_password) VALUES($1,$1::uuid::text,'Synthetic actor','not-runtime-secret',false)",
    [actorUserId],
  );
  await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Site')", [
    siteId,
  ]);
  await db.query('INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,$3,$4)', [
    randomUUID(),
    actorUserId,
    role,
    role === 'ADMIN' ? null : siteId,
  ]);
  await db.query(
    "INSERT INTO contractor(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Contractor')",
    [contractorId],
  );
  return { actorUserId, siteId, contractorId, service: new WriterClass(db) };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function input(f: Fixture) {
  return {
    commandId: randomUUID(),
    actorUserId: f.actorUserId,
    siteId: f.siteId,
    contractorId: f.contractorId,
    validFrom: '2026-01-01T00:00:00.000001Z',
    validUntil: '2027-12-31T00:00:00.000009Z',
  };
}
function status(n: number) {
  return (e: unknown) => (e as { getStatus?: () => number }).getStatus?.() === n;
}
async function rowCount(f: Fixture) {
  return (
    await db.query(
      'SELECT count(*)::int AS n FROM contractor_site_participation WHERE contractor_id=$1',
      [f.contractorId],
    )
  )[0].n;
}

test('Admin creates exact main participation fields and same-transaction fact without business audit/policy bump', async () => {
  const f = await fixture(),
    value = input(f),
    r = await f.service.create(value);
  assert.equal(r.replayed, false);
  assert.equal(r.participation.contractorId, f.contractorId);
  assert.equal(r.participation.siteId, f.siteId);
  assert.equal(r.participation.isActive, true);
  assert.ok(r.participation.validFrom.includes('.000001'));
  assert.ok(r.participation.validUntil?.includes('.000009'));
  assert.deepEqual(
    (
      await db.query(
        'SELECT f.source_kind,f.operation,f.transaction_id=c.transaction_id AS same_tx,w.transaction_id=c.transaction_id AS witnessed,r.source_id=f.source_id AS bound FROM authorization_history_revision f JOIN authorization_history_command c USING(command_id) JOIN authorization_history_commit_receipt w USING(command_id) JOIN contractor_participation_command_receipt r USING(command_id) WHERE command_id=$1',
        [value.commandId],
      )
    )[0],
    {
      source_kind: 'PARTICIPATION',
      operation: 'INSERT',
      same_tx: true,
      witnessed: true,
      bound: true,
    },
  );
  assert.equal(
    (await db.query('SELECT access_policy_version FROM site WHERE id=$1', [f.siteId]))[0]
      .access_policy_version,
    1,
  );
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM audit_log WHERE site_id=$1', [f.siteId]))[0].n,
    0,
  );
});
for (const role of ['SITE_MANAGER', 'SAFETY_OFFICER', 'CONTRACTOR_REPRESENTATIVE', 'WORKER'])
  test(`participation create retains main refusal for ${role}`, async () => {
    const f = await fixture(role);
    await assert.rejects(f.service.create(input(f)), status(403));
    assert.equal(await rowCount(f), 0);
  });
test('database rejects Site-scoped ADMIN and an account without roles cannot create', async () => {
  const f = await fixture();
  await assert.rejects(
    db.query('UPDATE user_role_assignment SET site_id=$2 WHERE user_id=$1', [
      f.actorUserId,
      f.siteId,
    ]),
    (e: unknown) => (e as { code?: string }).code === '23514',
  );
  await db.query('DELETE FROM user_role_assignment WHERE user_id=$1', [f.actorUserId]);
  await assert.rejects(f.service.create(input(f)), status(403));
});
test('inactive Contractor and open expiry remain allowed by the actual main create contract', async () => {
  const f = await fixture();
  await db.query('UPDATE contractor SET is_active=false WHERE id=$1', [f.contractorId]);
  const r = await f.service.create({ ...input(f), validUntil: null });
  assert.equal(r.participation.validUntil, null);
  assert.equal(r.participation.isActive, true);
});
test('missing Site/Contractor fail404 without partial participation or command', async () => {
  const f = await fixture();
  for (const field of ['siteId', 'contractorId']) {
    const value = { ...input(f), [field]: randomUUID() };
    await assert.rejects(f.service.create(value), status(404));
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int AS n FROM authorization_history_command WHERE command_id=$1',
          [value.commandId],
        )
      )[0].n,
      0,
    );
  }
  assert.equal(await rowCount(f), 0);
});
test('finite one microsecond interval survives; equal/reversed/malformed/unknown inputs fail without writes', async () => {
  const f = await fixture();
  const r = await f.service.create({ ...input(f), validUntil: '2026-01-01T00:00:00.000002Z' });
  assert.ok(r.participation.validUntil?.includes('.000002'));
  for (const fields of [
    { validUntil: '2026-01-01T00:00:00.000001Z' },
    { validUntil: '2025-01-01T00:00:00Z' },
    { validFrom: 'infinity' },
    { validFrom: '2026-01-01' },
    { workerId: randomUUID() },
  ])
    await assert.rejects(f.service.create({ ...input(f), ...fields }), status(400));
  assert.equal(await rowCount(f), 1);
});
test('separate commands retain main ability to create overlapping participations', async () => {
  const f = await fixture(),
    value = input(f);
  const a = await f.service.create(value),
    b = await f.service.create({ ...value, commandId: randomUUID() });
  assert.notEqual(a.participation.id, b.participation.id);
  assert.equal(await rowCount(f), 2);
});
test('concurrent same-ID commands create one participation and replay identical original result', async () => {
  const f = await fixture(),
    value = input(f),
    results = await Promise.all([f.service.create(value), f.service.create(value)]);
  assert.equal(results.filter((r) => r.replayed).length, 1);
  assert.deepEqual(results[0]?.participation, results[1]?.participation);
  assert.equal(await rowCount(f), 1);
});
test('original command replays after deactivation and deletion; changed body conflicts', async () => {
  const f = await fixture(),
    value = input(f),
    r = await f.service.create(value);
  await db.query('UPDATE contractor_site_participation SET is_active=false WHERE id=$1', [
    r.participation.id,
  ]);
  assert.deepEqual((await f.service.create(value)).participation, r.participation);
  await db.query('DELETE FROM contractor_site_participation WHERE id=$1', [r.participation.id]);
  assert.deepEqual((await f.service.create(value)).participation, r.participation);
  await assert.rejects(f.service.create({ ...value, validUntil: null }), status(409));
});
for (const mutation of ['inactive', 'temporary-password', 'role'])
  test(`replay reauthorizes current actor ${mutation}`, async () => {
    const f = await fixture(),
      value = input(f);
    await f.service.create(value);
    if (mutation === 'inactive')
      await db.query('UPDATE app_user SET is_active=false WHERE id=$1', [f.actorUserId]);
    if (mutation === 'temporary-password')
      await db.query('UPDATE app_user SET must_change_password=true WHERE id=$1', [f.actorUserId]);
    if (mutation === 'role')
      await db.query('DELETE FROM user_role_assignment WHERE user_id=$1', [f.actorUserId]);
    await assert.rejects(f.service.create(value), status(403));
    assert.equal(await rowCount(f), 1);
  });
test('source fact failure rolls back source, command and response', async () => {
  const f = await fixture(),
    value = input(f);
  await db.query(
    `CREATE FUNCTION test_participation_fact_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.source_kind='PARTICIPATION' AND NEW.command_id='${value.commandId}'::uuid THEN RAISE EXCEPTION 'synthetic fact failure';END IF;RETURN NEW;END $$;CREATE TRIGGER test_participation_fact_failure BEFORE INSERT ON authorization_history_revision FOR EACH ROW EXECUTE FUNCTION test_participation_fact_failure()`,
  );
  try {
    await assert.rejects(f.service.create(value));
    assert.equal(await rowCount(f), 0);
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int AS n FROM authorization_history_command WHERE command_id=$1',
          [value.commandId],
        )
      )[0].n,
      0,
    );
  } finally {
    await db.query(
      'DROP TRIGGER test_participation_fact_failure ON authorization_history_revision;DROP FUNCTION test_participation_fact_failure()',
    );
  }
});
test('postcommit witness failure is503 and same-ID retry does not create another participation', async () => {
  const f = await fixture(),
    value = input(f);
  await db.query(
    `CREATE FUNCTION test_participation_witness_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.command_id='${value.commandId}'::uuid THEN RAISE EXCEPTION 'synthetic witness failure';END IF;RETURN NEW;END $$;CREATE TRIGGER test_participation_witness_failure BEFORE INSERT ON authorization_history_commit_receipt FOR EACH ROW EXECUTE FUNCTION test_participation_witness_failure()`,
  );
  try {
    await assert.rejects(f.service.create(value), status(503));
    assert.equal(await rowCount(f), 1);
  } finally {
    await db.query(
      'DROP TRIGGER test_participation_witness_failure ON authorization_history_commit_receipt;DROP FUNCTION test_participation_witness_failure()',
    );
  }
  assert.equal((await f.service.create(value)).replayed, true);
  assert.equal(await rowCount(f), 1);
});
test('original response is database-hashed and cannot be changed/deleted/truncated', async () => {
  const f = await fixture(),
    value = input(f);
  await f.service.create(value);
  assert.equal(
    (
      await db.query(
        "SELECT result_hash=encode(sha256(convert_to(result_json::text,'UTF8')),'hex') AS valid FROM contractor_participation_command_receipt WHERE command_id=$1",
        [value.commandId],
      )
    )[0].valid,
    true,
  );
  for (const query of [
    'DELETE FROM contractor_participation_command_receipt',
    'TRUNCATE contractor_participation_command_receipt',
    "UPDATE contractor_participation_command_receipt SET result_hash=repeat('a',64)",
  ])
    await assert.rejects(
      db.query(query),
      (e: unknown) => (e as { code?: string }).code === '23514',
    );
});
test('receipt cannot certify an old participation without an INSERT fact from the origin command', async () => {
  const f = await fixture(),
    original = await f.service.create(input(f)),
    runner = db.createQueryRunner();
  try {
    await runner.startTransaction();
    const commandId = randomUUID();
    await runner.query(
      "INSERT INTO authorization_history_command(command_id,actor_user_id,operation,request_hash) VALUES($1,$2,'MAIN_PARTICIPATION_CREATE',$3)",
      [commandId, f.actorUserId, 'b'.repeat(64)],
    );
    await runner.query("SELECT set_config('smartsite.mf06_command_id',$1,true)", [commandId]);
    await assert.rejects(
      runner.query(
        "INSERT INTO contractor_participation_command_receipt(command_id,source_id,result_json,result_hash) VALUES($1,$2,mf06_participation_response($2),'')",
        [commandId, original.participation.id],
      ),
      (e: unknown) => (e as { code?: string }).code === '23514',
    );
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
  }
});
test('missing result table fails503 and does not leave source or command rows', async () => {
  const f = await fixture(),
    value = input(f);
  await db.query(
    'ALTER TABLE contractor_participation_command_receipt RENAME TO test_hidden_participation_result',
  );
  try {
    await assert.rejects(f.service.create(value), status(503));
    assert.equal(await rowCount(f), 0);
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int AS n FROM authorization_history_command WHERE command_id=$1',
          [value.commandId],
        )
      )[0].n,
      0,
    );
  } finally {
    await db.query(
      'ALTER TABLE test_hidden_participation_result RENAME TO contractor_participation_command_receipt',
    );
  }
});
