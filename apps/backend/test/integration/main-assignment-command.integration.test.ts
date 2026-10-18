import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { DataSource } from 'typeorm';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

interface Assignment {
  id: string;
  workerId: string;
  siteId: string;
  siteContractorId: string | null;
  zoneIds: string[];
  gateId: string | null;
  status: string;
  version: number;
  validFrom: string;
  validUntil: string | null;
  requestedByUserId: string;
  safetyReviewedByUserId: string | null;
  siteManagerDecidedByUserId: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
}
interface Result {
  commandId: string;
  replayed: boolean;
  assignment: Assignment;
}
interface Writer {
  request(input: unknown): Promise<Result>;
  safetyReview(input: unknown): Promise<Result>;
  decision(input: unknown): Promise<Result>;
  revoke(input: unknown): Promise<Result>;
}
let WriterClass: (new (source: DataSource) => Writer) | undefined;
const database = createIsolatedTestDatabase({ canonical: true }),
  db = database.dataSource;
before(async () => {
  try {
    WriterClass = (
      await import(
        new URL('../../src/modules/zones/main-assignment-command.service.js', import.meta.url).href
      )
    ).MainAssignmentCommandService;
  } catch (e) {
    if ((e as { code?: string }).code !== 'ERR_MODULE_NOT_FOUND') throw e;
  }
  if (!WriterClass) return;
  await database.initialize();
});
after(async () => {
  await database.dispose();
});
async function fixture(role = 'CONTRACTOR_REPRESENTATIVE') {
  assert.ok(WriterClass, 'Retained-main assignment command writer is not implemented');
  const actorUserId: string = randomUUID();
  const siteId = randomUUID(),
    contractorId = randomUUID(),
    participationId = randomUUID(),
    workerId = randomUUID(),
    zoneId = randomUUID();
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash,must_change_password) VALUES($1,$1::uuid::text,'Synthetic actor','not-a-runtime-password',false)",
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
  await db.query(
    "INSERT INTO contractor_site_participation(id,contractor_id,site_id,valid_from,valid_until) VALUES($1,$2,$3,'2026-01-01T00:00:00.000001Z','2028-01-01T00:00:00.000009Z')",
    [participationId, contractorId, siteId],
  );
  await db.query(
    'INSERT INTO contractor_representative_grant(id,user_id,contractor_id) VALUES($1,$2,$3)',
    [randomUUID(), actorUserId, contractorId],
  );
  await db.query(
    "INSERT INTO worker(id,site_id,contractor_id,external_id,display_name) VALUES($1,$2,$3,$1::uuid::text,'Synthetic Worker')",
    [workerId, siteId, contractorId],
  );
  await db.query(
    "INSERT INTO zone(id,site_id,code,name,type,restriction_policy) VALUES($1,$2,$1::uuid::text,'Synthetic Zone','RESTRICTED','AUTHORIZATION_REQUIRED')",
    [zoneId, siteId],
  );
  return {
    actorUserId,
    actors: { [role]: actorUserId } as Record<string, string>,
    siteId,
    contractorId,
    participationId,
    workerId,
    zoneId,
    service: new WriterClass(db),
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function input(f: Fixture) {
  return {
    commandId: randomUUID(),
    actorUserId: f.actorUserId,
    siteId: f.siteId,
    workerId: f.workerId,
    zoneIds: [f.zoneId],
    validFrom: '2026-01-01T00:00:00.000002Z',
    validUntil: '2027-12-31T00:00:00.000007Z',
  };
}
function scoped(f: Fixture, r: Result) {
  return {
    commandId: randomUUID(),
    actorUserId: f.actorUserId,
    siteId: f.siteId,
    assignmentId: r.assignment.id,
  };
}
function status(n: number) {
  return (e: unknown) => (e as { getStatus?: () => number }).getStatus?.() === n;
}
async function audits(f: Fixture) {
  return (await db.query(
    'SELECT action,changes,reason FROM audit_log WHERE site_id=$1 ORDER BY occurred_at,id',
    [f.siteId],
  )) as { action: string; changes: object; reason: string | null }[];
}
async function version(f: Fixture) {
  return (await db.query('SELECT access_policy_version FROM site WHERE id=$1', [f.siteId]))[0]
    .access_policy_version;
}
async function asRole(f: Fixture, role: string) {
  if (!f.actors[role]) {
    const actor = randomUUID();
    await db.query(
      "INSERT INTO app_user(id,username,display_name,password_hash,must_change_password) VALUES($1,$1::uuid::text,'Synthetic separate actor','not-a-runtime-password',false)",
      [actor],
    );
    await db.query(
      'INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,$3,$4)',
      [randomUUID(), actor, role, role === 'ADMIN' ? null : f.siteId],
    );
    if (role === 'CONTRACTOR_REPRESENTATIVE')
      await db.query(
        'INSERT INTO contractor_representative_grant(id,user_id,contractor_id) VALUES($1,$2,$3)',
        [randomUUID(), actor, f.contractorId],
      );
    f.actors[role] = actor;
  }
  f.actorUserId = f.actors[role]!;
}
async function pending(f: Fixture) {
  const roles = await db.query('SELECT role FROM user_role_assignment WHERE user_id=$1', [
    f.actorUserId,
  ]);
  await asRole(f, 'CONTRACTOR_REPRESENTATIVE');
  const r = await f.service.request(input(f));
  await asRole(f, roles[0].role);
  return r;
}

test('request preserves PENDING version1, exact participation scope, requester and interval without policy increment', async () => {
  const f = await fixture('CONTRACTOR_REPRESENTATIVE'),
    value = input(f),
    r = await f.service.request(value);
  assert.equal(r.assignment.status, 'PENDING');
  assert.equal(r.assignment.version, 1);
  assert.equal(r.assignment.requestedByUserId, f.actorUserId);
  assert.equal(r.assignment.siteContractorId, f.participationId);
  assert.deepEqual(r.assignment.zoneIds, [f.zoneId]);
  assert.equal(r.assignment.gateId, null);
  assert.ok(r.assignment.validFrom.includes('.000002'));
  assert.ok(r.assignment.validUntil?.includes('.000007'));
  assert.equal(await version(f), 1);
  assert.equal((await audits(f))[0]?.action, 'WORKER_ASSIGNMENT_REQUESTED');
  assert.deepEqual(
    (
      await db.query(
        'SELECT f.source_kind,f.transaction_id=c.transaction_id AS same_tx FROM authorization_history_revision f JOIN authorization_history_command c USING(command_id) WHERE command_id=$1',
        [value.commandId],
      )
    ).map((r: { source_kind: string; same_tx: boolean }) => [r.source_kind, r.same_tx]),
    [['ASSIGNMENT', true]],
  );
});
for (const role of ['ADMIN', 'SITE_MANAGER', 'SAFETY_OFFICER', 'WORKER'])
  test(`assignment request rejects ${role} without Contractor Representative ownership`, async () => {
    const f = await fixture(role);
    await assert.rejects(f.service.request(input(f)), status(403));
    assert.equal((await audits(f)).length, 0);
  });
test('request rejects missing representative linkage and cross-Site Zone/Worker', async () => {
  const f = await fixture('CONTRACTOR_REPRESENTATIVE'),
    other = await fixture();
  await assert.rejects(f.service.request({ ...input(f), zoneIds: [other.zoneId] }), status(403));
  await assert.rejects(f.service.request({ ...input(f), workerId: other.workerId }), status(403));
  await db.query('DELETE FROM contractor_representative_grant WHERE user_id=$1', [f.actorUserId]);
  await assert.rejects(f.service.request(input(f)), status(403));
});
for (const mutation of ['inactive-worker', 'inactive-contractor', 'inactive-participation'])
  test(`request rejects ${mutation}`, async () => {
    const f = await fixture();
    const table =
      mutation === 'inactive-worker'
        ? 'worker'
        : mutation === 'inactive-contractor'
          ? 'contractor'
          : 'contractor_site_participation';
    const key =
      mutation === 'inactive-worker'
        ? f.workerId
        : mutation === 'inactive-contractor'
          ? f.contractorId
          : f.participationId;
    await db.query(`UPDATE ${table} SET is_active=false WHERE id=$1`, [key]);
    await assert.rejects(f.service.request(input(f)), status(403));
  });
test('request refuses duplicate Zones, missing expiry, reversed range and participation overflow', async () => {
  const f = await fixture();
  await assert.rejects(
    f.service.request({ ...input(f), zoneIds: [f.zoneId, f.zoneId] }),
    status(409),
  );
  await assert.rejects(f.service.request({ ...input(f), validUntil: null }), status(409));
  await assert.rejects(
    f.service.request({ ...input(f), validUntil: '2026-01-01T00:00:00.000002Z' }),
    status(400),
  );
  await assert.rejects(
    f.service.request({ ...input(f), validUntil: '2028-01-01T00:00:00.000010Z' }),
    status(409),
  );
  assert.equal((await audits(f)).length, 0);
});
test('Safety review moves only PENDING to SAFETY_REVIEWED and records actor/version without Site increment', async () => {
  const f = await fixture('SAFETY_OFFICER'),
    r = await pending(f),
    review = await f.service.safetyReview(scoped(f, r));
  assert.equal(review.assignment.status, 'SAFETY_REVIEWED');
  assert.equal(review.assignment.version, 2);
  assert.equal(review.assignment.safetyReviewedByUserId, f.actorUserId);
  assert.equal(await version(f), 1);
  assert.equal((await audits(f))[1]?.action, 'WORKER_ASSIGNMENT_SAFETY_REVIEWED');
  await assert.rejects(f.service.safetyReview(scoped(f, r)), status(409));
});
test('Site Manager may approve PENDING directly; optional expectedVersion and trimmed note remain main behavior', async () => {
  const f = await fixture('SITE_MANAGER'),
    r = await pending(f),
    value = { ...scoped(f, r), approve: true, reviewNote: '  Ready  ' };
  const d = await f.service.decision(value);
  assert.equal(d.assignment.status, 'APPROVED');
  assert.equal(d.assignment.version, 2);
  assert.equal(d.assignment.reviewNote, 'Ready');
  assert.equal(d.assignment.siteManagerDecidedByUserId, f.actorUserId);
  assert.ok(d.assignment.reviewedAt);
  assert.equal(await version(f), 2);
  assert.equal((await audits(f))[1]?.action, 'WORKER_ASSIGNMENT_REVIEWED');
});
test('reviewed assignment decision honors expectedVersion and refuses a stale editor', async () => {
  const f = await fixture(),
    r = await f.service.request(input(f));
  await asRole(f, 'SAFETY_OFFICER');
  await f.service.safetyReview(scoped(f, r));
  await asRole(f, 'SITE_MANAGER');
  await assert.rejects(
    f.service.decision({ ...scoped(f, r), approve: true, expectedVersion: 1 }),
    status(409),
  );
  const d = await f.service.decision({ ...scoped(f, r), approve: true, expectedVersion: 2 });
  assert.equal(d.assignment.version, 3);
  assert.equal(d.assignment.status, 'APPROVED');
});
for (const mutation of [
  'inactive-worker',
  'inactive-participation',
  'worker-contractor-mismatch',
  'missing-expiry',
  'expired',
])
  test(`approval rejects ${mutation} without policy/audit mutation`, async () => {
    const f = await fixture(),
      r = await f.service.request(input(f));
    await asRole(f, 'SITE_MANAGER');
    if (mutation === 'inactive-worker')
      await db.query('UPDATE worker SET is_active=false WHERE id=$1', [f.workerId]);
    if (mutation === 'inactive-participation')
      await db.query('UPDATE contractor_site_participation SET is_active=false WHERE id=$1', [
        f.participationId,
      ]);
    if (mutation === 'worker-contractor-mismatch')
      await db.query('UPDATE worker SET contractor_id=NULL WHERE id=$1', [f.workerId]);
    if (mutation === 'missing-expiry')
      await db.query('UPDATE worker_site_zone_assignment SET valid_until=NULL WHERE id=$1', [
        r.assignment.id,
      ]);
    if (mutation === 'expired')
      await db.query(
        "UPDATE worker_site_zone_assignment SET valid_from='2000-01-01Z',valid_until='2001-01-01Z' WHERE id=$1",
        [r.assignment.id],
      );
    await assert.rejects(f.service.decision({ ...scoped(f, r), approve: true }), status(409));
    assert.equal(await version(f), 1);
    assert.equal((await audits(f)).length, 1);
  });
test('rejection remains possible when Worker eligibility has changed', async () => {
  const f = await fixture(),
    r = await f.service.request(input(f));
  await asRole(f, 'SITE_MANAGER');
  await db.query('UPDATE worker SET is_active=false WHERE id=$1', [f.workerId]);
  const d = await f.service.decision({
    ...scoped(f, r),
    approve: false,
    reviewNote: 'Needs correction',
  });
  assert.equal(d.assignment.status, 'REJECTED');
  assert.equal(await version(f), 2);
});
test('review and decision retain separate Site roles and scoped assignment ownership', async () => {
  const f = await fixture('SITE_MANAGER'),
    r = await pending(f),
    other = await fixture('SITE_MANAGER');
  await assert.rejects(f.service.safetyReview(scoped(f, r)), status(403));
  await assert.rejects(other.service.decision({ ...scoped(other, r), approve: true }), status(404));
  await asRole(f, 'SAFETY_OFFICER');
  await assert.rejects(f.service.decision({ ...scoped(f, r), approve: true }), status(403));
});

for (const role of ['SAFETY_OFFICER', 'SITE_MANAGER'])
  test(`requester cannot self-review after acquiring ${role}`, async () => {
    const f = await fixture(),
      r = await f.service.request(input(f));
    await db.query(
      'INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,$3,$4)',
      [randomUUID(), f.actorUserId, role, f.siteId],
    );
    const command = scoped(f, r);
    await assert.rejects(
      role === 'SAFETY_OFFICER'
        ? f.service.safetyReview(command)
        : f.service.decision({ ...command, approve: true }),
      status(403),
    );
    assert.equal((await audits(f)).length, 1);
    assert.equal(await version(f), 1);
  });
test('versioned revoke retains first timestamp/note/actor and exact retry creates no duplicate audit', async () => {
  const f = await fixture(),
    r = await f.service.request(input(f));
  await asRole(f, 'SITE_MANAGER');
  const d = await f.service.decision({ ...scoped(f, r), approve: true }),
    value = {
      ...scoped(f, r),
      expectedVersion: d.assignment.version,
      reviewNote: ' Withdraw permission ',
    };
  const first = await f.service.revoke(value),
    retry = await f.service.revoke({ ...value, commandId: randomUUID() });
  assert.equal(first.assignment.status, 'REVOKED');
  assert.equal(first.assignment.version, 3);
  assert.equal(first.assignment.reviewNote, 'Withdraw permission');
  assert.deepEqual(retry.assignment, first.assignment);
  assert.equal(await version(f), 3);
  assert.equal((await audits(f)).length, 3);
  await assert.rejects(
    f.service.revoke({ ...value, commandId: randomUUID(), reviewNote: 'Different reason' }),
    status(409),
  );
});
test('revoke refuses PENDING, wrong expectedVersion and wrong role', async () => {
  const f = await fixture(),
    r = await f.service.request(input(f));
  await asRole(f, 'SITE_MANAGER');
  await assert.rejects(
    f.service.revoke({ ...scoped(f, r), expectedVersion: 1, reviewNote: 'No' }),
    status(409),
  );
  await f.service.decision({ ...scoped(f, r), approve: true });
  await assert.rejects(
    f.service.revoke({ ...scoped(f, r), expectedVersion: 1, reviewNote: 'No' }),
    status(409),
  );
  await asRole(f, 'SAFETY_OFFICER');
  await assert.rejects(
    f.service.revoke({ ...scoped(f, r), expectedVersion: 2, reviewNote: 'No' }),
    status(403),
  );
});
test('same command replays its original response after later review and source deletion', async () => {
  const f = await fixture(),
    value = input(f),
    r = await f.service.request(value);
  await asRole(f, 'SITE_MANAGER');
  await f.service.decision({ ...scoped(f, r), approve: true });
  await db.query('DELETE FROM worker_site_zone_assignment WHERE id=$1', [r.assignment.id]);
  await asRole(f, 'CONTRACTOR_REPRESENTATIVE');
  const replay = await f.service.request(value);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.assignment, r.assignment);
  assert.equal((await audits(f)).length, 2);
});
for (const mutation of ['role', 'inactive', 'temporary-password', 'representative'])
  test(`command replay reauthorizes changed ${mutation}`, async () => {
    const f = await fixture('CONTRACTOR_REPRESENTATIVE'),
      value = input(f);
    await f.service.request(value);
    if (mutation === 'role')
      await db.query('DELETE FROM user_role_assignment WHERE user_id=$1', [f.actorUserId]);
    if (mutation === 'inactive')
      await db.query('UPDATE app_user SET is_active=false WHERE id=$1', [f.actorUserId]);
    if (mutation === 'temporary-password')
      await db.query('UPDATE app_user SET must_change_password=true WHERE id=$1', [f.actorUserId]);
    if (mutation === 'representative')
      await db.query('DELETE FROM contractor_representative_grant WHERE user_id=$1', [
        f.actorUserId,
      ]);
    await assert.rejects(f.service.request(value), status(403));
    assert.equal((await audits(f)).length, 1);
  });
