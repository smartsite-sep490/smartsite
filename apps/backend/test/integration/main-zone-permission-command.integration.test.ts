import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { DataSource } from 'typeorm';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { QrAccess1791417600000 } from '../../src/database/migrations/1791417600000-QrAccess.js';
import { ErdVisitorAccess1791504000000 } from '../../src/database/migrations/1791504000000-ErdVisitorAccess.js';
import { ErdZonePermissions1791504000003 } from '../../src/database/migrations/1791504000003-ErdZonePermissions.js';
import { Mf06MainAuthorityJournal1791590400002 } from '../../src/database/migrations/1791590400002-Mf06MainAuthorityJournal.js';

interface Permission {
  id: string;
  siteId: string;
  contractorId: string;
  siteContractorId: string;
  zoneId: string;
  workerAssignmentId: string | null;
  contractorZonePermissionId: string | null;
  validFrom: string;
  validUntil: string;
  grantedBy: string;
  revokedAt: string | null;
  createdAt: string;
}
interface Result {
  commandId: string;
  replayed: boolean;
  permission: Permission;
}
interface Writer {
  grantContractor(input: unknown): Promise<Result>;
  grantWorker(input: unknown): Promise<Result>;
  revokeContractor(input: unknown): Promise<Result>;
  revokeWorker(input: unknown): Promise<Result>;
}
let WriterClass: (new (source: DataSource) => Writer) | undefined;
const database = createIsolatedTestDatabase({ legacy: true }),
  db = database.dataSource;
before(async () => {
  try {
    const url = new URL(
      '../../src/modules/zones/main-zone-permission-command.service.js',
      import.meta.url,
    );
    WriterClass = (await import(url.href)).MainZonePermissionCommandService;
  } catch (error) {
    if ((error as { code?: string }).code !== 'ERR_MODULE_NOT_FOUND') throw error;
  }
  if (!WriterClass) return;
  await database.initialize();
  const runner = db.createQueryRunner();
  try {
    await runner.startTransaction();
    await new QrAccess1791417600000().up(runner);
    await new ErdVisitorAccess1791504000000().up(runner);
    const gate = await import(
      new URL('../../src/database/migrations/1791504000001-ErdGateFlow.js', import.meta.url).href
    );
    await new gate.ErdGateFlow1791504000001().up(runner);
    await new ErdZonePermissions1791504000003().up(runner);
    const audit = await import(
      new URL('../../src/database/migrations/1791504000004-ErdAccessAudit.js', import.meta.url).href
    );
    const policy = await import(
      new URL('../../src/database/migrations/1791504000006-ErdAccessPolicy.js', import.meta.url)
        .href
    );
    await new audit.ErdAccessAudit1791504000004().up(runner);
    await new policy.ErdAccessPolicy1791504000006().up(runner);
    await new Mf06MainAuthorityJournal1791590400002().up(runner);
    await runner.commitTransaction();
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
  }
});
after(async () => {
  await database.dispose();
});

