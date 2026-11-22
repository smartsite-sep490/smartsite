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
import { passwordChangeCommandContext } from '../../src/modules/auth/configuration-command-context.js';
import { hashPassword, verifyPassword } from '../../src/modules/auth/password.js';

test('self password change rechecks the original session, permits temporary credentials and revokes all sessions atomically', async () => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  try {
    await owned.initialize();
    const actor = randomUUID(),
      other = randomUUID(),
      password = 'SyntheticInitial123!';
    const originalHash = await hashPassword(password);
    await db.query(
      `INSERT INTO app_user(id,username,display_name,password_hash,must_change_password)
      VALUES($1,$1::uuid::text,'Synthetic self',$3,true),($2,$2::uuid::text,'Synthetic other',$3,false)`,
      [actor, other, originalHash],
    );
    const site = randomUUID();
    await db.query("INSERT INTO site(id,code,name) VALUES($1,$1::uuid::text,'Synthetic Site')", [
      site,
    ]);
    await db.query(
      "INSERT INTO user_role_assignment(id,user_id,site_id,role) VALUES($1,$2,$3,'WORKER')",
      [randomUUID(), actor, site],
    );
    const auth = new AuthService(db, new AuthTokenService(new JwtService(), createTestConfig()));
    const guard = new UserAuthGuard(auth);
    const requestFor = async () => {
      const login = await auth.login(actor, password, 'WEB' as never);
      const request: AuthenticatedRequest = {
        headers: { authorization: 'Bearer ' + login.accessToken },
      };
      await guard.authenticateRequest(request);
      return { request, token: login.accessToken };
    };
    const first = await requestFor();
    const context = passwordChangeCommandContext(first.request, guard);
    await db.query('UPDATE auth_session SET revoked_at=clock_timestamp() WHERE id=$1', [
      first.request.sessionId,
    ]);
    await assert.rejects(
      Reflect.apply(auth.changePassword, auth, [
        actor,
        password,
        'RejectedReplacement123!',
        context,
      ]),
      (error) => (error as { getStatus(): number }).getStatus() === 401,
    );
    assert.equal(
      (await db.query('SELECT password_hash FROM app_user WHERE id=$1', [actor]))[0].password_hash,
      originalHash,
    );
    const active = await requestFor(),
      second = await requestFor();
    const activeContext = passwordChangeCommandContext(active.request, guard);
    await assert.rejects(
      Reflect.apply(auth.changePassword, auth, [
        other,
        password,
        'RejectedOther123!',
        activeContext,
      ]),
      (error) => (error as { getStatus(): number }).getStatus() === 403,
    );
    assert.equal(
      (await db.query('SELECT password_hash FROM app_user WHERE id=$1', [other]))[0].password_hash,
      originalHash,
    );
    await assert.rejects(
      Reflect.apply(auth.changePassword, auth, [
        actor,
        'WrongPassword123!',
        'RejectedWrong123!',
        activeContext,
      ]),
      (error) => (error as { getStatus(): number }).getStatus() === 401,
    );
    await Reflect.apply(auth.changePassword, auth, [
      actor,
      password,
      'AcceptedReplacement123!',
      activeContext,
    ]);
    const user = (
      await db.query('SELECT password_hash,must_change_password FROM app_user WHERE id=$1', [actor])
    )[0];
    assert.equal(user.must_change_password, false);
    assert.equal(await verifyPassword('AcceptedReplacement123!', user.password_hash), true);
    await assert.rejects(auth.authenticate(active.token));
    await assert.rejects(auth.authenticate(second.token));
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::int AS n FROM auth_session WHERE user_id=$1 AND revoked_at IS NULL',
          [actor],
        )
      )[0].n,
      0,
    );
  } finally {
    await owned.dispose();
  }
});
