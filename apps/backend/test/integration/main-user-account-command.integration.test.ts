import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { DataSource, type QueryRunner } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import { computeCanonicalPayloadHash } from '@smartsite/contracts';
import { AppModule } from '../../src/app.module.js';
import { configureApplication } from '../../src/configure-app.js';
import { validateEnvironment, type BackendEnvironment } from '../../src/config/environment.js';
import { createLoggerParams } from '../../src/observability/logger.js';
import { UserAuthGuard } from '../../src/modules/auth/user-auth.guard.js';
import { UsersController } from '../../src/modules/users/users.controller.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import { installMainAuthorityCandidate } from '../support/main-authority-candidate.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

const database = createIsolatedTestDatabase({ canonical: true }),
  db = database.dataSource;

before(async () => {
  await database.initialize();
  await installMainAuthorityCandidate(db);
});

after(async () => {
  await database.dispose();
});

async function fixture() {
  const f = {
    admin: randomUUID(),
    secondAdmin: randomUUID(),
    worker: randomUUID(),
    target: randomUUID(),
    site: randomUUID(),
    otherSite: randomUUID(),
    defaultPassword: 'SyntheticUserPass123!',
  };

  const passwordHash = await hashPassword(f.defaultPassword);

  // Primary Admin
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash,must_change_password,is_active) VALUES($1,$1::uuid::text,'Synthetic Admin',$2,false,true)",
    [f.admin, passwordHash],
  );
  await db.query(
    "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'ADMIN',NULL)",
    [randomUUID(), f.admin],
  );

  // Second Admin (retains at least 2 active Admins for testing last-admin rules)
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash,must_change_password,is_active) VALUES($1,$1::uuid::text,'Synthetic Second Admin',$2,false,true)",
    [f.secondAdmin, passwordHash],
  );
  await db.query(
    "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'ADMIN',NULL)",
    [randomUUID(), f.secondAdmin],
  );

  // Sites
  await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Site 1')", [
    f.site,
  ]);
  await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Site 2')", [
    f.otherSite,
  ]);

  // Worker user
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash,must_change_password,is_active) VALUES($1,$1::uuid::text,'Synthetic Worker',$2,false,true)",
    [f.worker, passwordHash],
  );
  await db.query(
    "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'WORKER',$3)",
    [randomUUID(), f.worker, f.site],
  );

  // Target user
  await db.query(
    "INSERT INTO app_user(id,username,display_name,password_hash,must_change_password,is_active) VALUES($1,$1::uuid::text,'Synthetic Target',$2,false,true)",
    [f.target, passwordHash],
  );
  await db.query(
    "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'WORKER',$3)",
    [randomUUID(), f.target, f.site],
  );

  return f;
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

interface ClientContext {
  call: (
    method: 'POST' | 'PATCH' | 'PUT' | 'GET',
    path: string,
    body?: unknown,
    token?: string,
  ) => Promise<Response>;
  login: (
    username: string,
    password?: string,
  ) => Promise<{ accessToken: string; refreshToken: string }>;
  logout: (token: string, refreshToken: string) => Promise<Response>;
  guard: UserAuthGuard;
  apiDb: DataSource;
  adminToken: string;
  adminRefreshToken: string;
}

async function withApi(f: Fixture, work: (ctx: ClientContext) => Promise<void>) {
  const configuration = new ConfigService<BackendEnvironment, true>(
    validateEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      LOG_FORMAT: 'json',
      THROTTLE_LIMIT: '1000',
    }),
  );
  const apiDb = new DataSource(db.options);
  await apiDb.initialize();

  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ConfigService)
    .useValue(configuration)
    .overrideProvider(PARAMS_PROVIDER_TOKEN)
    .useValue(createLoggerParams(configuration, { write: () => undefined }))
    .overrideProvider(getDataSourceToken())
    .useValue(apiDb)
    .overrideProvider(DataSource)
    .useValue(apiDb)
    .compile();

  const app = module.createNestApplication<NestExpressApplication>({
    logger: false,
    bodyParser: false,
  });

  try {
    await configureApplication(app);
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl();

    const loginHelper = async (username: string, password = f.defaultPassword) => {
      const response = await fetch(url + '/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, clientType: 'MOBILE' }),
      });
      assert.equal(response.status, 200, `Login failed for user ${username}`);
      return (await response.json()) as { accessToken: string; refreshToken: string };
    };

    const adminSession = await loginHelper(f.admin);
    const guard = (module.get(UsersController) as unknown as { auth: UserAuthGuard }).auth;

    const callHelper = (
      method: 'POST' | 'PATCH' | 'PUT' | 'GET',
      path: string,
      body?: unknown,
      token = adminSession.accessToken,
    ) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = 'Bearer ' + token;
      }
      return fetch(url + path, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    };

    const logoutHelper = (token: string, refreshToken: string) => {
      return fetch(url + '/api/v1/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
        },
        body: JSON.stringify({ clientType: 'MOBILE', refreshToken }),
      });
    };

    await work({
      call: callHelper,
      login: loginHelper,
      logout: logoutHelper,
      guard,
      apiDb,
      adminToken: adminSession.accessToken,
      adminRefreshToken: adminSession.refreshToken,
    });
  } finally {
    await app.close();
    if (apiDb.isInitialized) await apiDb.destroy();
  }
}

interface Fact {
  fact_id: string;
  revision: number;
  source_kind: string;
  source_id: string;
  operation: string;
  before_payload: Record<string, unknown> | null;
  after_payload: Record<string, unknown> | null;
  command_id: string;
  actor_user_id: string;
  command_operation: string;
  request_hash: string;
  bound: boolean;
  witnessed: boolean | null;
  epoch_state: string | null;
}