async function fixture(role = 'ADMIN') {
  assert.ok(WriterClass, 'Retained-main anchored permission writer is not implemented');
  const actorUserId = randomUUID(),
    siteId = randomUUID(),
    contractorId = randomUUID(),
    participationId = randomUUID(),
    zoneId = randomUUID(),
    workerId = randomUUID(),
    assignmentId = randomUUID();
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
    "INSERT INTO contractor_site_participation(id,contractor_id,site_id,valid_from,valid_until) VALUES($1,$2,$3,'2026-10-01T00:00:00.000001Z','2026-12-01T00:00:00.000009Z')",
    [participationId, contractorId, siteId],
  );
  await db.query(
    'INSERT INTO contractor_representative_grant(id,user_id,contractor_id) VALUES($1,$2,$3)',
    [randomUUID(), actorUserId, contractorId],
  );
  await db.query(
    "INSERT INTO zone(id,site_id,code,name,type,restriction_policy) VALUES($1,$2,$1::uuid::text,'Synthetic Zone','RESTRICTED','AUTHORIZATION_REQUIRED')",
    [zoneId, siteId],
  );
  await db.query(
    "INSERT INTO worker(id,site_id,contractor_id,external_id,display_name) VALUES($1,$2,$3,$1::uuid::text,'Synthetic Worker')",
    [workerId, siteId, contractorId],
  );
  await db.query(
    "INSERT INTO worker_site_zone_assignment(id,worker_id,site_id,site_contractor_id,zone_ids,status,valid_from,valid_until,requested_by_user_id) VALUES($1,$2,$3,$4,ARRAY[$5::uuid],'APPROVED','2026-10-01T00:00:00.000001Z','2026-11-01T00:00:00.000006Z',$6)",
    [assignmentId, workerId, siteId, participationId, zoneId, actorUserId],
  );
  return {
    actorUserId,
    siteId,
    contractorId,
    participationId,
    zoneId,
    workerId,
    assignmentId,
    service: new WriterClass(db),
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function contractorInput(f: Fixture) {
  return {
    commandId: randomUUID(),
    actorUserId: f.actorUserId,
    siteId: f.siteId,
    requestId: randomUUID(),
    siteContractorId: f.participationId,
    zoneId: f.zoneId,
    validFrom: '2026-10-01T00:00:00.000002Z',
    validUntil: '2026-11-01T00:00:00.000007Z',
  };
}
function workerInput(f: Fixture, cp: Result) {
  return {
    commandId: randomUUID(),
    actorUserId: f.actorUserId,
    siteId: f.siteId,
    requestId: randomUUID(),
    workerAssignmentId: f.assignmentId,
    contractorZonePermissionId: cp.permission.id,
    validFrom: '2026-10-01T00:00:00.000003Z',
    validUntil: '2026-11-01T00:00:00.000005Z',
  };
}
function revokeInput(f: Fixture, p: Result) {
  return {
    commandId: randomUUID(),
    actorUserId: f.actorUserId,
    siteId: f.siteId,
    permissionId: p.permission.id,
  };
}
function status(n: number) {
  return (e: unknown) => (e as { getStatus?: () => number }).getStatus?.() === n;
}
async function grantPair(f: Fixture) {
  // Seed through the actual Admin command, then restore the fixture's role for Worker authorization.
  const roles = await db.query('SELECT role,site_id FROM user_role_assignment WHERE user_id=$1', [
    f.actorUserId,
  ]);
  await db.query("UPDATE user_role_assignment SET role='ADMIN',site_id=NULL WHERE user_id=$1", [
    f.actorUserId,
  ]);
  const cp = await f.service.grantContractor(contractorInput(f));
  await db.query('UPDATE user_role_assignment SET role=$2,site_id=$3 WHERE user_id=$1', [
    f.actorUserId,
    roles[0].role,
    roles[0].site_id,
  ]);
  return cp;
}
async function count(table: string, column: string, value: string) {
  const allowed = new Set([
    'mf06_authority_command:command_id',
    'audit_log:site_id',
    'mf06_authority_fact:command_id',
    'mf06_zone_permission_command_result:command_id',
  ]);
  assert.ok(allowed.has(`${table}:${column}`));
  return (await db.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${column}=$1`, [value]))[0]
    .n as number;
}

test('Contractor grant commits permission, Site version, audit and transaction facts with exact microseconds', async () => {
  const f = await fixture('SITE_MANAGER'),
    input = contractorInput(f),
    r = await f.service.grantContractor(input);
  assert.equal(r.permission.id, input.requestId);
  assert.equal(r.permission.grantedBy, f.actorUserId);
  assert.ok(r.permission.validFrom.includes('.000002'));
  assert.ok(r.permission.validUntil.includes('.000007'));
  assert.equal(r.permission.workerAssignmentId, null);
  assert.equal(r.permission.siteContractorId, f.participationId);
  assert.equal(
    (await db.query('SELECT access_policy_version FROM site WHERE id=$1', [f.siteId]))[0]
      .access_policy_version,
    2,
  );
  assert.equal(await count('audit_log', 'site_id', f.siteId), 1);
  assert.deepEqual(
    (
      await db.query(
        'SELECT source_kind,f.transaction_id=c.transaction_id AS same_tx FROM mf06_authority_fact f JOIN mf06_authority_command c USING(command_id) WHERE command_id=$1 ORDER BY source_kind',
        [input.commandId],
      )
    ).map((r: { source_kind: string; same_tx: boolean }) => [r.source_kind, r.same_tx]),
    [
      ['CONTRACTOR_PERMISSION', true],
      ['SITE', true],
    ],
  );
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int AS n FROM mf06_authority_commit_witness WHERE command_id=$1',
        [input.commandId],
      )
    )[0].n,
    1,
  );
});
test('Worker grant follows approved assignment and Contractor permission without flat ALLOW', async () => {
  const f = await fixture('CONTRACTOR_REPRESENTATIVE'),
    cp = await grantPair(f),
    input = workerInput(f, cp),
    r = await f.service.grantWorker(input);
  assert.equal(r.permission.workerAssignmentId, f.assignmentId);
  assert.equal(r.permission.contractorZonePermissionId, cp.permission.id);
  assert.ok(r.permission.validUntil.includes('.000005'));
  assert.equal(await count('audit_log', 'site_id', f.siteId), 2);
  assert.equal(
    (
      await db.query('SELECT count(*)::int AS n FROM zone_access_grant WHERE worker_id=$1', [
        f.workerId,
      ])
    )[0].n,
    0,
  );
});
for (const role of ['CONTRACTOR_REPRESENTATIVE', 'SAFETY_OFFICER', 'WORKER']) {
  test(`Contractor grant rejects ${role} without a Site Manager role`, async () => {
    const f = await fixture(role);
    await assert.rejects(f.service.grantContractor(contractorInput(f)), status(403));
    assert.equal(await count('audit_log', 'site_id', f.siteId), 0);
  });
}
test('Worker grant rejects Site Manager alone and representative of another Contractor', async () => {
  const f = await fixture('SITE_MANAGER'),
    cp = await grantPair(f);
  await assert.rejects(f.service.grantWorker(workerInput(f, cp)), status(403));
  await db.query(
    "UPDATE user_role_assignment SET role='CONTRACTOR_REPRESENTATIVE' WHERE user_id=$1",
    [f.actorUserId],
  );
  await db.query('DELETE FROM contractor_representative_grant WHERE user_id=$1', [f.actorUserId]);
  await assert.rejects(f.service.grantWorker(workerInput(f, cp)), status(409));
});
test('same command replay preserves original response after revoke and deletion without audit or Site increment', async () => {
  const f = await fixture(),
    input = contractorInput(f),
    first = await f.service.grantContractor(input);
  await f.service.revokeContractor(revokeInput(f, first));
  await db.query('DELETE FROM contractor_zone_permission WHERE id=$1', [first.permission.id]);
  const r = await f.service.grantContractor(input);
  assert.equal(r.replayed, true);
  assert.deepEqual(r.permission, first.permission);
  assert.equal(await count('audit_log', 'site_id', f.siteId), 2);
  assert.equal(
    (await db.query('SELECT access_policy_version FROM site WHERE id=$1', [f.siteId]))[0]
      .access_policy_version,
    3,
  );
});
test('Worker replay reauthorizes representative even when original source has been deleted', async () => {
  const f = await fixture('CONTRACTOR_REPRESENTATIVE'),
    cp = await grantPair(f),
    input = workerInput(f, cp),
    first = await f.service.grantWorker(input);
  await db.query('DELETE FROM worker_zone_permission WHERE id=$1', [first.permission.id]);
  assert.deepEqual((await f.service.grantWorker(input)).permission, first.permission);
  await db.query('DELETE FROM contractor_representative_grant WHERE user_id=$1', [f.actorUserId]);
  await assert.rejects(f.service.grantWorker(input), status(409));
});
test('changed command body or reused permission request ID with changed bounds conflicts without additional side effects', async () => {
  const f = await fixture(),
    input = contractorInput(f);
  await f.service.grantContractor(input);
  await assert.rejects(
    f.service.grantContractor({ ...input, validUntil: '2026-11-02T00:00:00Z' }),
    status(409),
  );
  await assert.rejects(
    f.service.grantContractor({
      ...input,
      commandId: randomUUID(),
      validUntil: '2026-11-02T00:00:00Z',
    }),
    status(409),
  );
  assert.equal(await count('audit_log', 'site_id', f.siteId), 1);
});
for (const mutation of ['inactive', 'temporary-password', 'other-site-role']) {
  test(`replay rejects ${mutation} actor state`, async () => {
    const f = await fixture('SITE_MANAGER'),
      input = contractorInput(f);
    await f.service.grantContractor(input);
    if (mutation === 'inactive')
      await db.query('UPDATE app_user SET is_active=false WHERE id=$1', [f.actorUserId]);
    else if (mutation === 'temporary-password')
      await db.query('UPDATE app_user SET must_change_password=true WHERE id=$1', [f.actorUserId]);
    else {
      const other = await fixture();
      await db.query('UPDATE user_role_assignment SET site_id=$2 WHERE user_id=$1', [
        f.actorUserId,
        other.siteId,
      ]);
    }
    await assert.rejects(f.service.grantContractor(input), status(403));
    assert.equal(await count('audit_log', 'site_id', f.siteId), 1);
  });
}
test('Contractor grant enforces same Site and active participation', async () => {
  const f = await fixture(),
    other = await fixture();
  await assert.rejects(
    f.service.grantContractor({ ...contractorInput(f), zoneId: other.zoneId }),
    status(404),
  );
  await db.query('UPDATE contractor_site_participation SET is_active=false WHERE id=$1', [
    f.participationId,
  ]);
  await assert.rejects(f.service.grantContractor(contractorInput(f)), status(404));
  assert.equal(await count('audit_log', 'site_id', f.siteId), 0);
});
test('Contractor and Worker intervals are bounded using PostgreSQL microseconds', async () => {
  const f = await fixture(),
    cp = await f.service.grantContractor(contractorInput(f));
  await assert.rejects(
    f.service.grantContractor({ ...contractorInput(f), validFrom: '2026-10-01T00:00:00.000000Z' }),
    status(409),
  );
  await assert.rejects(
    f.service.grantWorker({ ...workerInput(f, cp), validUntil: '2026-11-01T00:00:00.000007Z' }),
    status(409),
  );
  await assert.rejects(
    f.service.grantWorker({ ...workerInput(f, cp), validFrom: '2026-10-01T00:00:00.000001Z' }),
    status(409),
  );
  await assert.rejects(
    f.service.grantWorker({ ...workerInput(f, cp), validUntil: '2026-10-01T00:00:00.000003Z' }),
    status(409),
  );
  assert.equal(await count('audit_log', 'site_id', f.siteId), 1);
});
for (const mutation of [
  'unapproved',
  'no-expiry',
  'revoked-parent',
  'inactive-worker',
  'worker-other-contractor',
  'inactive-participation',
]) {
  test(`Worker grant rejects ${mutation}`, async () => {
    const f = await fixture(),
      cp = await f.service.grantContractor(contractorInput(f));
    if (mutation === 'unapproved')
      await db.query("UPDATE worker_site_zone_assignment SET status='PENDING' WHERE id=$1", [
        f.assignmentId,
      ]);
    if (mutation === 'no-expiry')
      await db.query('UPDATE worker_site_zone_assignment SET valid_until=NULL WHERE id=$1', [
        f.assignmentId,
      ]);
    if (mutation === 'revoked-parent') await f.service.revokeContractor(revokeInput(f, cp));
    if (mutation === 'inactive-worker')
      await db.query('UPDATE worker SET is_active=false WHERE id=$1', [f.workerId]);
    if (mutation === 'worker-other-contractor')
      await db.query('UPDATE worker SET contractor_id=NULL WHERE id=$1', [f.workerId]);
    if (mutation === 'inactive-participation')
      await db.query('UPDATE contractor_site_participation SET is_active=false WHERE id=$1', [
        f.participationId,
      ]);
    const input = workerInput(f, cp);
    await assert.rejects(f.service.grantWorker(input), status(409));
    assert.equal(await count('mf06_authority_command', 'command_id', input.commandId), 0);
  });
}
test('Worker grant rejects a permission from another participation', async () => {
  const f = await fixture(),
    other = await fixture(),
    cp = await other.service.grantContractor(contractorInput(other));
  await assert.rejects(f.service.grantWorker(workerInput(f, cp)), status(409));
});
test('first revoke is retained; new no-op revoke records a result but no extra audit or policy increment', async () => {
  const f = await fixture(),
    cp = await f.service.grantContractor(contractorInput(f)),
    wp = await f.service.grantWorker(workerInput(f, cp));
  const input = revokeInput(f, wp),
    first = await f.service.revokeWorker(input),
    again = await f.service.revokeWorker(revokeInput(f, wp));
  assert.ok(first.permission.revokedAt);
  assert.equal(again.permission.revokedAt, first.permission.revokedAt);
  assert.deepEqual((await f.service.revokeWorker(input)).permission, first.permission);
  assert.equal(await count('audit_log', 'site_id', f.siteId), 3);
  assert.equal(
    (await db.query('SELECT access_policy_version FROM site WHERE id=$1', [f.siteId]))[0]
      .access_policy_version,
    4,
  );
});
test('revokes retain main roles and cross-Site boundaries, even for inactive participation', async () => {
  const f = await fixture('CONTRACTOR_REPRESENTATIVE'),
    cp = await grantPair(f),
    wp = await f.service.grantWorker(workerInput(f, cp));
  await assert.rejects(f.service.revokeContractor(revokeInput(f, cp)), status(403));
  const other = await fixture();
  await assert.rejects(other.service.revokeWorker({ ...revokeInput(other, wp) }), status(404));
  await db.query('UPDATE contractor_site_participation SET is_active=false WHERE id=$1', [
    f.participationId,
  ]);
  assert.ok((await f.service.revokeWorker(revokeInput(f, wp))).permission.revokedAt);
});
test('concurrent same-ID grants commit exactly one permission, audit and policy increment', async () => {
  const f = await fixture(),
    input = contractorInput(f),
    results = await Promise.all([
      f.service.grantContractor(input),
      f.service.grantContractor(input),
    ]);
  assert.equal(results.filter((r) => r.replayed).length, 1);
  assert.deepEqual(results[0].permission, results[1].permission);
  assert.equal(await count('audit_log', 'site_id', f.siteId), 1);
  assert.equal(
    (await db.query('SELECT access_policy_version FROM site WHERE id=$1', [f.siteId]))[0]
      .access_policy_version,
    2,
  );
});
test('unique interval collision returns conflict and rolls back the losing command', async () => {
  const f = await fixture(),
    first = contractorInput(f);
  await f.service.grantContractor(first);
  const other = { ...first, requestId: randomUUID(), commandId: randomUUID() };
  await assert.rejects(f.service.grantContractor(other), status(409));
  assert.equal(await count('mf06_authority_command', 'command_id', other.commandId), 0);
  assert.equal(await count('audit_log', 'site_id', f.siteId), 1);
});
test('audit failure rolls back permission, Site increment, command and facts', async () => {
  const f = await fixture(),
    input = contractorInput(f);
  await db.query(
    `CREATE FUNCTION test_reject_permission_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.site_id='${f.siteId}'::uuid THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_reject_permission_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION test_reject_permission_audit()`,
  );
  try {
    await assert.rejects(f.service.grantContractor(input));
    assert.equal(await count('mf06_authority_command', 'command_id', input.commandId), 0);
    assert.equal(await count('mf06_authority_fact', 'command_id', input.commandId), 0);
    assert.equal(
      (await db.query('SELECT access_policy_version FROM site WHERE id=$1', [f.siteId]))[0]
        .access_policy_version,
      1,
    );
  } finally {
    await db.query(
      'DROP TRIGGER test_reject_permission_audit ON audit_log; DROP FUNCTION test_reject_permission_audit()',
    );
  }
});
test('postcommit witness failure safely retries same command without duplicating business writes', async () => {
  const f = await fixture(),
    input = contractorInput(f);
  await db.query(
    `CREATE FUNCTION test_reject_permission_witness() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.command_id='${input.commandId}'::uuid THEN RAISE EXCEPTION 'synthetic witness failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER test_reject_permission_witness BEFORE INSERT ON mf06_authority_commit_witness FOR EACH ROW EXECUTE FUNCTION test_reject_permission_witness()`,
  );
  try {
    await assert.rejects(f.service.grantContractor(input), status(503));
    assert.equal(await count('audit_log', 'site_id', f.siteId), 1);
  } finally {
    await db.query(
      'DROP TRIGGER test_reject_permission_witness ON mf06_authority_commit_witness; DROP FUNCTION test_reject_permission_witness()',
    );
  }
  assert.equal((await f.service.grantContractor(input)).replayed, true);
  assert.equal(await count('audit_log', 'site_id', f.siteId), 1);
});
test('result receipts are immutable and forged or foreign-origin projections are rejected', async () => {
  const f = await fixture(),
    input = contractorInput(f),
    r = await f.service.grantContractor(input);
  await assert.rejects(
    db.query('UPDATE mf06_zone_permission_command_result SET result_hash=$2 WHERE command_id=$1', [
      input.commandId,
      'a'.repeat(64),
    ]),
  );
  await assert.rejects(
    db.query('DELETE FROM mf06_zone_permission_command_result WHERE command_id=$1', [
      input.commandId,
    ]),
  );
  await assert.rejects(db.query('TRUNCATE mf06_zone_permission_command_result'));
  await assert.rejects(
    db.query(
      "INSERT INTO mf06_zone_permission_command_result(command_id,source_id,kind,result_json,result_hash) VALUES($1,$2,'contractor',$3,'')",
      [input.commandId, r.permission.id, r.permission],
    ),
  );
});
test('strict commands reject unknown fields and missing finite expiry before database writes', async () => {
  const f = await fixture(),
    input = contractorInput(f);
  for (const v of [
    { ...input, allowed: true },
    { ...input, validUntil: null },
    { ...input, validUntil: undefined },
    { ...input, commandId: 'track-12' },
  ])
    await assert.rejects(f.service.grantContractor(v), status(400));
  assert.equal(await count('audit_log', 'site_id', f.siteId), 0);
});
test('missing candidate result table fails closed and rolls back source writes', async () => {
  const f = await fixture(),
    input = contractorInput(f);
  await db.query(
    'ALTER TABLE mf06_zone_permission_command_result RENAME TO test_hidden_permission_result',
  );
  try {
    await assert.rejects(f.service.grantContractor(input), status(503));
    assert.equal(await count('mf06_authority_command', 'command_id', input.commandId), 0);
    assert.equal(await count('audit_log', 'site_id', f.siteId), 0);
  } finally {
    await db.query(
      'ALTER TABLE test_hidden_permission_result RENAME TO mf06_zone_permission_command_result',
    );
  }
});
test('retained-main request ID retries through another command do not duplicate grants or audit', async () => {
  const f = await fixture(),
    input = contractorInput(f),
    cp = await f.service.grantContractor(input);
  const retry = await f.service.grantContractor({ ...input, commandId: randomUUID() });
  assert.equal(retry.replayed, false);
  assert.deepEqual(retry.permission, cp.permission);
  const w = workerInput(f, cp),
    wp = await f.service.grantWorker(w);
  assert.deepEqual(
    (await f.service.grantWorker({ ...w, commandId: randomUUID() })).permission,
    wp.permission,
  );
  assert.equal(await count('audit_log', 'site_id', f.siteId), 2);
});
test('one microsecond Worker interval remains nonempty and accepted within all parents', async () => {
  const f = await fixture(),
    cp = await f.service.grantContractor(contractorInput(f)),
    input = workerInput(f, cp);
  const p = await f.service.grantWorker({ ...input, validUntil: '2026-10-01T00:00:00.000004Z' });
  assert.ok(p.permission.validFrom.includes('.000003'));
  assert.ok(p.permission.validUntil.includes('.000004'));
});
test('a current transaction cannot forge a scoped result for another Site or operation kind', async () => {
  const f = await fixture(),
    input = contractorInput(f),
    cp = await f.service.grantContractor(input),
    r = db.createQueryRunner();
  try {
    await r.startTransaction();
    const cmd = randomUUID();
    await r.query(
      "INSERT INTO mf06_authority_command(command_id,actor_user_id,operation,request_hash) VALUES($1,$2,'MAIN_CONTRACTOR_ZONE_GRANT',$3)",
      [cmd, f.actorUserId, 'b'.repeat(64)],
    );
    await r.query("SELECT set_config('smartsite.mf06_command_id',$1,true)", [cmd]);
    await assert.rejects(
      r.query(
        "INSERT INTO mf06_zone_permission_command_result(command_id,source_id,kind,result_json,result_hash) VALUES($1,$2,'contractor',$3,'')",
        [cmd, cp.permission.id, { ...cp.permission, siteId: randomUUID() }],
      ),
      (e: unknown) => (e as { driverError?: { code?: string } }).driverError?.code === '23514',
    );
    await r.rollbackTransaction();
    await r.startTransaction();
    const wrongKindCommand = randomUUID();
    await r.query(
      "INSERT INTO mf06_authority_command(command_id,actor_user_id,operation,request_hash) VALUES($1,$2,'MAIN_WORKER_ZONE_GRANT',$3)",
      [wrongKindCommand, f.actorUserId, 'c'.repeat(64)],
    );
    await r.query("SELECT set_config('smartsite.mf06_command_id',$1,true)", [wrongKindCommand]);
    await assert.rejects(
      r.query(
        "INSERT INTO mf06_zone_permission_command_result(command_id,source_id,kind,result_json,result_hash) VALUES($1,$2,'contractor',$3,'')",
        [wrongKindCommand, cp.permission.id, cp.permission],
      ),
      (e: unknown) => (e as { driverError?: { code?: string } }).driverError?.code === '23514',
    );
    await r.rollbackTransaction();
  } finally {
    if (r.isTransactionActive) await r.rollbackTransaction();
    await r.release();
  }
});
test('Worker grant reflects current authorization reader and Contractor revoke denies the anchored path', async () => {
  const f = await fixture(),
    cp = await f.service.grantContractor(contractorInput(f));
  await f.service.grantWorker(workerInput(f, cp));
  const { ZoneEntryAuthorizationService } =
    await import('../../src/modules/zones/zone-entry-authorization.service.js');
  const reader = new ZoneEntryAuthorizationService();
  const context = {
    eventId: randomUUID(),
    trackId: 1,
    siteId: f.siteId,
    zoneId: f.zoneId,
    evaluatedAt: new Date('2026-10-31Z'),
    verifiedWorkerId: f.workerId,
  };
  assert.equal((await reader.decide(db.manager, context)).status, 'ALLOWED');
  await f.service.revokeContractor(revokeInput(f, cp));
  assert.equal((await reader.decide(db.manager, context)).status, 'DENIED');
});
