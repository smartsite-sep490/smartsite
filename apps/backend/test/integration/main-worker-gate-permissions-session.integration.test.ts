import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SITE_GATES } from '@smartsite/contracts';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { createTestConfig } from '../support/config.js';
import { WorkerGatePermissionsService } from '../../src/modules/workforce/access/worker-gate-permissions.service.js';
import { WorkerGatePermissionsController } from '../../src/modules/workforce/access/worker-gate-permissions.controller.js';
import type { MainConfigurationCommandContext } from '../../src/common/configuration/main-configuration-authority.js';
import { UserRole } from '../../src/database/entities/user.entity.js';
import { AuthService, type AuthenticatedRequest } from '../../src/modules/auth/auth.service.js';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service.js';
import { AuthClientType } from '../../src/database/entities/auth-session.entity.js';
import { UserAuthGuard } from '../../src/modules/auth/user-auth.guard.js';
import { hashPassword } from '../../src/modules/auth/password.js';

const owned = createIsolatedTestDatabase();
const db = owned.dataSource;

before(async () => {
  console.log(`ownedGatePermissionsSessionSchema=${(db.options as { schema: string }).schema}`);
  await owned.initialize();
});

after(() => owned.dispose());

type ContextSet = (
  ...args: [...Parameters<WorkerGatePermissionsService['set']>, MainConfigurationCommandContext?]
) => ReturnType<WorkerGatePermissionsService['set']>;

const emptyClearInput = { gateIds: [], expectedPermissionIds: [] };

async function fixture() {
  const actorId = randomUUID(),
    siteId = randomUUID(),
    workerId = randomUUID();
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash,is_active,must_change_password) VALUES($1,$1::uuid::text,'Synthetic Site Manager','not-a-password',true,false)",
    [actorId],
  );
  await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Site')", [
    siteId,
  ]);
  await db.query(
    "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'SITE_MANAGER',$3)",
    [randomUUID(), actorId, siteId],
  );
  await db.query(
    "INSERT INTO worker(id,site_id,external_id,display_name,is_active) VALUES($1,$2,$1::uuid::text,'Synthetic Worker',true)",
    [workerId, siteId],
  );
  const actor = {
    id: actorId,
    username: actorId,
    displayName: 'Synthetic Site Manager',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [{ role: UserRole.SITE_MANAGER, siteId }],
  };
  return {
    actorId,
    siteId,
    workerId,
    actor,
    service: new WorkerGatePermissionsService(db) as WorkerGatePermissionsService & {
      set: ContextSet;
    },
  };
}

async function siteState(siteId: string, actorId: string) {
  return {
    site: await db.query('SELECT id,access_policy_version FROM site WHERE id=$1', [siteId]),
    audits: await db.query(
      'SELECT action,entity_type,entity_id FROM audit_log WHERE site_id=$1 AND actor_account_id=$2 ORDER BY created_at,id',
      [siteId, actorId],
    ),
    commands: await db.query(
      'SELECT command_id,operation FROM authorization_history_command WHERE actor_user_id=$1 ORDER BY command_id',
      [actorId],
    ),
    revisions: await db.query(
      "SELECT command_id,source_kind,source_id,operation,(after_payload->>'access_policy_version')::int AS version FROM authorization_history_revision WHERE source_kind='SITE' AND source_id=$1 AND command_id IS NOT NULL ORDER BY revision",
      [siteId],
    ),
    receipts: await db.query(
      'SELECT r.command_id,r.transaction_id=c.transaction_id AS transaction_matches FROM authorization_history_commit_receipt r JOIN authorization_history_command c ON c.command_id=r.command_id WHERE c.actor_user_id=$1 ORDER BY r.command_id',
      [actorId],
    ),
    gaps: (await db.query('SELECT count(*)::int AS n FROM authorization_history_gap'))[0].n,
  };
}

