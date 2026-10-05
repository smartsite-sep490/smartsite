import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { JwtService } from '@nestjs/jwt';
import dataSource from '../support/test-data-source.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { UserRole } from '../../src/database/entities/user.entity.js';
import {
  AuthClientType,
  AuthSessionEntity,
} from '../../src/database/entities/auth-session.entity.js';
import { createTestConfig } from '../support/config.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';

after(async () => {
  if (dataSource.isInitialized) await dataSource.destroy();
});

test('auth migration, bootstrap, sessions, account lifecycle and last Admin rule', async () => {
  await dataSource.initialize();
  // Bootstrap requires an empty account table; this is the dedicated disposable test database.
  await dataSource.query('TRUNCATE auth_session, user_role_assignment, app_user CASCADE');
  const columns = (await dataSource.query(`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name IN ('app_user', 'auth_session', 'user_role_assignment')
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
  const constraints = (await dataSource.query(`
    SELECT conname FROM pg_constraint
    WHERE conrelid IN ('app_user'::regclass, 'auth_session'::regclass, 'user_role_assignment'::regclass)
  `)) as { conname: string }[];
  for (const name of [
    'uq_app_user_username',
    'chk_auth_session_client_type',
    'fk_auth_session_user',
    'chk_user_role_assignment_scope',
  ])
    assert.ok(
      constraints.some((row) => row.conname === name),
      name,
    );
  const sites = new SiteConfigurationService(dataSource);
  const users = new UsersService(dataSource, sites);
  const auth = new AuthService(
    dataSource,
    new AuthTokenService(new JwtService(), createTestConfig()),
  );
  const suffix = randomUUID().slice(0, 8);
  const adminPassword = 'InitialAdmin1!';
  const admin = await users.bootstrap(`admin-${suffix}`, 'Initial Admin', adminPassword);
  await assert.rejects(users.bootstrap('another-admin', 'Other Admin', adminPassword));
  const firstLogin = await auth.login(admin.username, adminPassword, AuthClientType.MOBILE);
  assert.equal(firstLogin.user.mustChangePassword, true);
  assert.equal((await auth.authenticate(firstLogin.accessToken)).user.id, admin.id);
  await auth.changePassword(admin.id, adminPassword, 'NewAdmin123!');
  await assert.rejects(auth.authenticate(firstLogin.accessToken));
  const secondLogin = await auth.login(
    admin.username,
    'NewAdmin123!',
    AuthClientType.MOBILE,
  );
  assert.equal(secondLogin.user.mustChangePassword, false);
  const secondSession = await auth.authenticate(secondLogin.accessToken);
  await dataSource
    .getRepository(AuthSessionEntity)
    .update({ id: secondSession.sessionId }, { expiresAt: new Date(Date.now() - 1000) });
  await assert.rejects(auth.authenticate(secondLogin.accessToken));
  const activeLogin = await auth.login(
    admin.username,
    'NewAdmin123!',
    AuthClientType.MOBILE,
  );
  const site = await sites.create({ code: `AUTH-${suffix}`, name: 'Auth Site' });
  const secondSite = await sites.create({ code: `AUTH2-${suffix}`, name: 'Second Auth Site' });
  const worker = await users.create({
    username: `worker-${suffix}`,
    displayName: 'Worker',
    roleAssignments: [
      { role: UserRole.SITE_MANAGER, siteId: site.id },
      { role: UserRole.SAFETY_OFFICER, siteId: secondSite.id },
    ],
    temporaryPassword: 'WorkerTemp123!',
  });
  const workerLogin = await auth.login(
    worker.username,
    'WorkerTemp123!',
    AuthClientType.MOBILE,
  );
  assert.deepEqual(worker.roleAssignments, [
    { role: UserRole.SAFETY_OFFICER, siteId: secondSite.id },
    { role: UserRole.SITE_MANAGER, siteId: site.id },
  ]);
  const provisionedWorker = await users.create({
    username: `worker-account-${suffix}`,
    displayName: 'Worker Account',
    roleAssignments: [{ role: UserRole.WORKER, siteId: site.id }],
    temporaryPassword: 'WorkerAccount123!',
  });
  assert.deepEqual(provisionedWorker.roleAssignments, [{ role: UserRole.WORKER, siteId: site.id }]);
  const contractorRepresentative = await users.create({
    username: `contractor-${suffix}`,
    displayName: 'Contractor Representative',
    roleAssignments: [{ role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId: site.id }],
    temporaryPassword: 'Contractor123!',
  });
  assert.deepEqual(contractorRepresentative.roleAssignments, [
    { role: UserRole.CONTRACTOR_REPRESENTATIVE, siteId: site.id },
  ]);
  await assert.rejects(
    users.replaceRoleAssignments(worker.id, {
      roleAssignments: [
        { role: UserRole.SECURITY_OFFICER, siteId: site.id },
        { role: UserRole.SECURITY_OFFICER, siteId: site.id },
      ],
    }),
    { status: 400 },
  );
  await assert.rejects(
    users.replaceRoleAssignments(worker.id, {
      roleAssignments: [{ role: UserRole.SECURITY_OFFICER, siteId: randomUUID() }],
    }),
    { status: 404 },
  );
  await users.replaceRoleAssignments(worker.id, {
    roleAssignments: [{ role: UserRole.SECURITY_OFFICER, siteId: site.id }],
  });
  await assert.rejects(auth.authenticate(workerLogin.accessToken));
  const activeWorkerLogin = await auth.login(
    worker.username,
    'WorkerTemp123!',
    AuthClientType.MOBILE,
  );
  await users.setStatus(admin.id, worker.id, { isActive: false });
  await assert.rejects(auth.authenticate(activeWorkerLogin.accessToken));
  await users.setStatus(admin.id, worker.id, { isActive: true });
  await assert.rejects(auth.authenticate(workerLogin.accessToken));
  await users.resetPassword(worker.id, { temporaryPassword: 'WorkerReset123!' });
  await assert.rejects(auth.login(worker.username, 'WorkerTemp123!'));
  const resetLogin = await auth.login(
    worker.username,
    'WorkerReset123!',
    AuthClientType.MOBILE,
  );
  assert.equal(resetLogin.user.mustChangePassword, true);
  await assert.rejects(users.setStatus(admin.id, admin.id, { isActive: false }));
  await assert.rejects(
    users.replaceRoleAssignments(admin.id, {
      roleAssignments: [{ role: UserRole.SECURITY_OFFICER, siteId: site.id }],
    }),
  );
  const secondAdmin = await users.create({
    username: `admin-two-${suffix}`,
    displayName: 'Second Admin',
    roleAssignments: [{ role: UserRole.ADMIN, siteId: null }],
    temporaryPassword: 'SecondAdmin123!',
  });
  const competing = await Promise.allSettled([
    users.setStatus(admin.id, secondAdmin.id, { isActive: false }),
    users.setStatus(secondAdmin.id, admin.id, { isActive: false }),
  ]);
  assert.equal(competing.filter((result) => result.status === 'fulfilled').length, 1);
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
  const race = await Promise.allSettled([
    auth.login(worker.username, 'WorkerReset123!', AuthClientType.MOBILE),
    users.resetPassword(worker.id, { temporaryPassword: 'SecondReset123!' }),
  ]);
  const concurrentLogin = race[0];
  if (concurrentLogin.status === 'fulfilled')
    await assert.rejects(auth.authenticate(concurrentLogin.value.accessToken));
  await assert.rejects(auth.authenticate(resetLogin.accessToken));
  await auth.logout(activeLogin.refreshToken, AuthClientType.MOBILE);
  await assert.rejects(auth.authenticate(activeLogin.accessToken));
});
