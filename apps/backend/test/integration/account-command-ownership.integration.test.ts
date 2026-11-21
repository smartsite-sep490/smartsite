import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { JwtService } from '@nestjs/jwt';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { createTestConfig } from '../support/config.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { AuthService, type AuthenticatedRequest } from '../../src/modules/auth/auth.service.js';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service.js';
import { UserAuthGuard } from '../../src/modules/auth/user-auth.guard.js';
import { configurationCommandContext } from '../../src/modules/auth/configuration-command-context.js';
import { UserRole } from '../../src/database/entities/user.entity.js';
import { AuthClientType } from '../../src/database/entities/auth-session.entity.js';

test('bootstrap refuses legacy, current and partial authority history before any write', async () => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    const users = new UsersService(db, new SiteConfigurationService(db));
    for (const table of [
      'authorization_history_head',
      'mf06_authority_head',
      'authorization_history_baseline',
    ]) {
      await db.query(`CREATE TABLE ${table}(synthetic_marker integer)`);
      try {
        await assert.rejects(
          users.bootstrap('synthetic-bootstrap', 'Synthetic Admin', 'SyntheticInitial123!'),
          (error) => (error as { getStatus(): number }).getStatus() === 503,
        );
        assert.equal((await db.query('SELECT count(*)::int AS n FROM app_user'))[0].n, 0);
      } finally {
        await db.query(`DROP TABLE ${table}`);
      }
    }
  } finally {
    await owned.dispose();
  }
});

test('administrative account mutations recheck original bearer and Admin role, preserving account rules', async () => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    const users = new UsersService(db, new SiteConfigurationService(db)),
      password = 'SyntheticInitial123!';
    const admin = await users.bootstrap('synthetic-admin', 'Synthetic Admin', password);
    const site = randomUUID();
    await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Site')", [
      site,
    ]);
    const target = await users.create({
      username: 'synthetic-target',
      displayName: 'Synthetic Target',
      temporaryPassword: password,
      roleAssignments: [{ role: UserRole.SITE_MANAGER, siteId: site }],
    });
    const auth = new AuthService(db, new AuthTokenService(new JwtService(), createTestConfig())),
      guard = new UserAuthGuard(auth);
    const contextFor = async (username: string) => {
      const login = await auth.login(username, password, AuthClientType.WEB);
      const request: AuthenticatedRequest = {
        headers: { authorization: 'Bearer ' + login.accessToken },
      };
      await guard.authenticateRequest(request);
      return {
        context: configurationCommandContext(request, guard),
        request,
        token: login.accessToken,
      };
    };
    const revoked = await contextFor(admin.username);
    await db.query('UPDATE auth_session SET revoked_at=clock_timestamp() WHERE id=$1', [
      revoked.request.sessionId,
    ]);
    const input = {
      username: 'synthetic-new',
      displayName: 'Synthetic New',
      temporaryPassword: password,
      roleAssignments: [{ role: UserRole.WORKER, siteId: site }],
    };
    const calls = (context: unknown) => [
      () => Reflect.apply(users.createAdministrative, users, [input, context]),
      () =>
        Reflect.apply(users.replaceRoleAssignments, users, [
          target.id,
          { roleAssignments: [{ role: UserRole.WORKER, siteId: site }] },
          context,
        ]),
      () => Reflect.apply(users.revokeSiteManager, users, [target.id, site, context]),
      () =>
        Reflect.apply(users.setStatus, users, [admin.id, target.id, { isActive: false }, context]),
      () =>
        Reflect.apply(users.resetPassword, users, [
          target.id,
          { temporaryPassword: 'SyntheticReset123!' },
          context,
        ]),
    ];
    for (const call of calls(revoked.context))
      await assert.rejects(call, (e) => (e as { getStatus(): number }).getStatus() === 401);
    const nonAdmin = await contextFor(target.username);
    for (const call of calls(nonAdmin.context))
      await assert.rejects(call, (e) => (e as { getStatus(): number }).getStatus() === 403);
    const active = await contextFor(admin.username);
    const created = await Reflect.apply(users.createAdministrative, users, [input, active.context]);
    assert.equal(created.username, input.username);
    await assert.rejects(
      Reflect.apply(users.setStatus, users, [
        admin.id,
        admin.id,
        { isActive: false },
        active.context,
      ]),
      (e) => (e as { getStatus(): number }).getStatus() === 403,
    );
    await assert.rejects(
      Reflect.apply(users.replaceRoleAssignments, users, [
        admin.id,
        { roleAssignments: [{ role: UserRole.WORKER, siteId: site }] },
        active.context,
      ]),
      /At least one active Admin/,
    );
    await Reflect.apply(users.revokeSiteManager, users, [target.id, site, active.context]);
    assert.equal((await users.get(target.id)).roleAssignments.length, 0);
    await assert.rejects(auth.authenticate(nonAdmin.token));
    await Reflect.apply(users.replaceRoleAssignments, users, [
      target.id,
      { roleAssignments: [{ role: UserRole.WORKER, siteId: site }] },
      active.context,
    ]);
    const beforeReset = await contextFor(target.username);
    await Reflect.apply(users.resetPassword, users, [
      target.id,
      { temporaryPassword: 'SyntheticReset123!' },
      active.context,
    ]);
    await assert.rejects(auth.authenticate(beforeReset.token));
    await Reflect.apply(users.setStatus, users, [
      admin.id,
      target.id,
      { isActive: false },
      active.context,
    ]);
    assert.equal((await users.get(target.id)).isActive, false);
    await db.query("UPDATE user_role_assignment SET role='WORKER',site_id=$2 WHERE user_id=$1", [
      admin.id,
      site,
    ]);
    await assert.rejects(
      Reflect.apply(users.setStatus, users, [
        admin.id,
        created.id,
        { isActive: false },
        active.context,
      ]),
      (e) => (e as { getStatus(): number }).getStatus() === 403,
    );
  } finally {
    await owned.dispose();
  }
});
