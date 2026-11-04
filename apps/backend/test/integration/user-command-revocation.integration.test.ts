import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { test } from 'node:test';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { createTestConfig } from '../support/config.js';

test('Site Manager revocation includes a login session committed while waiting for the account lock', async () => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  await owned.initialize();
  const login = db.createQueryRunner();
  let pending: Promise<unknown> | undefined;
  try {
    const actor = randomUUID(),
      target = randomUUID(),
      site = randomUUID();
    const actorSession = randomUUID(),
      newSession = randomUUID();
    await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Site')", [
      site,
    ]);
    for (const id of [actor, target])
      await db.query(
        "INSERT INTO app_user(id,username,display_name,password_hash) VALUES($1,$1::uuid::text,'Synthetic account','not-a-runtime-password')",
        [id],
      );
    await db.query(
      "INSERT INTO user_role_assignment(id,user_id,role,site_id) VALUES($1,$2,'ADMIN',NULL),($3,$4,'SITE_MANAGER',$5)",
      [randomUUID(), actor, randomUUID(), target, site],
    );
    const sessionSql =
      "INSERT INTO auth_session(id,user_id,client_type,refresh_token_hash,created_at,last_refreshed_at,expires_at,revoked_at) VALUES($1,$2,'WEB',$3,clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '5 minutes',NULL)";
    await db.query(sessionSql, [actorSession, actor, 'a'.repeat(64)]);
    const tokens = new AuthTokenService(new JwtService(), createTestConfig());
    const token = await tokens.issueAccessToken(actor, actorSession);
    const auth = new AuthService(db, tokens);
    const users = new UsersService(db, new SiteConfigurationService(db));
    await login.connect();
    await login.startTransaction();
    const [{ pid: holder }] = await login.query('SELECT pg_backend_pid() AS pid');
    await login.query('SELECT id FROM app_user WHERE id=$1 FOR UPDATE', [target]);
    pending = users.revokeSiteManager(target, site, {
      actorUserId: actor,
      reauthorize: async (manager) => {
        assert.equal((await auth.authenticate(token.accessToken, manager)).user.id, actor);
      },
    });
    // Attach a rejection handler while the lock-holder establishes the concurrent commit.
    void pending.catch(() => undefined);
    let blocked = false;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const [{ n }] = await db.query(
        'SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))',
        [holder],
      );
      if (n > 0) {
        blocked = true;
        break;
      }
      await setTimeout(20);
    }
    assert.equal(blocked, true, 'The actual revocation must wait on the account lock');
    // This matches login's account-lock -> insert session -> commit order without a model or HTTP server.
    await login.query(sessionSql, [newSession, target, 'b'.repeat(64)]);
    await login.commitTransaction();
    await pending;
    const [session] = await db.query(
      'SELECT revoked_at IS NOT NULL AS revoked FROM auth_session WHERE id=$1',
      [newSession],
    );
    assert.equal(
      session.revoked,
      true,
      'Revocation must see the session committed after its first snapshot',
    );
    const [{ n }] = await db.query(
      "SELECT count(*)::int AS n FROM user_role_assignment WHERE user_id=$1 AND site_id=$2 AND role='SITE_MANAGER'",
      [target, site],
    );
    assert.equal(n, 0);
  } finally {
    if (login.isTransactionActive) await login.rollbackTransaction();
    if (pending) await pending.catch(() => undefined);
    await login.release();
    await owned.dispose();
  }
});