async function factsForSource(sourceKind: string, sourceId: string): Promise<Fact[]> {
  return db.query(
    `SELECT f.fact_id, f.revision::int AS revision, f.source_kind, f.source_id, f.operation,
            f.before_payload, f.after_payload,
            c.command_id, c.actor_user_id, c.operation AS command_operation, c.request_hash,
            f.transaction_id = c.transaction_id AS bound,
            w.transaction_id = c.transaction_id AS witnessed,
            e.state AS epoch_state
     FROM mf06_authority_fact f
     JOIN mf06_authority_command c USING(command_id)
     LEFT JOIN mf06_authority_commit_witness w USING(command_id)
     LEFT JOIN mf06_authority_epoch e ON e.epoch_id = f.epoch_id
     WHERE f.source_kind = $1 AND f.source_id = $2
     ORDER BY f.observed_at ASC, f.revision ASC`,
    [sourceKind, sourceId],
  );
}

async function accountHeadRevision(sourceId: string): Promise<number> {
  // Fixture inserts are intentionally unattributed and excluded by the command INNER JOIN.
  // Revisions still include those real source writes; never pretend their actor is known.
  const rows: { revision: number }[] = await db.query(
    "SELECT revision::int AS revision FROM mf06_authority_head WHERE source_kind='USER_ACCOUNT' AND source_id=$1",
    [sourceId],
  );
  const row = rows[0];
  assert.ok(row, 'Fixture source insert must already have a real head revision');
  return row.revision;
}

async function factsForCommand(commandOperation: string, actorUserId: string): Promise<Fact[]> {
  return db.query(
    `SELECT f.fact_id, f.revision::int AS revision, f.source_kind, f.source_id, f.operation,
            f.before_payload, f.after_payload,
            c.command_id, c.actor_user_id, c.operation AS command_operation, c.request_hash,
            f.transaction_id = c.transaction_id AS bound,
            w.transaction_id = c.transaction_id AS witnessed,
            e.state AS epoch_state
     FROM mf06_authority_fact f
     JOIN mf06_authority_command c USING(command_id)
     LEFT JOIN mf06_authority_commit_witness w USING(command_id)
     LEFT JOIN mf06_authority_epoch e ON e.epoch_id = f.epoch_id
     WHERE c.operation = $1 AND c.actor_user_id = $2
     ORDER BY f.observed_at ASC, f.revision ASC`,
    [commandOperation, actorUserId],
  );
}

async function activeSessionCount(userId: string): Promise<number> {
  const rows = await db.query(
    'SELECT count(*)::int AS n FROM auth_session WHERE user_id = $1 AND revoked_at IS NULL',
    [userId],
  );
  return rows[0].n as number;
}

function assertNoSecretsInPayload(payload: Record<string, unknown> | null | undefined) {
  if (!payload) return;
  const secrets = [
    'password',
    'passwordHash',
    'password_hash',
    'temporaryPassword',
    'currentPassword',
    'newPassword',
    'token',
    'username',
  ];
  for (const s of secrets) {
    assert.equal(
      s in payload,
      false,
      `Secret or restricted key '${s}' must not appear in fact payload`,
    );
  }
}

function assertRequestHash(fact: Fact, operation: string, actorUserId: string, request: object) {
  const expectedHash = computeCanonicalPayloadHash({ operation, actorUserId, request });
  assert.equal(
    fact.request_hash,
    expectedHash,
    `request_hash must match canonical hash for operation ${operation}`,
  );
}

// -----------------------------------------------------------------------------
// Suite 1: USER_ACCOUNT_CREATE (POST /api/v1/users)
// -----------------------------------------------------------------------------

test('User account create emits actor-bound USER_ACCOUNT and USER_ROLE facts without secret text', async () => {
  const f = await fixture();
  await withApi(f, async ({ call }) => {
    const newUsername = 'u_' + randomUUID().replaceAll('-', '').slice(0, 16);
    const body = {
      username: newUsername,
      displayName: 'Synthetic Newly Created User',
      temporaryPassword: 'SyntheticNewPass123!',
      roleAssignments: [{ role: 'WORKER', siteId: f.site }],
    };

    const response = await call('POST', '/api/v1/users', body);
    assert.equal(response.status, 201);
    const created = (await response.json()) as { id: string; username: string };
    assert.equal(created.username, newUsername);

    const facts = await factsForCommand('USER_ACCOUNT_CREATE', f.admin);
    const accountFact = facts.find(
      (fact) => fact.source_kind === 'USER_ACCOUNT' && fact.source_id === created.id,
    );
    assert.ok(accountFact, 'USER_ACCOUNT fact must exist');
    assert.ok(accountFact.after_payload);
    assert.equal(accountFact.operation, 'INSERT');
    assert.equal(accountFact.bound, true);
    assert.equal(accountFact.witnessed, true);
    assert.notEqual(accountFact.epoch_state, 'READY');

    // Canonical source fields: id, is_active, must_change_password, created_at
    assert.equal(accountFact.after_payload.id, created.id);
    assert.equal(accountFact.after_payload.is_active, true);
    assert.equal(accountFact.after_payload.must_change_password, false);
    assertNoSecretsInPayload(accountFact.after_payload);

    // Canonical request_hash validation (password/username/displayName are not hashed)
    assertRequestHash(accountFact, 'USER_ACCOUNT_CREATE', f.admin, {
      roleAssignments: body.roleAssignments,
    });

    // USER_ROLE fact for initial assignment
    const roleFact = facts.find(
      (fact) => fact.source_kind === 'USER_ROLE' && fact.after_payload?.user_id === created.id,
    );
    assert.ok(roleFact, 'USER_ROLE fact must exist');
    assert.ok(roleFact.after_payload);
    assert.equal(roleFact.operation, 'INSERT');
    assert.equal(roleFact.after_payload.role, 'WORKER');
    assert.equal(roleFact.after_payload.site_id, f.site);
    assert.equal(roleFact.bound, true);
  });
});