test('Gate permissions controller binds exact original request, attributes SITE revision without gap, and rejects logged-out 401 without mutations', async () => {
  const f = await fixture();
  const password = 'Synthetic-Gate-Session-123!';
  await db.query('UPDATE app_user SET password_hash=$2 WHERE id=$1', [
    f.actorId,
    await hashPassword(password),
  ]);
  const auth = new AuthService(db, new AuthTokenService(new JwtService(), createTestConfig()));
  const guard = new UserAuthGuard(auth);
  const boundRequests: AuthenticatedRequest[] = [];
  const controller = Reflect.construct(WorkerGatePermissionsController, [
    f.service,
    guard,
  ]) as WorkerGatePermissionsController;
  const login = await auth.login(f.actorId, password, AuthClientType.WEB);
  const request: AuthenticatedRequest = {
    headers: { authorization: `Bearer ${login.accessToken}` },
  };
  await guard.authenticateRequest(request);
  const originalAuthenticate = guard.authenticateRequest.bind(guard);
  guard.authenticateRequest = async (req, manager) => {
    boundRequests.push(req);
    assert.equal(manager?.queryRunner?.isTransactionActive, true);
    return originalAuthenticate(req, manager);
  };
  const gapsBefore = (await db.query('SELECT count(*)::int AS n FROM authorization_history_gap'))[0]
    .n;

  const cleared = await controller.set(request, f.siteId, f.workerId, emptyClearInput);
  assert.deepEqual(cleared, { workerId: f.workerId, items: [] });
  assert.equal(boundRequests.length, 1);
  assert.equal(boundRequests[0], request);

  const afterAllowed = await siteState(f.siteId, f.actorId);
  assert.equal(afterAllowed.site[0].access_policy_version, 2);
  assert.deepEqual(afterAllowed.audits, [
    {
      action: 'GATE_PERMISSIONS_CHANGED',
      entity_type: 'worker',
      entity_id: f.workerId,
    },
  ]);
  assert.equal(afterAllowed.commands.length, 1);
  assert.equal(afterAllowed.commands[0].operation, 'WORKER_GATE_PERMISSIONS_SET');
  assert.deepEqual(afterAllowed.revisions, [
    {
      command_id: afterAllowed.commands[0].command_id,
      source_kind: 'SITE',
      source_id: f.siteId,
      operation: 'UPDATE',
      version: 2,
    },
  ]);
  assert.deepEqual(afterAllowed.receipts, [
    {
      command_id: afterAllowed.commands[0].command_id,
      transaction_matches: true,
    },
  ]);
  assert.equal(afterAllowed.gaps, gapsBefore);

  await auth.logout(login.refreshToken, AuthClientType.WEB);
  await assert.rejects(
    controller.set(request, f.siteId, f.workerId, emptyClearInput),
    (error: { getStatus?: () => number }) => error.getStatus?.() === 401,
  );
  assert.equal(boundRequests.length, 2);
  assert.equal(boundRequests[1], request);
  assert.deepEqual(await siteState(f.siteId, f.actorId), afterAllowed);
});

test('Gate permissions set rejects revoked exact-Site Manager role in-transaction with 403 and no mutations', async () => {
  const f = await fixture();
  const otherSiteId = randomUUID();
  await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Other Site')", [
    otherSiteId,
  ]);
  await db.query('UPDATE user_role_assignment SET site_id=$3 WHERE user_id=$1 AND site_id=$2', [
    f.actorId,
    f.siteId,
    otherSiteId,
  ]);
  const before = await siteState(f.siteId, f.actorId);
  let reauthCalls = 0;
  await assert.rejects(
    f.service.set(f.actor, f.siteId, f.workerId, emptyClearInput, {
      actorUserId: f.actorId.toUpperCase(),
      reauthorize: async (manager) => {
        reauthCalls++;
        assert.equal(manager.queryRunner?.isTransactionActive, true);
      },
    }),
    (error: { getStatus?: () => number }) => error.getStatus?.() === 403,
  );
  assert.equal(reauthCalls, 1);
  assert.deepEqual(await siteState(f.siteId, f.actorId), before);
});

test('Gate permissions set rejects normalized actor/context mismatch with 403 and no mutations', async () => {
  const f = await fixture();
  const before = await siteState(f.siteId, f.actorId);
  await assert.rejects(
    f.service.set(f.actor, f.siteId, f.workerId, emptyClearInput, {
      actorUserId: randomUUID(),
      reauthorize: async () => assert.fail('Mismatched actor context must not reauthorize'),
    }),
    (error: { getStatus?: () => number }) => error.getStatus?.() === 403,
  );
  await assert.rejects(
    f.service.set(f.actor, f.siteId, f.workerId, emptyClearInput, {
      actorUserId: f.actorId,
      reauthorize: async (manager) => {
        assert.equal(manager.queryRunner?.isTransactionActive, true);
        throw new UnauthorizedException();
      },
    }),
    (error: { getStatus?: () => number }) => error.getStatus?.() === 401,
  );
  assert.deepEqual(await siteState(f.siteId, f.actorId), before);
});

