import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import type { ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { IsNull } from 'typeorm';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { PublicHttpException } from '../../src/common/http/public-http-exception.js';
import { AuthService, type AuthenticatedRequest } from '../../src/modules/auth/auth.service.js';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service.js';
import {
  configurationCommandContext,
  passwordChangeCommandContext,
} from '../../src/modules/auth/configuration-command-context.js';
import { AdminGuard, UserAuthGuard } from '../../src/modules/auth/user-auth.guard.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { UserEntity, UserRole } from '../../src/database/entities/user.entity.js';
import { UserRoleAssignmentEntity } from '../../src/database/entities/user-role-assignment.entity.js';
import {
  AuthClientType,
  AuthSessionEntity,
} from '../../src/database/entities/auth-session.entity.js';
import { createTestConfig } from '../support/config.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { SitesController } from '../../src/modules/sites/sites.controller.js';

const isolatedDatabase = createIsolatedTestDatabase({ canonical: true });
const dataSource = isolatedDatabase.dataSource;
before(() => isolatedDatabase.initialize());

after(() => isolatedDatabase.dispose());

function createBearerRequest(accessToken: string, rawHeaders?: string[]): AuthenticatedRequest {
  return {
    headers: { authorization: `Bearer ${accessToken}` },
    ...(rawHeaders ? { rawHeaders } : {}),
  };
}

function createHttpExecutionContext(request: AuthenticatedRequest): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ setHeader: () => undefined }),
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

const isPasswordChangeRequired = (error: unknown) =>
  error instanceof PublicHttpException &&
  error.getStatus() === 403 &&
  error.publicPayload.code === 'PASSWORD_CHANGE_REQUIRED';