test('User account create rejects duplicate username with 409 and produces no facts', async () => {
  const f = await fixture();
  await withApi(f, async ({ call }) => {
    const body = {
      username: f.worker, // already existing username
      displayName: 'Duplicate User',
      temporaryPassword: 'SyntheticNewPass123!',
      roleAssignments: [{ role: 'WORKER', siteId: f.site }],
    };
    const response = await call('POST', '/api/v1/users', body);
    assert.equal(response.status, 409);
  });
});

// -----------------------------------------------------------------------------
// Suite 2: USER_ACCOUNT_STATUS (PATCH /api/v1/users/:id/status)
// -----------------------------------------------------------------------------

test('User account status deactivates target, captures UPDATE fact, revokes sessions, and ignores no-op', async () => {
  const f = await fixture();
  await withApi(f, async ({ call, login }) => {
    // Target logs in first so an active session exists
    await login(f.target);
    assert.ok((await activeSessionCount(f.target)) >= 1);

    // Deactivate target
    const deactResp = await call('PATCH', `/api/v1/users/${f.target}/status`, { isActive: false });
    assert.equal(deactResp.status, 200);

    const factsAfterDeact = await factsForSource('USER_ACCOUNT', f.target);
    const deactFact = factsAfterDeact.find(
      (fact) =>
        fact.command_operation === 'USER_ACCOUNT_STATUS' && fact.after_payload?.is_active === false,
    );
    assert.ok(deactFact, 'USER_ACCOUNT_STATUS deactivation fact must exist');
    assert.ok(deactFact.before_payload);
    assert.ok(deactFact.after_payload);
    assert.equal(deactFact.operation, 'UPDATE');
    assert.equal(deactFact.before_payload.is_active, true);
    assert.equal(deactFact.after_payload.is_active, false);
    assert.equal(deactFact.bound, true);
    assert.equal(deactFact.witnessed, true);
    assert.notEqual(deactFact.epoch_state, 'READY');
    assertNoSecretsInPayload(deactFact.after_payload);

    // Canonical request_hash validation
    assertRequestHash(deactFact, 'USER_ACCOUNT_STATUS', f.admin, {
      userId: f.target,
      isActive: false,
    });

    // Target sessions must be revoked
    assert.equal(
      await activeSessionCount(f.target),
      0,
      'Target sessions must be revoked on deactivation',
    );

    // No-op status: repeating same isActive produces no fake fact
    const initialFactCount = factsAfterDeact.length;
    const noopResp = await call('PATCH', `/api/v1/users/${f.target}/status`, { isActive: false });
    assert.equal(noopResp.status, 200);

    const factsAfterNoop = await factsForSource('USER_ACCOUNT', f.target);
    assert.equal(
      factsAfterNoop.length,
      initialFactCount,
      'No-op status must not produce fake facts',
    );

    // Reactivate target
    const reactResp = await call('PATCH', `/api/v1/users/${f.target}/status`, { isActive: true });
    assert.equal(reactResp.status, 200);

    const factsAfterReact = await factsForSource('USER_ACCOUNT', f.target);
    const reactFact = factsAfterReact[factsAfterReact.length - 1];
    assert.ok(reactFact);
    assert.ok(reactFact.before_payload);
    assert.ok(reactFact.after_payload);
    assert.equal(reactFact.command_operation, 'USER_ACCOUNT_STATUS');
    assert.equal(reactFact.operation, 'UPDATE');
    assert.equal(reactFact.before_payload.is_active, false);
    assert.equal(reactFact.after_payload.is_active, true);

    // Canonical request_hash validation for reactivation
    assertRequestHash(reactFact, 'USER_ACCOUNT_STATUS', f.admin, {
      userId: f.target,
      isActive: true,
    });
  });
});

test('User account status self-disable returns 403 and leaves state unchanged', async () => {
  const f = await fixture();
  await withApi(f, async ({ call }) => {
    const response = await call('PATCH', `/api/v1/users/${f.admin}/status`, { isActive: false });
    assert.equal(response.status, 403);

    const adminUser = (
      await db.query('SELECT is_active FROM app_user WHERE id = $1', [f.admin])
    )[0];
    assert.equal(adminUser.is_active, true);
  });
});

test('User account status enforces self-disable 403 and sole active Admin role demotion 409', async () => {
  const f = await fixture();
  // Query all active global Admins from shared DB to isolate this test from previous test executions
  const priorAdminRows = await db.query(
    `SELECT DISTINCT u.id
     FROM app_user u
     JOIN user_role_assignment a ON a.user_id = u.id AND a.role = 'ADMIN' AND a.site_id IS NULL
     WHERE u.is_active = TRUE AND u.id NOT IN ($1, $2)`,
    [f.admin, f.secondAdmin],
  );
  const priorAdminIds: string[] = priorAdminRows.map((r: { id: string }) => r.id);

  try {
    if (priorAdminIds.length > 0) {
      await db.query('UPDATE app_user SET is_active = FALSE WHERE id = ANY($1)', [priorAdminIds]);
    }

    await withApi(f, async ({ call }) => {
      // 1. selfdisable403: live admin actor cannot disable themselves even when multiple admins exist
      const selfDisableResp = await call('PATCH', `/api/v1/users/${f.admin}/status`, {
        isActive: false,
      });
      assert.equal(selfDisableResp.status, 403, 'Admin self-disable must return 403 Forbidden');

      // 2. Deactivate second admin using valid live f.admin actor -> 200 OK
      const deactSecondResp = await call('PATCH', `/api/v1/users/${f.secondAdmin}/status`, {
        isActive: false,
      });
      assert.equal(deactSecondResp.status, 200, 'Deactivating non-last admin must succeed');

      // At this point, f.admin is the sole active Admin in the database.
      // 3. selfdisable403: sole Admin still receives 403 Forbidden on attempting to deactivate self
      const soleSelfDisableResp = await call('PATCH', `/api/v1/users/${f.admin}/status`, {
        isActive: false,
      });
      assert.equal(
        soleSelfDisableResp.status,
        403,
        'Sole Admin self-disable must return 403 Forbidden',
      );

      // 4. own-role-demotion409: removing ADMIN role from sole active admin must return 409 Conflict
      const roleDemotionResp = await call('PUT', `/api/v1/users/${f.admin}/role-assignments`, {
        roleAssignments: [{ role: 'WORKER', siteId: f.site }],
      });
      assert.equal(
        roleDemotionResp.status,
        409,
        'Demoting sole active Admin role must return 409 Conflict',
      );

      // 5. Updating role assignments while retaining ADMIN role succeeds
      const retainAdminResp = await call('PUT', `/api/v1/users/${f.admin}/role-assignments`, {
        roleAssignments: [
          { role: 'ADMIN', siteId: null },
          { role: 'SAFETY_OFFICER', siteId: f.site },
        ],
      });
      assert.equal(
        retainAdminResp.status,
        200,
        'Updating role assignments while retaining ADMIN role must succeed',
      );
    });
  } finally {
    if (priorAdminIds.length > 0) {
      await db.query('UPDATE app_user SET is_active = TRUE WHERE id = ANY($1)', [priorAdminIds]);
    }
  }
});

