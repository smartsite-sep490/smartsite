import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { DataSource } from 'typeorm';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

interface Result {
  commandId: string;
  replayed: boolean;
  grant: {
    id: string;
    siteId: string;
    zoneId: string;
    workerId: string;
    effect: string;
    validFrom: string;
    validUntil: string | null;
    revokedAt: string | null;
    createdAt: string;
  };
}
interface Writer {
  create(input: unknown): Promise<Result>;
  revoke(input: unknown): Promise<Result>;
}
let WriterClass: (new (source: DataSource) => Writer) | undefined;
const database = createIsolatedTestDatabase({ preAuthorityCutover72: true }),
  db = database.dataSource;
before(async () => {
  await database.initialize();
  const moduleUrl = new URL(
    '../../src/modules/zones/main-zone-deny-command.service.js',
    import.meta.url,
  );
  try {
    WriterClass = (await import(moduleUrl.href)).MainZoneDenyCommandService;
  } catch (error) {
    if ((error as { code?: string }).code !== 'ERR_MODULE_NOT_FOUND') throw error;
  }
});
after(async () => {
  await database.dispose();
});

async function fixture(role = 'ADMIN', source = db) {
  const actorUserId = randomUUID(),
    siteId = randomUUID(),
    zoneId = randomUUID(),
    workerId = randomUUID();
  await source.query(
    "INSERT INTO app_user(id,username,display_name,password_hash,must_change_password) VALUES($1,$1::uuid::text,'Synthetic actor','not-a-runtime-password',false)",
    [actorUserId],
  );
  await source.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Site')", [
    siteId,
  ]);
  await source.query(
    'INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,$3,$4)',
    [randomUUID(), actorUserId, role, role === 'ADMIN' ? null : siteId],
  );
  await source.query(
    "INSERT INTO zone(id,site_id,code,name,type,restriction_policy) VALUES($1,$2,$1::uuid::text,'Synthetic Zone','RESTRICTED','AUTHORIZATION_REQUIRED')",
    [zoneId, siteId],
  );
  await source.query(
    "INSERT INTO worker(id,site_id,external_id,display_name) VALUES($1,$2,$1::uuid::text,'Synthetic Worker')",
    [workerId, siteId],
  );
  assert.ok(WriterClass, 'Main Zone DENY command writer is not implemented');
  return {
    actorUserId,
    siteId,
    zoneId,
    workerId,
    service: new WriterClass(source),
    commandId: randomUUID(),
    effect: 'DENY',
    validFrom: '2026-10-01T00:00:00.000001Z',
    validUntil: '2026-11-01T00:00:00.000002Z',
  };
}
function createInput(f: Awaited<ReturnType<typeof fixture>>) {
  const { actorUserId, siteId, zoneId, workerId, commandId, effect, validFrom, validUntil } = f;
  return { actorUserId, siteId, zoneId, workerId, commandId, effect, validFrom, validUntil };
}
function status(n: number) {
  return (error: unknown) => (error as { getStatus?: () => number }).getStatus?.() === n;
}

test('main DENY create commits original projection, command, fact and committed witness atomically', async () => {
  const f = await fixture(),
    result = await f.service.create(createInput(f));
  assert.equal(result.replayed, false);
  assert.equal(result.grant.effect, 'DENY');
  assert.equal(result.grant.workerId, f.workerId);
  assert.ok(result.grant.validFrom.includes('.000001'));
  assert.ok(result.grant.validUntil?.includes('.000002'));
  assert.deepEqual(
    (
      await db.query(
        'SELECT c.command_id,f.transaction_id=c.transaction_id AS same_tx,r.command_id=c.command_id AS result_bound,w.transaction_id=c.transaction_id AS witnessed FROM authorization_history_command c JOIN authorization_history_revision f USING(command_id) JOIN zone_access_denial_command_receipt r USING(command_id) JOIN authorization_history_commit_receipt w USING(command_id) WHERE c.command_id=$1',
        [f.commandId],
      )
    )[0],
    { command_id: f.commandId, same_tx: true, result_bound: true, witnessed: true },
  );
  assert.deepEqual(
    (
      await db.query(
        'SELECT result_json FROM zone_access_denial_command_receipt WHERE command_id=$1',
        [f.commandId],
      )
    )[0].result_json,
    result.grant,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM authorization_history_epoch WHERE state='READY'",
      )
    )[0].n,
    0,
  );
});