test('Attributed gate grants replace exact permissions and reject stale edits without revoking current grants', async () => {
  const f = await fixture();
  const contractor = randomUUID(),
    participation = randomUUID(),
    assignment = randomUUID();
  await db.query(
    "INSERT INTO contractor(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Contractor')",
    [contractor],
  );
  await db.query(
    "INSERT INTO contractor_site_participation(id,contractor_id,site_id,valid_from,valid_until) VALUES($1,$2,$3,clock_timestamp()-interval '2 days',clock_timestamp()+interval '3 days')",
    [participation, contractor, f.siteId],
  );
  await db.query('UPDATE worker SET contractor_id=$2 WHERE id=$1', [f.workerId, contractor]);
  await db.query(
    "INSERT INTO worker_site_zone_assignment(id,worker_id,site_id,site_contractor_id,zone_ids,status,valid_from,valid_until,requested_by_user_id) VALUES($1,$2,$3,$4,ARRAY[$5::uuid],'APPROVED',clock_timestamp()-interval '1 day',clock_timestamp()+interval '1 day',$6)",
    [assignment, f.workerId, f.siteId, participation, randomUUID(), f.actorId],
  );
  const context = { actorUserId: f.actorId, reauthorize: async () => {} };
  const gapCount = (await db.query('SELECT count(*)::int AS n FROM authorization_history_gap'))[0]
    .n;
  assert.ok(SITE_GATES.length >= 2);
  const first = await f.service.set(
    f.actor,
    f.siteId,
    f.workerId,
    {
      gateIds: [SITE_GATES[0]!.id],
      expectedPermissionIds: [],
    },
    context,
  );
  assert.equal(first.items.length, 1);
  const second = await f.service.set(
    f.actor,
    f.siteId,
    f.workerId,
    {
      gateIds: [SITE_GATES[1]!.id],
      expectedPermissionIds: [first.items[0]!.id],
    },
    context,
  );
  assert.equal(second.items.length, 1);
  assert.equal(second.items[0]!.gateId, SITE_GATES[1]!.id);
  const permissions = () =>
    db.query(
      "SELECT id,gate_id,worker_assignment_id,created_by_user_id,revoked_by_user_id,revoked_at IS NOT NULL AS revoked,valid_until=date_trunc('milliseconds',(SELECT valid_until FROM worker_site_zone_assignment WHERE id=$2)) AS legacy_expiry_precision FROM worker_gate_permission WHERE worker_id=$1 ORDER BY id",
      [f.workerId, assignment],
    );
  const stored = await permissions();
  assert.equal(stored.length, 2);
  for (const row of stored) {
    assert.equal(row.worker_assignment_id, assignment);
    assert.equal(row.created_by_user_id, f.actorId);
    assert.equal(row.legacy_expiry_precision, true);
    assert.equal(row.revoked, row.id === first.items[0]!.id);
    assert.equal(row.revoked_by_user_id, row.revoked ? f.actorId : null);
    assert.equal(row.id, row.revoked ? first.items[0]!.id : second.items[0]!.id);
    assert.equal(row.gate_id, row.revoked ? SITE_GATES[0]!.id : SITE_GATES[1]!.id);
  }
  const beforeStale = await siteState(f.siteId, f.actorId);
  await assert.rejects(
    f.service.set(
      f.actor,
      f.siteId,
      f.workerId,
      {
        gateIds: [],
        expectedPermissionIds: [first.items[0]!.id],
      },
      context,
    ),
    (error: { getStatus?: () => number }) => error.getStatus?.() === 409,
  );
  assert.deepEqual(await permissions(), stored);
  assert.deepEqual(await siteState(f.siteId, f.actorId), beforeStale);
  assert.equal(beforeStale.commands.length, 2);
  assert.equal(beforeStale.revisions.length, 2);
  assert.equal(beforeStale.gaps, gapCount);
});