test('concurrent same command requests create one assignment and one audit', async () => {
  const f = await fixture(),
    value = input(f),
    results = await Promise.all([f.service.request(value), f.service.request(value)]);
  assert.equal(results.filter((r) => r.replayed).length, 1);
  assert.deepEqual(results[0]?.assignment, results[1]?.assignment);
  assert.equal((await audits(f)).length, 1);
});
test('concurrent different decisions have one version winner and no extra Site increment', async () => {
  const f = await fixture(),
    r = await f.service.request(input(f));
  await asRole(f, 'SITE_MANAGER');
  const results = await Promise.allSettled([
    f.service.decision({ ...scoped(f, r), expectedVersion: 1, approve: true }),
    f.service.decision({ ...scoped(f, r), expectedVersion: 1, approve: false }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter((r) => r.status === 'rejected' && status(409)(r.reason)).length, 1);
  assert.equal(await version(f), 2);
  assert.equal((await audits(f)).length, 2);
});
test('command reuse with changed body conflicts and strict inputs reject invented fields', async () => {
  const f = await fixture(),
    value = input(f);
  await f.service.request(value);
  await assert.rejects(f.service.request({ ...value, validUntil: '2027-12-30Z' }), status(400));
  await assert.rejects(
    f.service.request({ ...value, validUntil: '2027-12-30T00:00:00Z' }),
    status(409),
  );
  await assert.rejects(
    f.service.decision({ ...scoped(f, await pending(f)), approve: true, allowed: true }),
    status(400),
  );
});
test('audit failure rolls back assignment approval, Site version, command and facts', async () => {
  const f = await fixture(),
    r = await f.service.request(input(f));
  await asRole(f, 'SITE_MANAGER');
  const value = { ...scoped(f, r), approve: true };
  await db.query(
    `CREATE FUNCTION test_assignment_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.site_id='${f.siteId}'::uuid AND NEW.action='WORKER_ASSIGNMENT_REVIEWED' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$;CREATE TRIGGER test_assignment_audit_failure BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION test_assignment_audit_failure()`,
  );
  try {
    await assert.rejects(
      f.service.decision(value),
      (error: unknown) => (error as Error).message === 'synthetic audit failure',
    );
    assert.equal(
      (
        await db.query('SELECT status,version FROM worker_site_zone_assignment WHERE id=$1', [
          r.assignment.id,
        ])
      )[0].status,
      'PENDING',
    );
    assert.equal(await version(f), 1);
    assert.equal((await audits(f)).length, 1);
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int AS n FROM authorization_history_revision WHERE command_id=$1',
          [value.commandId],
        )
      )[0].n,
      0,
    );
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
      'DROP TRIGGER test_assignment_audit_failure ON audit_log;DROP FUNCTION test_assignment_audit_failure()',
    );
  }
});
test('postcommit witness failure returns unavailable but same-ID retry cannot duplicate a request', async () => {
  const f = await fixture(),
    value = input(f);
  await db.query(
    `CREATE FUNCTION test_assignment_witness_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.command_id='${value.commandId}'::uuid THEN RAISE EXCEPTION 'synthetic witness failure'; END IF;RETURN NEW; END $$;CREATE TRIGGER test_assignment_witness_failure BEFORE INSERT ON authorization_history_commit_receipt FOR EACH ROW EXECUTE FUNCTION test_assignment_witness_failure()`,
  );
  try {
    await assert.rejects(f.service.request(value), status(503));
    assert.equal((await audits(f)).length, 1);
  } finally {
    await db.query(
      'DROP TRIGGER test_assignment_witness_failure ON authorization_history_commit_receipt;DROP FUNCTION test_assignment_witness_failure()',
    );
  }
  assert.equal((await f.service.request(value)).replayed, true);
  assert.equal((await audits(f)).length, 1);
});
test('assignment receipts cannot be overwritten, deleted or truncated', async () => {
  const f = await fixture(),
    value = input(f);
  await f.service.request(value);
  await assert.rejects(
    db.query('UPDATE worker_assignment_command_receipt SET result_hash=$2 WHERE command_id=$1', [
      value.commandId,
      'a'.repeat(64),
    ]),
  );
  await assert.rejects(db.query('DELETE FROM worker_assignment_command_receipt'));
  await assert.rejects(db.query('TRUNCATE worker_assignment_command_receipt'));
});
test('missing result schema fails closed without a partially created assignment', async () => {
  const f = await fixture(),
    value = input(f);
  await db.query(
    'ALTER TABLE worker_assignment_command_receipt RENAME TO test_hidden_assignment_result',
  );
  try {
    await assert.rejects(f.service.request(value), status(503));
    assert.equal((await audits(f)).length, 0);
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int AS n FROM worker_site_zone_assignment WHERE worker_id=$1',
          [f.workerId],
        )
      )[0].n,
      0,
    );
  } finally {
    await db.query(
      'ALTER TABLE test_hidden_assignment_result RENAME TO worker_assignment_command_receipt',
    );
  }
});