test('same command replay returns its original projection after source revoke and deletion', async () => {
  const f = await fixture(),
    first = await f.service.create(createInput(f));
  await db.query('DELETE FROM zone_access_grant WHERE id=$1', [first.grant.id]);
  const retry = await f.service.create(createInput(f));
  assert.equal(retry.replayed, true);
  assert.deepEqual(retry.grant, first.grant);
  assert.equal(
    (
      await db.query('SELECT count(*)::int AS n FROM zone_access_grant WHERE id=$1', [
        first.grant.id,
      ])
    )[0].n,
    0,
  );
});

test('command ID reuse with changed body is a conflict and cannot mutate another source', async () => {
  const f = await fixture();
  await f.service.create(createInput(f));
  await assert.rejects(f.service.create({ ...createInput(f), validUntil: null }), status(409));
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int AS n FROM authorization_history_revision WHERE command_id=$1',
        [f.commandId],
      )
    )[0].n,
    1,
  );
});

test('main public ALLOW remains forbidden through this DENY command path', async () => {
  const f = await fixture();
  await assert.rejects(f.service.create({ ...createInput(f), effect: 'ALLOW' }), status(409));
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int AS n FROM authorization_history_command WHERE command_id=$1',
        [f.commandId],
      )
    )[0].n,
    0,
  );
});

for (const role of ['SITE_MANAGER', 'SAFETY_OFFICER', 'CONTRACTOR_REPRESENTATIVE', 'WORKER'])
  test(`${role} cannot create an Admin-only legacy DENY`, async () => {
    const f = await fixture(role);
    await assert.rejects(f.service.create(createInput(f)), status(403));
  });

test('replay revalidates actor activity, temporary password and current Admin role', async () => {
  const f = await fixture();
  await f.service.create(createInput(f));
  await db.query('UPDATE app_user SET is_active=false WHERE id=$1', [f.actorUserId]);
  await assert.rejects(f.service.create(createInput(f)), status(403));
  await db.query('UPDATE app_user SET is_active=true,must_change_password=true WHERE id=$1', [
    f.actorUserId,
  ]);
  await assert.rejects(f.service.create(createInput(f)), status(403));
  await db.query('UPDATE app_user SET must_change_password=false WHERE id=$1', [f.actorUserId]);
  await db.query('DELETE FROM user_role_assignment WHERE user_id=$1', [f.actorUserId]);
  await assert.rejects(f.service.create(createInput(f)), status(403));
});

test('wrong Site Zone or Worker and inactive Worker are refused without journal commands', async () => {
  const f = await fixture(),
    other = await fixture();
  await assert.rejects(f.service.create({ ...createInput(f), zoneId: other.zoneId }), status(404));
  await assert.rejects(
    f.service.create({ ...createInput(f), workerId: other.workerId }),
    status(404),
  );
  await db.query('UPDATE worker SET is_active=false WHERE id=$1', [f.workerId]);
  await assert.rejects(f.service.create(createInput(f)), status(404));
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int AS n FROM authorization_history_command WHERE command_id=$1',
        [f.commandId],
      )
    )[0].n,
    0,
  );
});

test('concurrent duplicate creates execute one source mutation with identical replay projection', async () => {
  const f = await fixture(),
    results = await Promise.all([
      f.service.create(createInput(f)),
      f.service.create(createInput(f)),
    ]);
  assert.deepEqual(results[0]!.grant, results[1]!.grant);
  assert.deepEqual(results.map((r) => r.replayed).sort(), [false, true]);
  assert.equal(
    (
      await db.query('SELECT count(*)::int AS n FROM zone_access_grant WHERE site_id=$1', [
        f.siteId,
      ])
    )[0].n,
    1,
  );
});