// -----------------------------------------------------------------------------
// Suite 3: USER_ROLE_REPLACE (PUT /api/v1/users/:id/role-assignments)
// -----------------------------------------------------------------------------

test('User role replace emits DELETE and INSERT facts and revokes target sessions', async () => {
  const f = await fixture();
  await withApi(f, async ({ call, login }) => {
    // Target starts with WORKER role at f.site
    await login(f.target);
    assert.ok((await activeSessionCount(f.target)) >= 1);

    const newRoles = [{ role: 'SAFETY_OFFICER', siteId: f.site }];
    const response = await call('PUT', `/api/v1/users/${f.target}/role-assignments`, {
      roleAssignments: newRoles,
    });
    assert.equal(response.status, 200);

    const facts = await factsForCommand('USER_ROLE_REPLACE', f.admin);
    const roleFacts = facts.filter((fact) => fact.source_kind === 'USER_ROLE');

    // Old role deleted
    const deleteFact = roleFacts.find((fact) => fact.operation === 'DELETE');
    assert.ok(deleteFact, 'DELETE role fact must be captured');
    assert.ok(deleteFact.before_payload);
    assert.equal(deleteFact.before_payload.role, 'WORKER');
    assert.equal(deleteFact.before_payload.user_id, f.target);
    assert.equal(deleteFact.bound, true);
    assert.equal(deleteFact.witnessed, true);

    // New role inserted
    const insertFact = roleFacts.find((fact) => fact.operation === 'INSERT');
    assert.ok(insertFact, 'INSERT role fact must be captured');
    assert.ok(insertFact.after_payload);
    assert.equal(insertFact.after_payload.role, 'SAFETY_OFFICER');
    assert.equal(insertFact.after_payload.user_id, f.target);
    assert.equal(insertFact.after_payload.site_id, f.site);
    assert.equal(insertFact.bound, true);

    // Canonical request_hash validation
    assertRequestHash(insertFact, 'USER_ROLE_REPLACE', f.admin, {
      userId: f.target,
      roleAssignments: newRoles,
    });

    // Sessions must be revoked
    assert.equal(
      await activeSessionCount(f.target),
      0,
      'Target sessions must be revoked on role replace',
    );
  });
});

test('User role replace validates exact role-site invariants and duplicates with 400', async () => {
  const f = await fixture();
  await withApi(f, async ({ call }) => {
    // Duplicate assignment in body
    const duplicate = await call('PUT', `/api/v1/users/${f.target}/role-assignments`, {
      roleAssignments: [
        { role: 'WORKER', siteId: f.site },
        { role: 'WORKER', siteId: f.site },
      ],
    });
    assert.equal(duplicate.status, 400);

    // Global role ADMIN with siteId
    const adminWithSite = await call('PUT', `/api/v1/users/${f.target}/role-assignments`, {
      roleAssignments: [{ role: 'ADMIN', siteId: f.site }],
    });
    assert.equal(adminWithSite.status, 400);

    // Site-scoped role without siteId
    const siteRoleNoSite = await call('PUT', `/api/v1/users/${f.target}/role-assignments`, {
      roleAssignments: [{ role: 'WORKER', siteId: null }],
    });
    assert.equal(siteRoleNoSite.status, 400);

    // Nonexistent siteId
    const nonExistentSite = await call('PUT', `/api/v1/users/${f.target}/role-assignments`, {
      roleAssignments: [{ role: 'WORKER', siteId: randomUUID() }],
    });
    assert.ok(nonExistentSite.status === 400 || nonExistentSite.status === 404);
  });
});

// -----------------------------------------------------------------------------
// Suite 4: USER_PASSWORD_RESET (POST /api/v1/users/:id/reset-password)
// -----------------------------------------------------------------------------

test('User password reset emits USER_ACCOUNT fact without plain password and revokes sessions', async () => {
  const f = await fixture();
  await withApi(f, async ({ call, login }) => {
    await login(f.target);
    assert.ok((await activeSessionCount(f.target)) >= 1);

    const newTempPassword = 'SyntheticResetPass123!';
    const response = await call('POST', `/api/v1/users/${f.target}/reset-password`, {
      temporaryPassword: newTempPassword,
    });
    assert.equal(response.status, 204);

    const facts = await factsForSource('USER_ACCOUNT', f.target);
    const resetFact = facts.find(
      (fact) =>
        fact.command_operation === 'USER_PASSWORD_RESET' &&
        fact.after_payload?.must_change_password === false,
    );
    assert.ok(resetFact, 'USER_PASSWORD_RESET fact must exist');
    assert.equal(resetFact.operation, 'UPDATE');
    assert.equal(resetFact.bound, true);
    assert.equal(resetFact.witnessed, true);
    assert.notEqual(resetFact.epoch_state, 'READY');

    // Must never leak secret text or hashes
    assertNoSecretsInPayload(resetFact.after_payload);

    // Canonical request_hash validation (password is NOT hashed)
    assertRequestHash(resetFact, 'USER_PASSWORD_RESET', f.admin, {
      userId: f.target,
    });

    // Old sessions must be revoked
    assert.equal(
      await activeSessionCount(f.target),
      0,
      'Target sessions must be revoked on password reset',
    );

    // Target can log in with new temporary password
    const newSession = await login(f.target, newTempPassword);
    assert.ok(newSession.accessToken);
  });
});