test('request retains main behavior when multiple active participation records cover the interval', async () => {
  const f = await fixture(),
    second = randomUUID();
  await db.query(
    "INSERT INTO contractor_site_participation(id,contractor_id,site_id,valid_from,valid_until) VALUES($1,$2,$3,'2026-01-01T00:00:00.000001Z','2028-01-01T00:00:00.000009Z')",
    [second, f.contractorId, f.siteId],
  );
  const r = await f.service.request(input(f));
  assert.equal(r.assignment.status, 'PENDING');
  assert.ok(
    r.assignment.siteContractorId === f.participationId || r.assignment.siteContractorId === second,
  );
  assert.equal((await audits(f)).length, 1);
});

test('request preserves a one microsecond interval without millisecond rounding', async () => {
  const f = await fixture(),
    r = await f.service.request({
      ...input(f),
      validFrom: '2027-01-01T00:00:00.000001Z',
      validUntil: '2027-01-01T00:00:00.000002Z',
    });
  assert.ok(r.assignment.validFrom.includes('.000001'));
  assert.ok(r.assignment.validUntil?.includes('.000002'));
});

test('origin transactions cannot forge an assignment response, Contractor binding or operation state', async () => {
  const f = await fixture(),
    original = await f.service.request(input(f));
  for (const forged of ['projection', 'contractor', 'operation']) {
    const runner = db.createQueryRunner(),
      commandId = randomUUID();
    try {
      await runner.startTransaction();
      await runner.query(
        'INSERT INTO authorization_history_command(command_id,actor_user_id,operation,request_hash) VALUES($1,$2,$3,$4)',
        [
          commandId,
          f.actorUserId,
          forged === 'operation' ? 'MAIN_ASSIGNMENT_DECISION' : 'MAIN_ASSIGNMENT_REQUEST',
          'b'.repeat(64),
        ],
      );
      await runner.query("SELECT set_config('smartsite.mf06_command_id',$1,true)", [commandId]);
      const projection = (
        await runner.query('SELECT mf06_assignment_response($1) AS value', [original.assignment.id])
      )[0].value;
      if (forged === 'projection') projection.siteId = randomUUID();
      await assert.rejects(
        runner.query(
          'INSERT INTO worker_assignment_command_receipt(command_id,source_id,contractor_id,result_json,result_hash) VALUES($1,$2,$3,$4,$5)',
          [
            commandId,
            original.assignment.id,
            forged === 'contractor' ? randomUUID() : f.contractorId,
            projection,
            'a'.repeat(64),
          ],
        ),
        (error: unknown) => (error as { code?: string }).code === '23514',
      );
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
    }
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int AS n FROM authorization_history_command WHERE command_id=$1',
          [commandId],
        )
      )[0].n,
      0,
    );
  }
  assert.equal((await audits(f)).length, 1);
});