test('different revoke commands serialize and preserve the first exact revocation timestamp', async () => {
  const f = await fixture(),
    created = await f.service.create(createInput(f));
  const base = {
    actorUserId: f.actorUserId,
    siteId: f.siteId,
    zoneId: f.zoneId,
    grantId: created.grant.id,
  };
  const results = await Promise.all([
    f.service.revoke({ ...base, commandId: randomUUID() }),
    f.service.revoke({ ...base, commandId: randomUUID() }),
  ]);
  assert.ok(results[0]!.grant.revokedAt);
  assert.equal(results[0]!.grant.revokedAt, results[1]!.grant.revokedAt);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM authorization_history_revision WHERE source_id=$1 AND operation='UPDATE'",
        [created.grant.id],
      )
    )[0].n,
    1,
  );
});

test('revoke replay returns the recorded body even after the source is deleted', async () => {
  const f = await fixture(),
    created = await f.service.create(createInput(f));
  const input = {
    actorUserId: f.actorUserId,
    siteId: f.siteId,
    zoneId: f.zoneId,
    grantId: created.grant.id,
    commandId: randomUUID(),
  };
  const result = await f.service.revoke(input);
  await db.query('DELETE FROM zone_access_grant WHERE id=$1', [created.grant.id]);
  assert.deepEqual((await f.service.revoke(input)).grant, result.grant);
});

test('response persistence failure rolls back the grant, command and source fact', async () => {
  const f = await fixture();
  await db.query(
    "CREATE FUNCTION reject_deny_result() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic persistence failure' USING ERRCODE='23514'; END $$; CREATE TRIGGER test_reject_result BEFORE INSERT ON zone_access_denial_command_receipt FOR EACH ROW EXECUTE FUNCTION reject_deny_result()",
  );
  try {
    await assert.rejects(f.service.create(createInput(f)));
  } finally {
    await db.query(
      'DROP TRIGGER test_reject_result ON zone_access_denial_command_receipt; DROP FUNCTION reject_deny_result()',
    );
  }
  assert.equal(
    (
      await db.query('SELECT count(*)::int AS n FROM zone_access_grant WHERE site_id=$1', [
        f.siteId,
      ])
    )[0].n,
    0,
  );
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int AS n FROM authorization_history_command WHERE command_id=$1',
        [f.commandId],
      )
    )[0].n,
    0,
  );
});

test('malformed scope, unknown fields and nonfinite or reversed validity cannot write', async () => {
  const f = await fixture();
  for (const bad of [
    { siteId: 'bad' },
    { extra: 'field' },
    { validFrom: 'infinity' },
    { validUntil: '2026-09-01T00:00:00Z' },
  ])
    await assert.rejects(f.service.create({ ...createInput(f), ...bad }), status(400));
});

test('omitted validUntil retains the existing main open-ended DENY behavior', async () => {
  const f = await fixture(),
    { validUntil: omitted, ...input } = createInput(f);
  assert.ok(omitted);
  const result = await f.service.create(input);
  assert.equal(result.grant.validUntil, null);
});

test('a one-microsecond interval is compared in PostgreSQL without Date rounding', async () => {
  const f = await fixture();
  const result = await f.service.create({
    ...createInput(f),
    validUntil: '2026-10-01T00:00:00.000002Z',
  });
  assert.ok(result.grant.validFrom.includes('.000001'));
  assert.ok(result.grant.validUntil?.includes('.000002'));
});

