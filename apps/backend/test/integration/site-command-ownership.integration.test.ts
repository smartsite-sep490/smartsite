import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JwtService } from '@nestjs/jwt';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { createTestConfig } from '../support/config.js';
import { AuthService, type AuthenticatedRequest } from '../../src/modules/auth/auth.service.js';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service.js';
import { UserAuthGuard } from '../../src/modules/auth/user-auth.guard.js';
import { configurationCommandContext } from '../../src/modules/auth/configuration-command-context.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { AuthClientType } from '../../src/database/entities/auth-session.entity.js';

test('Site creation and name-only rename recheck the original Admin bearer without changing business scope', async () => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    const sites = new SiteConfigurationService(db),
      users = new UsersService(db, sites),
      password = 'SyntheticInitial123!',
      admin = await users.bootstrap('synthetic-admin', 'Synthetic Admin', password);
    const auth = new AuthService(db, new AuthTokenService(new JwtService(), createTestConfig())),
      guard = new UserAuthGuard(auth);
    const actorFor = async () => {
      const login = await auth.login(admin.username, password, AuthClientType.WEB),
        request: AuthenticatedRequest = {
          headers: { authorization: 'Bearer ' + login.accessToken },
        };
      await guard.authenticateRequest(request);
      return { request, context: configurationCommandContext(request, guard) };
    };
    const dead = await actorFor();
    await db.query('UPDATE auth_session SET revoked_at=clock_timestamp() WHERE id=$1', [
      dead.request.sessionId,
    ]);
    const input = { code: 'SYNTHETIC-SITE', name: 'Synthetic Site' };
    await assert.rejects(
      Reflect.apply(sites.create, sites, [input, dead.context]),
      (e) => (e as { getStatus(): number }).getStatus() === 401,
    );
    assert.equal((await sites.list()).total, 0);
    const live = await actorFor(),
      site = await Reflect.apply(sites.create, sites, [input, live.context]);
    assert.equal(site.code, input.code);
    await assert.rejects(
      Reflect.apply(sites.rename, sites, [site.id, { name: 'Rejected rename' }, dead.context]),
      (e) => (e as { getStatus(): number }).getStatus() === 401,
    );
    await db.query("UPDATE user_role_assignment SET role='WORKER',site_id=$2 WHERE user_id=$1", [
      admin.id,
      site.id,
    ]);
    await assert.rejects(
      Reflect.apply(sites.rename, sites, [site.id, { name: 'Rejected rename' }, live.context]),
      (e) => (e as { getStatus(): number }).getStatus() === 403,
    );
    await db.query("UPDATE user_role_assignment SET role='ADMIN',site_id=NULL WHERE user_id=$1", [
      admin.id,
    ]);
    const renamed = await Reflect.apply(sites.rename, sites, [
      site.id,
      { name: 'Renamed' },
      live.context,
    ]);
    assert.equal(renamed.name, 'Renamed');
    const repeated = await Reflect.apply(sites.rename, sites, [
      site.id,
      { name: 'Renamed' },
      live.context,
    ]);
    assert.equal(repeated.name, 'Renamed');
    await assert.rejects(
      Reflect.apply(sites.create, sites, [input, live.context]),
      (e) => (e as { getStatus(): number }).getStatus() === 409,
    );
  } finally {
    await owned.dispose();
  }
});
