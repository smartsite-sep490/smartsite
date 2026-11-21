import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
import { WorkforceConfigurationService } from '../../src/modules/workforce/directory/workforce-configuration.service.js';
import { AuthClientType } from '../../src/database/entities/auth-session.entity.js';

test('administrative Worker account preparation/linking rechecks the original bearer and preserves idempotency', async () => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    const sites = new SiteConfigurationService(db),
      users = new UsersService(db, sites),
      workforce = new WorkforceConfigurationService(db);
    const password = 'SyntheticInitial123!',
      admin = await users.bootstrap('synthetic-admin', 'Synthetic Admin', password);
    const site = await sites.create({ code: 'SYNTHETIC-SITE', name: 'Synthetic Site' });
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
    const rejected = (status: number) => (error: unknown) =>
      (error as { getStatus(): number }).getStatus() === status;
    const input = { userId: admin.id };
    await assert.rejects(
      Reflect.apply(workforce.forAccount, workforce, [site.id, input, dead.context]),
      rejected(401),
    );
    assert.equal((await db.query('SELECT count(*)::int AS n FROM worker'))[0].n, 0);
    const live = await actorFor();
    const prepared = await Reflect.apply(workforce.forAccount, workforce, [
      site.id,
      input,
      live.context,
    ]);
    assert.equal(prepared.userId, admin.id);
    assert.equal(
      (await Reflect.apply(workforce.forAccount, workforce, [site.id, input, live.context])).id,
      prepared.id,
    );
    const workerId = randomUUID();
    await db.query(
      "INSERT INTO worker(id,site_id,external_id,display_name) VALUES($1,$2,'SYNTHETIC-WORKER','Synthetic Worker')",
      [workerId, site.id],
    );
    await assert.rejects(
      Reflect.apply(workforce.linkAccount, workforce, [site.id, workerId, input, dead.context]),
      rejected(401),
    );
    await db.query("UPDATE user_role_assignment SET role='WORKER',site_id=$2 WHERE user_id=$1", [
      admin.id,
      site.id,
    ]);
    await assert.rejects(
      Reflect.apply(workforce.linkAccount, workforce, [site.id, workerId, input, live.context]),
      rejected(403),
    );
    await db.query("UPDATE user_role_assignment SET role='ADMIN',site_id=NULL WHERE user_id=$1", [
      admin.id,
    ]);
    await assert.rejects(
      Reflect.apply(workforce.linkAccount, workforce, [site.id, workerId, input, live.context]),
      rejected(409),
    );
    await db.query('UPDATE worker SET user_id=NULL WHERE id=$1', [prepared.id]);
    const linked = await Reflect.apply(workforce.linkAccount, workforce, [
      site.id,
      workerId,
      input,
      live.context,
    ]);
    assert.equal(linked.id, workerId);
    assert.equal(linked.userId, admin.id);
    const second = { id: randomUUID() };
    await db.query(
      "INSERT INTO app_user(id,username,display_name,password_hash) SELECT $1,'synthetic-second','Synthetic second',password_hash FROM app_user WHERE id=$2",
      [second.id, admin.id],
    );
    await db.query(
      "INSERT INTO user_role_assignment(id,user_id,site_id,role) VALUES($1,$2,$3,'WORKER')",
      [randomUUID(), second.id, site.id],
    );
    await assert.rejects(
      Reflect.apply(workforce.linkAccount, workforce, [
        site.id,
        workerId,
        { userId: second.id },
        live.context,
      ]),
      rejected(409),
    );
  } finally {
    await owned.dispose();
  }
});