test('Repeated password reset increments fact revision, captures metadata-only update, and retains canonical request hash', async () => {
  const f = await fixture();
  await withApi(f, async ({ call, login }) => {
    const initialRev = await accountHeadRevision(f.target);

    // Main reset passwords are usable immediately; change remains optional.
    const tempPass1 = 'SyntheticReset1Pass123!';
    const res1 = await call('POST', `/api/v1/users/${f.target}/reset-password`, {
      temporaryPassword: tempPass1,
    });
    assert.equal(res1.status, 204);

    const factsAfterFirst = await factsForSource('USER_ACCOUNT', f.target);
    const fact1 = factsAfterFirst[factsAfterFirst.length - 1];
    assert.ok(fact1);
    assert.equal(fact1.command_operation, 'USER_PASSWORD_RESET');
    assert.equal(fact1.operation, 'UPDATE');
    assert.equal(fact1.after_payload?.must_change_password, false);
    assert.equal(fact1.revision, initialRev + 1);
    assertNoSecretsInPayload(fact1.after_payload);
    assertRequestHash(fact1, 'USER_PASSWORD_RESET', f.admin, { userId: f.target });

    // Target can log in with tempPass1
    const session1 = await login(f.target, tempPass1);
    assert.ok(session1.accessToken);

    // Reset 2 changes the password hash while retaining optional password change.
    const tempPass2 = 'SyntheticReset2Pass456!';
    const res2 = await call('POST', `/api/v1/users/${f.target}/reset-password`, {
      temporaryPassword: tempPass2,
    });
    assert.equal(res2.status, 204);

    const factsAfterSecond = await factsForSource('USER_ACCOUNT', f.target);
    assert.equal(
      factsAfterSecond.length,
      factsAfterFirst.length + 1,
      'Repeated password reset must record a new fact revision when password hash changes',
    );
    const fact2 = factsAfterSecond[factsAfterSecond.length - 1];
    assert.ok(fact2);
    assert.equal(fact2.command_operation, 'USER_PASSWORD_RESET');
    assert.equal(fact2.operation, 'UPDATE');
    // The second reset still records its command and witness without forcing change.
    assert.equal(fact2.before_payload?.must_change_password, false);
    assert.equal(fact2.after_payload?.must_change_password, false);
    assert.equal(fact2.revision, fact1.revision + 1);
    assertNoSecretsInPayload(fact2.after_payload);
    assertRequestHash(fact2, 'USER_PASSWORD_RESET', f.admin, { userId: f.target });

    // Stale session from tempPass1 must now be revoked
    const staleAttempt = await call(
      'POST',
      '/api/v1/auth/change-password',
      { currentPassword: tempPass1, newPassword: 'SyntheticNewSelfPass123!' },
      session1.accessToken,
    );
    assert.equal(staleAttempt.status, 401, 'Session before second reset must be revoked');

    // Logging in with tempPass1 must now fail with 401
    const staleLoginResp = await call(
      'POST',
      '/api/v1/auth/login',
      { username: f.target, password: tempPass1, clientType: 'MOBILE' },
      '',
    );
    assert.equal(staleLoginResp.status, 401, 'Old temporary password must no longer be accepted');

    // Logging in with tempPass2 succeeds
    const newSession = await login(f.target, tempPass2);
    assert.ok(newSession.accessToken);
  });
});

// -----------------------------------------------------------------------------
// Suite 5: USER_PASSWORD_CHANGE (POST /api/v1/auth/change-password)
// -----------------------------------------------------------------------------

test('Worker can self-change password, clears temporary flag, emits fact and allows 204', async () => {
  const f = await fixture();
  await withApi(f, async ({ call, login }) => {
    // Flag worker with temporary password
    await db.query('UPDATE app_user SET must_change_password = true WHERE id = $1', [f.worker]);

    // Temporary password user MUST be allowed to login and self-change password (204)
    const workerSession = await login(f.worker, f.defaultPassword);
    const newPassword = 'SyntheticNewSelfPass456!';

    const changeResp = await call(
      'POST',
      '/api/v1/auth/change-password',
      {
        currentPassword: f.defaultPassword,
        newPassword,
      },
      workerSession.accessToken,
    );
    assert.equal(changeResp.status, 204);

    const facts = await factsForSource('USER_ACCOUNT', f.worker);
    const changeFact = facts.find(
      (fact) =>
        fact.command_operation === 'USER_PASSWORD_CHANGE' &&
        fact.after_payload?.must_change_password === false,
    );
    assert.ok(changeFact, 'USER_PASSWORD_CHANGE fact must exist');
    assert.equal(changeFact.operation, 'UPDATE');
    assert.equal(
      changeFact.actor_user_id,
      f.worker,
      'Actor must be the user self-changing password',
    );
    assert.equal(changeFact.bound, true);
    assert.equal(changeFact.witnessed, true);
    assert.notEqual(changeFact.epoch_state, 'READY');

    // Must never leak secret text or hashes
    assertNoSecretsInPayload(changeFact.after_payload);

    // Canonical request_hash validation (passwords are NOT hashed)
    assertRequestHash(changeFact, 'USER_PASSWORD_CHANGE', f.worker, {
      userId: f.worker,
    });

    // Logging in with new password succeeds
    const nextSession = await login(f.worker, newPassword);
    assert.ok(nextSession.accessToken);
  });
});