test('a postcommit witness failure is safely retried without another committed grant', async () => {
  const f = await fixture();
  assert.ok(WriterClass);
  const wrapped = new Proxy(db, {
    get(target, property) {
      if (property === 'query')
        return async (sql: string, ...args: unknown[]) => {
          if (sql.startsWith('INSERT INTO authorization_history_commit_receipt'))
            throw new Error('Synthetic witness I/O failure');
          return Reflect.apply(target.query, target, [sql, ...args]);
        };
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  await assert.rejects(new WriterClass(wrapped).create(createInput(f)), status(503));
  const saved = (
    await db.query(
      'SELECT result_json FROM zone_access_denial_command_receipt WHERE command_id=$1',
      [f.commandId],
    )
  )[0].result_json;
  assert.equal(
    (
      await db.query('SELECT count(*)::int AS n FROM zone_access_grant WHERE site_id=$1', [
        f.siteId,
      ])
    )[0].n,
    1,
  );
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int AS n FROM authorization_history_commit_receipt WHERE command_id=$1',
        [f.commandId],
      )
    )[0].n,
    0,
  );
  const retry = await f.service.create(createInput(f));
  assert.equal(retry.replayed, true);
  assert.deepEqual(retry.grant, saved);
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int AS n FROM authorization_history_revision WHERE command_id=$1',
        [f.commandId],
      )
    )[0].n,
    1,
  );
});

test('legacy flat ALLOW rows remain revocable without becoming an allowed new grant path', async () => {
  const f = await fixture(),
    grantId = randomUUID();
  await db.query(
    "INSERT INTO zone_access_grant(id,site_id,zone_id,worker_id,effect,valid_from) VALUES($1,$2,$3,$4,'ALLOW','2026-10-01Z')",
    [grantId, f.siteId, f.zoneId, f.workerId],
  );
  const result = await f.service.revoke({
    actorUserId: f.actorUserId,
    siteId: f.siteId,
    zoneId: f.zoneId,
    commandId: randomUUID(),
    grantId,
  });
  assert.equal(result.grant.effect, 'ALLOW');
  assert.ok(result.grant.revokedAt);
});

test('revoke rejects wrong Site/Zone and revalidates role before any write', async () => {
  const f = await fixture(),
    created = await f.service.create(createInput(f)),
    other = await fixture();
  const base = {
    actorUserId: f.actorUserId,
    siteId: f.siteId,
    zoneId: f.zoneId,
    commandId: randomUUID(),
    grantId: created.grant.id,
  };
  await assert.rejects(f.service.revoke({ ...base, zoneId: other.zoneId }), status(404));
  await assert.rejects(f.service.revoke({ ...base, siteId: other.siteId }), status(404));
  await db.query('DELETE FROM user_role_assignment WHERE user_id=$1', [f.actorUserId]);
  await assert.rejects(f.service.revoke(base), status(403));
  assert.equal(
    (await db.query('SELECT revoked_at FROM zone_access_grant WHERE id=$1', [created.grant.id]))[0]
      .revoked_at,
    null,
  );
});

test('an already-revoked grant records a replayable no-op response without another source fact', async () => {
  const f = await fixture(),
    created = await f.service.create(createInput(f));
  const base = {
    actorUserId: f.actorUserId,
    siteId: f.siteId,
    zoneId: f.zoneId,
    grantId: created.grant.id,
  };
  const first = await f.service.revoke({ ...base, commandId: randomUUID() }),
    secondId = randomUUID();
  const second = await f.service.revoke({ ...base, commandId: secondId });
  assert.deepEqual(second.grant, first.grant);
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int AS n FROM authorization_history_revision WHERE command_id=$1',
        [secondId],
      )
    )[0].n,
    0,
  );
  await db.query('DELETE FROM zone_access_grant WHERE id=$1', [created.grant.id]);
  assert.deepEqual((await f.service.revoke({ ...base, commandId: secondId })).grant, first.grant);
});

