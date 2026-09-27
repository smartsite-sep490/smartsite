import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import dataSource from '../support/test-data-source.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { UserRole } from '../../src/database/entities/user.entity.js';
import { AuthSessionEntity } from '../../src/database/entities/auth-session.entity.js';
import { tokenHash } from '../../src/modules/auth/auth.service.js';

after(async () => {
  if (dataSource.isInitialized) await dataSource.destroy();
});

test('auth migration, bootstrap, sessions, account lifecycle and last Admin rule', async () => {
  await dataSource.initialize();
  // Bootstrap requires an empty account table; this is the dedicated disposable test database.
  await dataSource.query('TRUNCATE auth_session, app_user');
  const columns = (await dataSource.query(`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name IN ('app_user', 'auth_session')
  `)) as { table_name: string; column_name: string }[];
  assert.ok(
    columns.some((row) => row.table_name === 'app_user' && row.column_name === 'password_hash'),
  );
  assert.ok(
    columns.some((row) => row.table_name === 'auth_session' && row.column_name === 'token_hash'),
  );
  const constraints = (await dataSource.query(`
    SELECT conname FROM pg_constraint
    WHERE conrelid IN ('app_user'::regclass, 'auth_session'::regclass)
  `)) as { conname: string }[];
  for (const name of ['uq_app_user_username', 'chk_app_user_role', 'fk_auth_session_user'])
    assert.ok(
      constraints.some((row) => row.conname === name),
      name,
    );
  const users = new UsersService(dataSource);
  const auth = new AuthService(dataSource);
  const suffix = randomUUID().slice(0, 8);
  const adminPassword = 'initial-admin-password-123';
  const admin = await users.bootstrap(`admin-${suffix}`, 'Initial Admin', adminPassword);
  await assert.rejects(users.bootstrap('another-admin', 'Other Admin', adminPassword));
  const firstLogin = await auth.login(admin.username, adminPassword);
  assert.equal(firstLogin.user.mustChangePassword, true);
  assert.equal((await auth.authenticate(firstLogin.accessToken)).user.id, admin.id);
  await auth.changePassword(admin.id, adminPassword, 'new-admin-password-123');
  await assert.rejects(auth.authenticate(firstLogin.accessToken));
  const secondLogin = await auth.login(admin.username, 'new-admin-password-123');
  assert.equal(secondLogin.user.mustChangePassword, false);
  await dataSource
    .getRepository(AuthSessionEntity)
    .update(
      { tokenHash: tokenHash(secondLogin.accessToken) },
      { expiresAt: new Date(Date.now() - 1000) },
    );
  await assert.rejects(auth.authenticate(secondLogin.accessToken));
  const activeLogin = await auth.login(admin.username, 'new-admin-password-123');
  const worker = await users.create({
    username: `worker-${suffix}`,
    displayName: 'Worker',
    role: UserRole.WORKER,
    temporaryPassword: 'temporary-worker-pass-123',
  });
  const workerLogin = await auth.login(worker.username, 'temporary-worker-pass-123');
  await users.setStatus(admin.id, worker.id, { isActive: false });
  await assert.rejects(auth.authenticate(workerLogin.accessToken));
  await users.setStatus(admin.id, worker.id, { isActive: true });
  await assert.rejects(auth.authenticate(workerLogin.accessToken));
  await users.resetPassword(worker.id, { temporaryPassword: 'reset-worker-password-123' });
  await assert.rejects(auth.login(worker.username, 'temporary-worker-pass-123'));
  const resetLogin = await auth.login(worker.username, 'reset-worker-password-123');
  assert.equal(resetLogin.user.mustChangePassword, true);
  await assert.rejects(users.setStatus(admin.id, admin.id, { isActive: false }));
  const secondAdmin = await users.create({
    username: `admin-two-${suffix}`,
    displayName: 'Second Admin',
    role: UserRole.ADMIN,
    temporaryPassword: 'second-admin-password-123',
  });
  const competing = await Promise.allSettled([
    users.setStatus(admin.id, secondAdmin.id, { isActive: false }),
    users.setStatus(secondAdmin.id, admin.id, { isActive: false }),
  ]);
  assert.equal(competing.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(
    await dataSource.getRepository('app_user').countBy({ role: UserRole.ADMIN, isActive: true }),
    1,
  );
  const race = await Promise.allSettled([
    auth.login(worker.username, 'reset-worker-password-123'),
    users.resetPassword(worker.id, { temporaryPassword: 'second-reset-password-123' }),
  ]);
  const concurrentLogin = race[0];
  if (concurrentLogin.status === 'fulfilled')
    await assert.rejects(auth.authenticate(concurrentLogin.value.accessToken));
  await assert.rejects(auth.authenticate(resetLogin.accessToken));
  await auth.logout(tokenHash(activeLogin.accessToken));
  await assert.rejects(auth.authenticate(activeLogin.accessToken));
});