test('User with temporary password can self-change password regardless of role and revokes previous session token', async () => {
  const f = await fixture();
  await withApi(f, async ({ call, login }) => {
    // 1. Create a fresh user with non-worker role (SAFETY_OFFICER) and temporary password flag
    const safetyUser = randomUUID();
    const initialPassword = 'SyntheticTempPass123!';
    const initialHash = await hashPassword(initialPassword);
    await db.query(
      "INSERT INTO app_user(id,username,display_name,password_hash,must_change_password,is_active) VALUES($1,$1::uuid::text,'Synthetic Safety Officer',$2,true,true)",
      [safetyUser, initialHash],
    );
    await db.query(
      "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'SAFETY_OFFICER',$3)",
      [randomUUID(), safetyUser, f.site],
    );

    // User with temporary password flag MUST be allowed to login
    const session = await login(safetyUser, initialPassword);
    const oldToken = session.accessToken;
    assert.ok(oldToken);

    const newPassword = 'SyntheticNewSelfPass789!';

    // Self-change password
    const changeResp = await call(
      'POST',
      '/api/v1/auth/change-password',
      {
        currentPassword: initialPassword,
        newPassword,
      },
      oldToken,
    );
    assert.equal(changeResp.status, 204);

    // Verify authority fact emission
    const facts = await factsForSource('USER_ACCOUNT', safetyUser);
    const changeFact = facts.find(
      (fact) =>
        fact.command_operation === 'USER_PASSWORD_CHANGE' &&
        fact.after_payload?.must_change_password === false,
    );
    assert.ok(changeFact, 'USER_PASSWORD_CHANGE fact must exist');
    assert.equal(changeFact.operation, 'UPDATE');
    assert.equal(
      changeFact.actor_user_id,
      safetyUser,
      'Actor must be the user self-changing password',
    );
    assert.equal(changeFact.bound, true);
    assert.equal(changeFact.witnessed, true);
    assert.notEqual(changeFact.epoch_state, 'READY');
    assertNoSecretsInPayload(changeFact.after_payload);

    // Verify canonical request hash (password is NOT hashed)
    assertRequestHash(changeFact, 'USER_PASSWORD_CHANGE', safetyUser, {
      userId: safetyUser,
    });

    // revokeoldbearer: previous session token MUST now be revoked and rejected with 401
    const staleTokenResp = await call(
      'POST',
      '/api/v1/auth/change-password',
      {
        currentPassword: newPassword,
        newPassword: 'AnotherPassword123!',
      },
      oldToken,
    );
    assert.equal(
      staleTokenResp.status,
      401,
      'Stale access token must be revoked and return 401 Unauthorized',
    );

    // Logging in with new password succeeds
    const newSession = await login(safetyUser, newPassword);
    assert.ok(newSession.accessToken);
  });
});

test('Normal active user with non-temporary password can self-change password, recording metadata-only fact with incremented revision and canonical request hash', async () => {
  const f = await fixture();
  await withApi(f, async ({ call, login }) => {
    // f.worker was created with must_change_password = false
    const workerRow = (
      await db.query('SELECT must_change_password FROM app_user WHERE id = $1', [f.worker])
    )[0];
    assert.equal(workerRow.must_change_password, false);

    const initialFacts = await factsForSource('USER_ACCOUNT', f.worker);
    const initialRev = await accountHeadRevision(f.worker);

    const session = await login(f.worker, f.defaultPassword);
    const oldToken = session.accessToken;
    const newPassword = 'SyntheticNormalNewPass123!';

    const changeResp = await call(
      'POST',
      '/api/v1/auth/change-password',
      {
        currentPassword: f.defaultPassword,
        newPassword,
      },
      oldToken,
    );
    assert.equal(changeResp.status, 204);

    const factsAfterChange = await factsForSource('USER_ACCOUNT', f.worker);
    assert.equal(
      factsAfterChange.length,
      initialFacts.length + 1,
      'Normal password change must record an update fact revision even when flags are unchanged',
    );
    const changeFact = factsAfterChange[factsAfterChange.length - 1];
    assert.ok(changeFact);
    assert.equal(changeFact.command_operation, 'USER_PASSWORD_CHANGE');
    assert.equal(changeFact.operation, 'UPDATE');
    // Metadata-only fact: flags unchanged (false -> false)
    assert.equal(changeFact.before_payload?.must_change_password, false);
    assert.equal(changeFact.after_payload?.must_change_password, false);
    assert.equal(changeFact.revision, initialRev + 1);
    assert.equal(changeFact.actor_user_id, f.worker);
    assert.equal(changeFact.bound, true);
    assert.equal(changeFact.witnessed, true);
    assertNoSecretsInPayload(changeFact.after_payload);

    assertRequestHash(changeFact, 'USER_PASSWORD_CHANGE', f.worker, {
      userId: f.worker,
    });

    // revokeoldbearer: old token must now be rejected with 401
    const staleResp = await call(
      'POST',
      '/api/v1/auth/change-password',
      {
        currentPassword: newPassword,
        newPassword: 'AnotherNormalPass456!',
      },
      oldToken,
    );
    assert.equal(staleResp.status, 401, 'Old token must be revoked');

    // New password allows login
    const newSession = await login(f.worker, newPassword);
    assert.ok(newSession.accessToken);
  });
});