test('original responses cannot be deleted, truncated, rewritten or inserted after commit', async () => {
  const f = await fixture(),
    created = await f.service.create(createInput(f));
  const constraint = (e: unknown) => (e as { code?: string }).code === '23514';
  await assert.rejects(
    db.query('DELETE FROM zone_access_denial_command_receipt WHERE command_id=$1', [f.commandId]),
    constraint,
  );
  await assert.rejects(db.query('TRUNCATE zone_access_denial_command_receipt'), constraint);
  await assert.rejects(
    db.query("UPDATE zone_access_denial_command_receipt SET result_json='{}' WHERE command_id=$1", [
      f.commandId,
    ]),
    constraint,
  );
  await assert.rejects(
    db.query(
      "INSERT INTO zone_access_denial_command_receipt(command_id,source_id,result_json,result_hash) VALUES($1,$2,$3,'')",
      [f.commandId, created.grant.id, created.grant],
    ),
    constraint,
  );
});

test('canonical UUID casing replays one command and context does not leak into a pooled transaction', async () => {
  const f = await fixture(),
    first = await f.service.create(createInput(f));
  const input = createInput(f);
  const retry = await f.service.create({
    ...input,
    actorUserId: input.actorUserId.toUpperCase(),
    commandId: input.commandId.toUpperCase(),
    siteId: input.siteId.toUpperCase(),
    zoneId: input.zoneId.toUpperCase(),
    workerId: input.workerId.toUpperCase(),
  });
  assert.equal(retry.replayed, true);
  assert.deepEqual(retry.grant, first.grant);
  await db.transaction(async (manager) => {
    const rows = await manager.query(
      "SELECT current_setting('smartsite.mf06_command_id',true) AS value",
    );
    assert.ok(!rows[0].value);
  });
});

test('missing journal migration returns unavailable without a partial legacy grant', async () => {
  const old = createIsolatedTestDatabase({ legacy: true });
  try {
    await old.initialize();
    const f = await fixture('ADMIN', old.dataSource);
    await assert.rejects(f.service.create(createInput(f)), status(503));
    assert.equal(
      (
        await old.dataSource.query(
          'SELECT count(*)::int AS n FROM zone_access_grant WHERE site_id=$1',
          [f.siteId],
        )
      )[0].n,
      0,
    );
  } finally {
    await old.dispose();
  }
});

test('an origin response cannot fabricate a result different from its source row', async () => {
  const f = await fixture(),
    created = await f.service.create(createInput(f)),
    commandId = randomUUID();
  await assert.rejects(
    db.transaction(async (manager) => {
      await manager.query(
        "INSERT INTO authorization_history_command(command_id,actor_user_id,operation,request_hash) VALUES($1,$2,'MAIN_ZONE_DENY_REVOKE',$3)",
        [commandId, f.actorUserId, 'a'.repeat(64)],
      );
      await manager.query("SELECT set_config('smartsite.mf06_command_id',$1,true)", [commandId]);
      await manager.query(
        "INSERT INTO zone_access_denial_command_receipt(command_id,source_id,result_json,result_hash) VALUES($1,$2,$3,'')",
        [commandId, created.grant.id, { ...created.grant, effect: 'ALLOW' }],
      );
    }),
    (e: unknown) => (e as { code?: string }).code === '23514',
  );
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int AS n FROM authorization_history_command WHERE command_id=$1',
        [commandId],
      )
    )[0].n,
    0,
  );
});

test('replay reuses an existing immutable witness instead of recertifying an old transaction', async () => {
  const f = await fixture();
  const created = await f.service.create(createInput(f));
  // A new insert must not be required once the original immutable witness exists.
  await db.query(
    "CREATE FUNCTION reject_witness_recertification() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic old transaction status unavailable' USING ERRCODE='23514'; END $$; CREATE TRIGGER test_reject_witness BEFORE INSERT ON authorization_history_commit_receipt FOR EACH ROW EXECUTE FUNCTION reject_witness_recertification()",
  );
  try {
    const retry = await f.service.create(createInput(f));
    assert.equal(retry.replayed, true);
    assert.deepEqual(retry.grant, created.grant);
  } finally {
    await db.query(
      'DROP TRIGGER test_reject_witness ON authorization_history_commit_receipt; DROP FUNCTION reject_witness_recertification()',
    );
  }
});