test('auth migration, bootstrap, sessions, account lifecycle and last Admin rule', async () => {
  assert.ok(dataSource.isInitialized);
  // Bootstrap requires an empty account table; this file-owned isolated schema is freshly initialized.
  assert.equal(
    Number((await dataSource.query('SELECT COUNT(*)::int AS count FROM app_user'))[0].count),
    0,
  );
  const columns = (await dataSource.query(`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name IN ('app_user', 'auth_session', 'user_role_assignment')
  `)) as { table_name: string; column_name: string }[];
  assert.ok(
    columns.some((row) => row.table_name === 'app_user' && row.column_name === 'password_hash'),
  );
  assert.ok(
    columns.some(
      (row) => row.table_name === 'auth_session' && row.column_name === 'refresh_token_hash',
    ),
  );
  assert.equal(
    columns.some((row) => row.table_name === 'app_user' && row.column_name === 'role'),
    false,
  );
  assert.ok(
    columns.some(
      (row) => row.table_name === 'user_role_assignment' && row.column_name === 'site_id',
    ),
  );
  const byTable = new Map<string, Set<string>>();
  for (const row of columns) {
    if (!byTable.has(row.table_name)) byTable.set(row.table_name, new Set());
    byTable.get(row.table_name)!.add(row.column_name);
  }
  assert.deepEqual([...(byTable.get('app_user') ?? [])].sort(), [
    'created_at',
    'display_name',
    'id',
    'is_active',
    'must_change_password',
    'password_hash',
    'updated_at',
    'username',
  ]);
  assert.deepEqual([...(byTable.get('auth_session') ?? [])].sort(), [
    'client_type',
    'created_at',
    'expires_at',
    'id',
    'last_refreshed_at',
    'refresh_token_hash',
    'revoked_at',
    'user_id',
  ]);
  assert.deepEqual([...(byTable.get('user_role_assignment') ?? [])].sort(), [
    'created_at',
    'id',
    'role',
    'site_id',
    'user_id',
  ]);
  const constraints = (await dataSource.query(`
    SELECT conname FROM pg_constraint
    WHERE conrelid IN ('app_user'::regclass, 'auth_session'::regclass, 'user_role_assignment'::regclass)
  `)) as { conname: string }[];
  for (const name of [
    'uq_app_user_username',
    'chk_auth_session_client_type',
    'fk_auth_session_user',
    'chk_user_role_assignment_scope',
  ]) {
    assert.ok(
      constraints.some((row) => row.conname === name),
      name,
    );
  }

  const config = createTestConfig();
  const sites = new SiteConfigurationService(dataSource);
  const users = new UsersService(dataSource, sites);
  const tokens = new AuthTokenService(new JwtService(), config);
  const auth = new AuthService(dataSource, tokens);
  const userAuthGuard = new UserAuthGuard(auth);
  const adminGuard = new AdminGuard();
  const sitesController = new SitesController(sites, userAuthGuard);

  const suffix = randomUUID().slice(0, 8);
  const adminPassword = 'StrongPassword!123';
  const admin = await users.bootstrap(`Admin.One.${suffix}`, 'First Admin', adminPassword);
  assert.equal(admin.username, `admin.one.${suffix}`);
  assert.equal(admin.mustChangePassword, false);
  assert.deepEqual(admin.roleAssignments, [{ role: UserRole.ADMIN, siteId: null }]);
  await assert.rejects(
    () => users.bootstrap(`admin.two.${suffix}`, 'Second Admin', adminPassword),
    (error: { status?: number }) => error.status === 409,
  );

  const firstAdminLogin = await auth.login(
    `ADMIN.ONE.${suffix}`,
    adminPassword,
    AuthClientType.MOBILE,
  );
  assert.equal(firstAdminLogin.user.mustChangePassword, false);
  assert.equal((await auth.authenticate(firstAdminLogin.accessToken)).user.id, admin.id);
  await auth.changePassword(admin.id, adminPassword, 'NewAdmin123!');
  await assert.rejects(
    () => auth.authenticate(firstAdminLogin.accessToken),
    (error: { status?: number }) => error.status === 401,
  );

  const login = await auth.login(`ADMIN.ONE.${suffix}`, 'NewAdmin123!', AuthClientType.WEB);
  assert.equal(login.user.mustChangePassword, false);
  const authenticated = await auth.authenticate(login.accessToken);
  assert.equal(authenticated.user.id, admin.id);
  assert.equal(authenticated.clientType, AuthClientType.WEB);
  await assert.rejects(
    () => auth.login(admin.username, 'wrong-password', AuthClientType.WEB),
    (error: { status?: number }) => error.status === 401,
  );

  const siteA = await sites.create({ code: `SITE-A-${suffix}`, name: 'Site A' });
  const siteB = await sites.create({ code: `SITE-B-${suffix}`, name: 'Site B' });
  const worker = await users.create({
    username: `worker.one.${suffix}`,
    displayName: 'Worker One',
    temporaryPassword: 'StrongPassword!123',
    roleAssignments: [
      { role: UserRole.SITE_MANAGER, siteId: siteB.id },
      { role: UserRole.SAFETY_OFFICER, siteId: siteA.id },
    ],
  });
  assert.equal(worker.mustChangePassword, false);
  assert.deepEqual(worker.roleAssignments, [
    { role: UserRole.SAFETY_OFFICER, siteId: siteA.id },
    { role: UserRole.SITE_MANAGER, siteId: siteB.id },
  ]);

  const provisionedWorker = await users.create({
    username: `worker.account.${suffix}`,
    displayName: 'Worker Account',
    temporaryPassword: 'WorkerAccount123!',
    roleAssignments: [{ role: UserRole.WORKER, siteId: siteA.id }],
  });
  assert.equal(provisionedWorker.mustChangePassword, false);
  assert.deepEqual(provisionedWorker.roleAssignments, [
    { role: UserRole.WORKER, siteId: siteA.id },
  ]);

  const contractorRepresentative = await users.create({
    username: `contractor.rep.${suffix}`,
    displayName: 'Contractor Representative',
    temporaryPassword: 'Contractor123!',
    roleAssignments: [{ role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId: siteA.id }],
  });
  assert.equal(contractorRepresentative.mustChangePassword, false);
  assert.deepEqual(contractorRepresentative.roleAssignments, [
    { role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId: siteA.id },
  ]);

  await assert.rejects(
    () =>
      users.createAdministrative({
        username: `rep.invalid.${suffix}`,
        displayName: 'Invalid Contractor Rep',
        temporaryPassword: 'StrongPassword!123',
        roleAssignments: [{ role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId: siteA.id }],
      }),
    (error: { status?: number }) => error.status === 403,
  );
  assert.equal(
    await dataSource.getRepository(UserEntity).countBy({ username: `rep.invalid.${suffix}` }),
    0,
  );

  const workerLogin = await auth.login(
    worker.username,
    'StrongPassword!123',
    AuthClientType.MOBILE,
  );
  assert.equal(workerLogin.user.mustChangePassword, false);
  await assert.rejects(
    () => auth.changePassword(worker.id, 'StrongPassword!123', 'weak'),
    (error: { status?: number }) => error.status === 400,
  );
  await assert.rejects(
    () => auth.changePassword(worker.id, 'WrongCurrent!123', 'NewStrongPassword!123'),
    (error: { status?: number }) => error.status === 401,
  );
  await auth.changePassword(worker.id, 'StrongPassword!123', 'NewStrongPassword!123');
  await assert.rejects(
    () => auth.authenticate(workerLogin.accessToken),
    (error: { status?: number }) => error.status === 401,
  );
  await assert.rejects(
    () => auth.refresh(workerLogin.refreshToken, AuthClientType.MOBILE),
    (error: { status?: number }) => error.status === 401,
  );

  const relogin = await auth.login(worker.username, 'NewStrongPassword!123', AuthClientType.MOBILE);
  assert.equal(relogin.user.mustChangePassword, false);

  // Refresh token rotation, clientType binding, and refresh-token reuse detection.
  await assert.rejects(
    () => auth.refresh(relogin.refreshToken, AuthClientType.WEB),
    (error: { status?: number }) => error.status === 401,
  );
  await assert.rejects(
    () => auth.logout(relogin.refreshToken, AuthClientType.WEB),
    (error: { status?: number }) => error.status === 401,
  );
  const rotated = await auth.refresh(relogin.refreshToken, AuthClientType.MOBILE);
  assert.notEqual(rotated.refreshToken, relogin.refreshToken);
  const rotatedAuth = await auth.authenticate(rotated.accessToken);
  assert.equal(rotatedAuth.user.id, worker.id);
  assert.equal(rotatedAuth.clientType, AuthClientType.MOBILE);

  // Presenting the rotated-out refresh token triggers reuse detection and revokes the session.
  await assert.rejects(
    () => auth.refresh(relogin.refreshToken, AuthClientType.MOBILE),
    (error: { status?: number }) => error.status === 401,
  );
  await assert.rejects(
    () => auth.authenticate(rotated.accessToken),
    (error: { status?: number }) => error.status === 401,
  );
  await assert.rejects(
    () => auth.refresh(rotated.refreshToken, AuthClientType.MOBILE),
    (error: { status?: number }) => error.status === 401,
  );

  // Concurrent refresh with the same token: exactly one succeeds, one fails with 401, and reuse revokes the session.
  const concurrentRefreshLogin = await auth.login(
    worker.username,
    'NewStrongPassword!123',
    AuthClientType.MOBILE,
  );
  const concurrentRefreshOutcomes = await Promise.allSettled([
    auth.refresh(concurrentRefreshLogin.refreshToken, AuthClientType.MOBILE),
    auth.refresh(concurrentRefreshLogin.refreshToken, AuthClientType.MOBILE),
  ]);
  const fulfilledRefreshes = concurrentRefreshOutcomes.filter(
    (outcome): outcome is PromiseFulfilledResult<Awaited<ReturnType<typeof auth.refresh>>> =>
      outcome.status === 'fulfilled',
  );
  const rejectedRefreshes = concurrentRefreshOutcomes.filter(
    (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
  );
  assert.equal(fulfilledRefreshes.length, 1);
  assert.equal(rejectedRefreshes.length, 1);
  assert.equal((rejectedRefreshes[0]!.reason as { status?: number })?.status, 401);
  const winningRefresh = fulfilledRefreshes[0]!.value;
  await assert.rejects(
    () => auth.authenticate(winningRefresh.accessToken),
    (error: { status?: number }) => error.status === 401,
  );
  await assert.rejects(
    () => auth.refresh(winningRefresh.refreshToken, AuthClientType.MOBILE),
    (error: { status?: number }) => error.status === 401,
  );

  // Logout revokes active session for matching clientType and is idempotent when already revoked.
  const logoutSession = await auth.login(
    worker.username,
    'NewStrongPassword!123',
    AuthClientType.MOBILE,
  );
  await auth.logout(logoutSession.refreshToken, AuthClientType.MOBILE);
  await assert.rejects(
    () => auth.authenticate(logoutSession.accessToken),
    (error: { status?: number }) => error.status === 401,
  );
  await auth.logout(logoutSession.refreshToken, AuthClientType.MOBILE);

  const activeWorkerSession = await auth.login(
    worker.username,
    'NewStrongPassword!123',
    AuthClientType.MOBILE,
  );
  const activeWorkerAuth = await auth.authenticate(activeWorkerSession.accessToken);
  await dataSource
    .getRepository(AuthSessionEntity)
    .update({ id: activeWorkerAuth.sessionId }, { expiresAt: new Date(Date.now() - 1000) });
  await assert.rejects(
    () => auth.authenticate(activeWorkerSession.accessToken),
    (error: { status?: number }) => error.status === 401,
  );
  await assert.rejects(
    () => auth.refresh(activeWorkerSession.refreshToken, AuthClientType.MOBILE),
    (error: { status?: number }) => error.status === 401,
  );

  await assert.rejects(
    () =>
      users.replaceRoleAssignments(worker.id, {
        roleAssignments: [
          { role: UserRole.SECURITY_OFFICER, siteId: siteA.id },
          { role: UserRole.SECURITY_OFFICER, siteId: siteA.id },
        ],
      }),
    (error: { status?: number }) => error.status === 400,
  );
  await assert.rejects(
    () =>
      users.replaceRoleAssignments(worker.id, {
        roleAssignments: [{ role: UserRole.SECURITY_OFFICER, siteId: randomUUID() }],
      }),
    (error: { status?: number }) => error.status === 404,
  );
  await assert.rejects(
    () =>
      users.replaceRoleAssignments(worker.id, {
        roleAssignments: [{ role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId: siteA.id }],
      }),
    (error: { status?: number }) => error.status === 403,
  );
  assert.equal(
    await dataSource.getRepository(UserRoleAssignmentEntity).countBy({ userId: worker.id }),
    2,
  );

  const sessionBeforeRoleChange = await auth.login(
    worker.username,
    'NewStrongPassword!123',
    AuthClientType.MOBILE,
  );
  await users.replaceRoleAssignments(worker.id, {
    roleAssignments: [{ role: UserRole.SECURITY_OFFICER, siteId: siteA.id }],
  });
  await assert.rejects(
    () => auth.authenticate(sessionBeforeRoleChange.accessToken),
    (error: { status?: number }) => error.status === 401,
  );

  // UserAuthGuard header validation, AdminGuard, SitesController data scope & authority context.
  const scopedWorkerSession = await auth.login(
    worker.username,
    'NewStrongPassword!123',
    AuthClientType.WEB,
  );
  await assert.rejects(
    () => userAuthGuard.authenticateRequest({ headers: {} }),
    (error: { status?: number }) => error.status === 401,
  );
  await assert.rejects(
    () =>
      userAuthGuard.authenticateRequest(
        createBearerRequest(scopedWorkerSession.accessToken, [
          'Authorization',
          `Bearer ${scopedWorkerSession.accessToken}`,
          'authorization',
          `Bearer ${scopedWorkerSession.accessToken}`,
        ]),
      ),
    (error: { status?: number }) => error.status === 401,
  );

  const workerReq = createBearerRequest(scopedWorkerSession.accessToken, [
    'Authorization',
    `Bearer ${scopedWorkerSession.accessToken}`,
  ]);
  assert.equal(await userAuthGuard.canActivate(createHttpExecutionContext(workerReq)), true);
  assert.throws(
    () => adminGuard.canActivate(createHttpExecutionContext(workerReq)),
    (error: { status?: number }) => error.status === 403,
  );

  const scopedSitesList = await sitesController.list(workerReq);
  assert.equal(scopedSitesList.total, 1);
  assert.deepEqual(
    scopedSitesList.items.map((item) => item.id),
    [siteA.id],
  );
  const fetchedSiteA = await sitesController.get(workerReq, siteA.id);
  assert.equal(fetchedSiteA.id, siteA.id);
  await assert.rejects(
    () => sitesController.get(workerReq, siteB.id),
    (error: { status?: number }) => error.status === 403,
  );

  const adminReq = createBearerRequest(login.accessToken, [
    'Authorization',
    `Bearer ${login.accessToken}`,
  ]);
  assert.equal(await userAuthGuard.canActivate(createHttpExecutionContext(adminReq)), true);
  assert.equal(adminGuard.canActivate(createHttpExecutionContext(adminReq)), true);
  const allSitesList = await sitesController.list(adminReq);
  assert.equal(allSitesList.total, 2);

  // Temporary-password (mustChangePassword = true) enforcement across guards, controllers & command contexts.
  await dataSource
    .getRepository(UserEntity)
    .update({ id: worker.id }, { mustChangePassword: true });
  const tempPasswordLogin = await auth.login(
    worker.username,
    'NewStrongPassword!123',
    AuthClientType.WEB,
  );
  assert.equal(tempPasswordLogin.user.mustChangePassword, true);
  const tempWorkerReq = createBearerRequest(tempPasswordLogin.accessToken);
  await userAuthGuard.authenticateRequest(tempWorkerReq);
  assert.throws(
    () => adminGuard.canActivate(createHttpExecutionContext(tempWorkerReq)),
    isPasswordChangeRequired,
  );
  await assert.rejects(() => sitesController.list(tempWorkerReq), isPasswordChangeRequired);
  await assert.rejects(
    () =>
      sites.create(
        { code: `SITE-BLOCKED-${suffix}`, name: 'Blocked Site' },
        configurationCommandContext(tempWorkerReq, userAuthGuard),
      ),
    isPasswordChangeRequired,
  );
  await auth.changePassword(
    worker.id,
    'NewStrongPassword!123',
    'ClearedTempPassword!123',
    passwordChangeCommandContext(tempWorkerReq, userAuthGuard),
  );
  await assert.rejects(
    () => auth.authenticate(tempPasswordLogin.accessToken),
    (error: { status?: number }) => error.status === 401,
  );
  const clearedLogin = await auth.login(
    worker.username,
    'ClearedTempPassword!123',
    AuthClientType.MOBILE,
  );
  assert.equal(clearedLogin.user.mustChangePassword, false);

  const sessionBeforeDeactivate = await auth.login(
    worker.username,
    'ClearedTempPassword!123',
    AuthClientType.MOBILE,
  );
  await users.setStatus(
    admin.id,
    worker.id,
    { isActive: false },
    configurationCommandContext(adminReq, userAuthGuard),
  );
  await assert.rejects(
    () => auth.authenticate(sessionBeforeDeactivate.accessToken),
    (error: { status?: number }) => error.status === 401,
  );
  await users.setStatus(
    admin.id,
    worker.id,
    { isActive: true },
    configurationCommandContext(adminReq, userAuthGuard),
  );
  await assert.rejects(
    () => auth.authenticate(sessionBeforeDeactivate.accessToken),
    (error: { status?: number }) => error.status === 401,
  );

  const sessionBeforeReset = await auth.login(
    worker.username,
    'ClearedTempPassword!123',
    AuthClientType.MOBILE,
  );
  await users.resetPassword(
    worker.id,
    { temporaryPassword: 'ResetStrongPassword!123' },
    configurationCommandContext(adminReq, userAuthGuard),
  );
  await assert.rejects(
    () => auth.authenticate(sessionBeforeReset.accessToken),
    (error: { status?: number }) => error.status === 401,
  );
  await assert.rejects(
    () => auth.login(worker.username, 'ClearedTempPassword!123', AuthClientType.MOBILE),
    (error: { status?: number }) => error.status === 401,
  );
  const resetLogin = await auth.login(
    worker.username,
    'ResetStrongPassword!123',
    AuthClientType.MOBILE,
  );
  assert.equal(resetLogin.user.mustChangePassword, false);

  const authorityCommands = (await dataSource.query(
    `SELECT operation FROM authorization_history_command c
     JOIN authorization_history_commit_receipt w ON w.command_id = c.command_id
     ORDER BY c.started_at ASC`,
  )) as { operation: string }[];
  assert.deepEqual(
    authorityCommands.map((row) => row.operation),
    ['USER_PASSWORD_CHANGE', 'USER_ACCOUNT_STATUS', 'USER_ACCOUNT_STATUS', 'USER_PASSWORD_RESET'],
  );

  // INTERNAL READ COMMITTED control (context omitted on users.resetPassword):
  // This exercises executeMainConfigurationCommand's default READ COMMITTED branch (!context),
  // NOT the public controller SERIALIZABLE (context-supplied) snapshot path.
  const resetRace = await Promise.allSettled([
    auth.login(worker.username, 'ResetStrongPassword!123', AuthClientType.MOBILE),
    users.resetPassword(worker.id, { temporaryPassword: 'SecondReset123!' }),
  ]);
  assert.equal(resetRace[1].status, 'fulfilled');
  if (resetRace[0].status === 'fulfilled') {
    const concurrentResetAccessToken = resetRace[0].value.accessToken;
    await assert.rejects(
      () => auth.authenticate(concurrentResetAccessToken),
      (error: { status?: number }) => error.status === 401,
    );
  } else {
    assert.equal((resetRace[0].reason as { status?: number })?.status, 401);
  }
  await assert.rejects(
    () => auth.authenticate(resetLogin.accessToken),
    (error: { status?: number }) => error.status === 401,
  );
  const activeSessionsAfterReset = await dataSource
    .getRepository(AuthSessionEntity)
    .countBy({ userId: worker.id, revokedAt: IsNull() });
  assert.equal(activeSessionsAfterReset, 0);
  const secondResetLogin = await auth.login(worker.username, 'SecondReset123!', AuthClientType.WEB);
  assert.equal(secondResetLogin.user.mustChangePassword, false);
  await auth.logout(secondResetLogin.refreshToken, AuthClientType.WEB);

  await assert.rejects(
    () => users.setStatus(admin.id, admin.id, { isActive: false }),
    (error: { status?: number }) => error.status === 403,
  );
  await assert.rejects(
    () => users.setStatus(worker.id, admin.id, { isActive: false }),
    (error: { status?: number }) => error.status === 409,
  );
  await assert.rejects(
    () =>
      users.replaceRoleAssignments(admin.id, {
        roleAssignments: [{ role: UserRole.SECURITY_OFFICER, siteId: siteA.id }],
      }),
    (error: { status?: number }) => error.status === 409,
  );

  // Genuine fresh active-Admin logout proof BEFORE concurrentDeactivate (while admin is guaranteed active):
  const freshAdminLogoutLogin = await auth.login(
    admin.username,
    'NewAdmin123!',
    AuthClientType.WEB,
  );
  const freshAdminBeforeLogout = await auth.authenticate(freshAdminLogoutLogin.accessToken);
  assert.equal(freshAdminBeforeLogout.user.id, admin.id);
  assert.equal(freshAdminBeforeLogout.clientType, AuthClientType.WEB);
  await auth.logout(freshAdminLogoutLogin.refreshToken, AuthClientType.WEB);
  await assert.rejects(
    () => auth.authenticate(freshAdminLogoutLogin.accessToken),
    (error: { status?: number }) => error.status === 401,
  );
  await auth.logout(freshAdminLogoutLogin.refreshToken, AuthClientType.WEB);

  const secondAdmin = await users.create({
    username: `admin.two.${suffix}`,
    displayName: 'Second Admin',
    temporaryPassword: 'StrongPassword!123',
    roleAssignments: [{ role: UserRole.ADMIN, siteId: null }],
  });
  const concurrentDeactivate = await Promise.allSettled([
    users.setStatus(admin.id, secondAdmin.id, { isActive: false }),
    users.setStatus(secondAdmin.id, admin.id, { isActive: false }),
  ]);
  assert.deepEqual(concurrentDeactivate.map((item) => item.status).sort(), [
    'fulfilled',
    'rejected',
  ]);
  const rejectedDeactivate = concurrentDeactivate.find(
    (item): item is PromiseRejectedResult => item.status === 'rejected',
  );
  assert.ok(rejectedDeactivate);
  assert.equal((rejectedDeactivate.reason as { status?: number })?.status, 409);
  assert.equal(
    Number(
      (
        await dataSource.query(`
          SELECT COUNT(*)::int AS count FROM app_user user_account
          JOIN user_role_assignment assignment ON assignment.user_id = user_account.id
          WHERE user_account.is_active = TRUE AND assignment.role = 'ADMIN' AND assignment.site_id IS NULL
        `)
      )[0].count,
    ),
    1,
  );

  await auth.logout(login.refreshToken, AuthClientType.WEB);
  await assert.rejects(
    () => auth.authenticate(login.accessToken),
    (error: { status?: number }) => error.status === 401,
  );
});