test('User with temporary password is restricted to USER_PASSWORD_CHANGE only and blocked from other endpoints', async () => {
  const f = await fixture();
  await withApi(f, async ({ call, login }) => {
    // Flag worker with temporary password
    await db.query('UPDATE app_user SET must_change_password = true WHERE id = $1', [f.worker]);

    const session = await login(f.worker, f.defaultPassword);
    const token = session.accessToken;

    // Blocked from management/other endpoints with 403
    const blockedStatus = await call(
      'PATCH',
      `/api/v1/users/${f.target}/status`,
      { isActive: false },
      token,
    );
    assert.equal(blockedStatus.status, 403);

    const blockedRoles = await call(
      'PUT',
      `/api/v1/users/${f.target}/role-assignments`,
      { roleAssignments: [{ role: 'WORKER', siteId: f.site }] },
      token,
    );
    assert.equal(blockedRoles.status, 403);

    // Permitted to call change-password
    const newPassword = 'SyntheticWorkerNewPass789!';
    const changeResp = await call(
      'POST',
      '/api/v1/auth/change-password',
      {
        currentPassword: f.defaultPassword,
        newPassword,
      },
      token,
    );
    assert.equal(changeResp.status, 204);
  });
});

// -----------------------------------------------------------------------------
// Suite 6: Global Admin Authorization 403 & Non-Admin Rejection
// -----------------------------------------------------------------------------

test('Non-admin users receive 403 Forbidden for all user management endpoints', async () => {
  const f = await fixture();
  await withApi(f, async ({ call, login }) => {
    const workerSession = await login(f.worker);
    const token = workerSession.accessToken;

    // CREATE
    const createResp = await call(
      'POST',
      '/api/v1/users',
      {
        username: 'unauthorized_new',
        displayName: 'Unauthorized',
        temporaryPassword: 'SyntheticNewPass123!',
        roleAssignments: [{ role: 'WORKER', siteId: f.site }],
      },
      token,
    );
    assert.equal(createResp.status, 403);

    // STATUS
    const statusResp = await call(
      'PATCH',
      `/api/v1/users/${f.target}/status`,
      { isActive: false },
      token,
    );
    assert.equal(statusResp.status, 403);

    // ROLES
    const rolesResp = await call(
      'PUT',
      `/api/v1/users/${f.target}/role-assignments`,
      { roleAssignments: [{ role: 'WORKER', siteId: f.site }] },
      token,
    );
    assert.equal(rolesResp.status, 403);

    // RESET
    const resetResp = await call(
      'POST',
      `/api/v1/users/${f.target}/reset-password`,
      { temporaryPassword: 'SyntheticNewPass123!' },
      token,
    );
    assert.equal(resetResp.status, 403);
  });
});

// -----------------------------------------------------------------------------
// Suite 7: Strict DTO 400 & Missing Target 404
// -----------------------------------------------------------------------------

test('Strict actor/command DTO validation rejects extraneous fields with 400', async () => {
  const f = await fixture();
  await withApi(f, async ({ call }) => {
    for (const extra of [{ actorUserId: f.admin }, { commandId: randomUUID() }]) {
      const statusResp = await call('PATCH', `/api/v1/users/${f.target}/status`, {
        isActive: false,
        ...extra,
      });
      assert.equal(statusResp.status, 400);

      const resetResp = await call('POST', `/api/v1/users/${f.target}/reset-password`, {
        temporaryPassword: 'SyntheticNewPass123!',
        ...extra,
      });
      assert.equal(resetResp.status, 400);
    }

    // Invalid UUID path
    assert.equal(
      (await call('PATCH', '/api/v1/users/invalid-uuid/status', { isActive: false })).status,
      400,
    );
    assert.equal(
      (
        await call('PUT', '/api/v1/users/invalid-uuid/role-assignments', {
          roleAssignments: [{ role: 'WORKER', siteId: f.site }],
        })
      ).status,
      400,
    );
  });
});

test('Missing target returns 404 Not Found without writes', async () => {
  const f = await fixture();
  await withApi(f, async ({ call }) => {
    const missingId = randomUUID();
    assert.equal(
      (await call('PATCH', `/api/v1/users/${missingId}/status`, { isActive: false })).status,
      404,
    );
    assert.equal(
      (
        await call('PUT', `/api/v1/users/${missingId}/role-assignments`, {
          roleAssignments: [{ role: 'WORKER', siteId: f.site }],
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await call('POST', `/api/v1/users/${missingId}/reset-password`, {
          temporaryPassword: 'SyntheticNewPass123!',
        })
      ).status,
      404,
    );
  });
});

// -----------------------------------------------------------------------------
// Suite 8: Held Transaction Reauthorization (UserAuthGuard)
// -----------------------------------------------------------------------------

for (const change of ['LOGOUT', 'ROLE', 'DEACTIVATE', 'TEMP_PASSWORD'] as const) {
  test(`User management operation ${change} before claim refuses the mutation without writes`, async () => {
    const f = await fixture();
    await withApi(f, async ({ call, guard, logout, adminToken, adminRefreshToken }) => {
      let enter!: () => void, release!: () => void;
      const claimed = new Promise<void>((r) => (enter = r)),
        hold = new Promise<void>((r) => (release = r));

      const original = guard.authenticateRequest.bind(guard);
      guard.authenticateRequest = async (r, m) => {
        if (m) {
          enter();
          await hold;
        }
        await original(r, m);
      };

      const pending = call('PATCH', `/api/v1/users/${f.target}/status`, { isActive: false });
      let timer: ReturnType<typeof setTimeout> | undefined;

      try {
        await Promise.race([
          claimed,
          new Promise<never>(
            (_, rej) => (timer = setTimeout(() => rej(new Error('Claim not reached')), 3000)),
          ),
        ]);

        if (change === 'LOGOUT') {
          assert.equal((await logout(adminToken, adminRefreshToken)).status, 204);
        }
        if (change === 'ROLE') {
          await db.query(
            "UPDATE user_role_assignment SET role='SITE_MANAGER',site_id=$2 WHERE user_id=$1",
            [f.admin, f.site],
          );
        }
        if (change === 'DEACTIVATE') {
          await db.query('UPDATE app_user SET is_active=false WHERE id=$1', [f.admin]);
        }
        if (change === 'TEMP_PASSWORD') {
          await db.query('UPDATE app_user SET must_change_password=true WHERE id=$1', [f.admin]);
        }

        release();
        const response = await pending;
        assert.equal(response.status, change === 'LOGOUT' || change === 'DEACTIVATE' ? 401 : 403);

        // Verify target remains unchanged
        const targetUser = (
          await db.query('SELECT is_active FROM app_user WHERE id=$1', [f.target])
        )[0];
        assert.equal(targetUser.is_active, true);
      } finally {
        if (timer) clearTimeout(timer);
        release();
        await pending;
      }
    });
  });
}

// -----------------------------------------------------------------------------
// Suite 9: Disabled Source Capture & Atomic Rollback
// -----------------------------------------------------------------------------

test('Disabled app_user capture trigger fails closed with 503 and zero writes', async () => {
  const f = await fixture();
  await withApi(f, async ({ call }) => {
    await db.query('ALTER TABLE app_user DISABLE TRIGGER trg_mf06_capture_app_user');
    try {
      const response = await call('PATCH', `/api/v1/users/${f.target}/status`, { isActive: false });
      assert.equal(response.status, 503);

      const target = (await db.query('SELECT is_active FROM app_user WHERE id=$1', [f.target]))[0];
      assert.equal(target.is_active, true, 'Zero writes must occur on 503 failure');
    } finally {
      await db.query('ALTER TABLE app_user ENABLE TRIGGER trg_mf06_capture_app_user');
    }
  });
});

test('Disabled user_role_assignment capture trigger refuses role replace before source writes', async () => {
  const f = await fixture();
  await withApi(f, async ({ call }) => {
    await db.query(
      'ALTER TABLE user_role_assignment DISABLE TRIGGER trg_mf06_capture_user_role_assignment',
    );
    try {
      const response = await call('PUT', `/api/v1/users/${f.target}/role-assignments`, {
        roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: f.site }],
      });
      assert.equal(response.status, 503);

      // Verify original role is intact and new role was NOT inserted
      const roles = await db.query('SELECT role FROM user_role_assignment WHERE user_id=$1', [
        f.target,
      ]);
      assert.equal(roles.length, 1);
      assert.equal(roles[0].role, 'WORKER');
    } finally {
      await db.query(
        'ALTER TABLE user_role_assignment ENABLE TRIGGER trg_mf06_capture_user_role_assignment',
      );
    }
  });
});

