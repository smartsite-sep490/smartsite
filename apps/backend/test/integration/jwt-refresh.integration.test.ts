import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { JwtService } from '@nestjs/jwt';
import dataSource from '../support/test-data-source.js';
import { createTestConfig } from '../support/config.js';
import { AuthClientType } from '../../src/database/entities/auth-session.entity.js';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service.js';
import { UsersService } from '../../src/modules/users/users.service.js';
import { SiteConfigurationService } from '../../src/modules/sites/site-configuration.service.js';
import { AuthSessionEntity } from '../../src/database/entities/auth-session.entity.js';

after(async () => {
  if (dataSource.isInitialized) await dataSource.destroy();
});

test('mobile refresh rotates once and replay revokes the database-backed JWT session', async () => {
  await dataSource.initialize();
  await dataSource.query('TRUNCATE auth_session, user_role_assignment, app_user CASCADE');
  const users = new UsersService(dataSource, new SiteConfigurationService(dataSource));
  const tokens = new AuthTokenService(new JwtService(), createTestConfig());
  const auth = new AuthService(dataSource, tokens);
  const password = 'InitialAdmin1!';
  const admin = await users.bootstrap(
    `jwt-admin-${randomUUID().slice(0, 8)}`,
    'JWT Admin',
    password,
  );

  const first = await auth.login(admin.username, password, AuthClientType.MOBILE);
  const absoluteExpiry = first.refreshTokenExpiresAt;
  assert.equal(first.accessToken.split('.').length, 3);
  assert.ok(first.refreshToken);
  assert.equal((await auth.authenticate(first.accessToken)).user.id, admin.id);

  const rotated = await auth.refresh(first.refreshToken, AuthClientType.MOBILE);
  assert.equal((await auth.authenticate(rotated.accessToken)).user.id, admin.id);
  assert.notEqual(rotated.refreshToken, first.refreshToken);
  assert.equal(rotated.refreshTokenExpiresAt, absoluteExpiry);
  await assert.rejects(auth.refresh(first.refreshToken, AuthClientType.MOBILE));
  await assert.rejects(auth.authenticate(rotated.accessToken));
});

test('concurrent refresh cannot leave two valid rotated tokens', async () => {
  if (!dataSource.isInitialized) await dataSource.initialize();
  await dataSource.query('TRUNCATE auth_session, user_role_assignment, app_user CASCADE');
  const users = new UsersService(dataSource, new SiteConfigurationService(dataSource));
  const auth = new AuthService(
    dataSource,
    new AuthTokenService(new JwtService(), createTestConfig()),
  );
  const password = 'ConcurrentAdmin1!';
  const admin = await users.bootstrap(
    `race-admin-${randomUUID().slice(0, 8)}`,
    'Race Admin',
    password,
  );
  const login = await auth.login(admin.username, password, AuthClientType.MOBILE);
  const attempts = await Promise.allSettled([
    auth.refresh(login.refreshToken, AuthClientType.MOBILE),
    auth.refresh(login.refreshToken, AuthClientType.MOBILE),
  ]);
  assert.equal(attempts.filter(({ status }) => status === 'fulfilled').length, 1);
  const sessionId = login.refreshToken.split('.')[0]!;
  assert.ok(
    (await dataSource.getRepository(AuthSessionEntity).findOneByOrFail({ id: sessionId }))
      .revokedAt,
  );
  for (const attempt of attempts)
    if (attempt.status === 'fulfilled')
      await assert.rejects(auth.authenticate(attempt.value.accessToken));
});