test('Authority control interruption fails closed with 503 and zero writes', async () => {
  const f = await fixture();
  await withApi(f, async ({ call }) => {
    await db.query('ALTER TABLE mf06_authority_control RENAME TO mf06_authority_control_held');
    try {
      const response = await call('PATCH', `/api/v1/users/${f.target}/status`, { isActive: false });
      assert.equal(response.status, 503);

      const target = (await db.query('SELECT is_active FROM app_user WHERE id=$1', [f.target]))[0];
      assert.equal(target.is_active, true);
    } finally {
      await db.query('ALTER TABLE mf06_authority_control_held RENAME TO mf06_authority_control');
    }
  });
});

test('Witness failure keeps committed response unconfirmed with null witness', async () => {
  const f = await fixture();
  await withApi(f, async ({ call, apiDb }) => {
    const original = apiDb.query.bind(apiDb);
    apiDb.query = (async (sql: string, params?: unknown[], runner?: QueryRunner) => {
      if (sql.startsWith('INSERT INTO mf06_authority_commit_witness')) {
        throw new Error('Synthetic witness refusal');
      }
      return original(sql, params, runner);
    }) as typeof apiDb.query;

    try {
      const response = await call('PATCH', `/api/v1/users/${f.target}/status`, { isActive: false });
      assert.equal(response.status, 200);

      const facts = await factsForSource('USER_ACCOUNT', f.target);
      const fact = facts.find((fact) => fact.command_operation === 'USER_ACCOUNT_STATUS');
      assert.ok(fact);
      assert.equal(fact.witnessed, null, 'Witness must be null when witness insertion refused');
    } finally {
      apiDb.query = original;
    }
  });
});

// -----------------------------------------------------------------------------
// Suite 10: Concurrent Admin Mutation Isolation
// -----------------------------------------------------------------------------

test('Two concurrent admin status mutations on distinct targets complete with bound witnessed facts', async () => {
  const f = await fixture();
  await withApi(f, async ({ call }) => {
    // Execute two concurrent status modifications on distinct targets
    const [res1, res2] = await Promise.all([
      call('PATCH', `/api/v1/users/${f.worker}/status`, { isActive: false }),
      call('PATCH', `/api/v1/users/${f.target}/status`, { isActive: false }),
    ]);

    assert.equal(res1.status, 200);
    assert.equal(res2.status, 200);

    // Verify both targets were updated in DB
    const rows = await db.query('SELECT id, is_active FROM app_user WHERE id IN ($1, $2)', [
      f.worker,
      f.target,
    ]);
    assert.equal(rows.length, 2);
    assert.equal(
      rows.every((r: { is_active: boolean }) => r.is_active === false),
      true,
    );

    // Verify both facts exist, are bound and witnessed
    const workerFacts = await factsForSource('USER_ACCOUNT', f.worker);
    const targetFacts = await factsForSource('USER_ACCOUNT', f.target);

    const workerFact = workerFacts.find(
      (fact) =>
        fact.command_operation === 'USER_ACCOUNT_STATUS' && fact.after_payload?.is_active === false,
    );
    const targetFact = targetFacts.find(
      (fact) =>
        fact.command_operation === 'USER_ACCOUNT_STATUS' && fact.after_payload?.is_active === false,
    );

    assert.ok(workerFact);
    assert.ok(targetFact);
    assert.equal(workerFact.bound, true);
    assert.equal(workerFact.witnessed, true);
    assert.equal(targetFact.bound, true);
    assert.equal(targetFact.witnessed, true);
  });
});
