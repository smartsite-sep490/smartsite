import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { ExecutionContext, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerStorageService } from '@nestjs/throttler';
import { validateEnvironment } from '../src/config/environment.js';
import {
  AdminGuard,
  ChangePasswordThrottleGuard,
  UserAuthGuard,
} from '../src/modules/auth/user-auth.guard.js';
import { hashPassword, validPassword, verifyPassword } from '../src/modules/auth/password.js';
import { UserRole } from '../src/database/entities/user.entity.js';
import { AuthClientType } from '../src/database/entities/auth-session.entity.js';
import { AuthTokenService } from '../src/modules/auth/auth-token.service.js';
import { AuthController } from '../src/modules/auth/auth.controller.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { command } from '../src/common/configuration/commands.js';
import { CreateUserDto, ResetPasswordDto } from '../src/modules/users/users.service.js';
import { createTestConfig } from './support/config.js';

test('password hashing uses a random salt and rejects an incorrect password', async () => {
  const password = 'correct Horse1!';
  assert.equal(validPassword(password), true);
  assert.equal(validPassword('short'), false);
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword('wrong-password-123', first), false);
  assert.equal(await verifyPassword(password, 'bad-hash'), false);
  assert.equal(first.includes(password), false);
});

test('password policy requires uppercase, digit, and special character from eight characters', () => {
  assert.equal(validPassword('Abcd123!'), true);
  assert.equal(validPassword('ABCDEFG1!'), true);
  assert.equal(validPassword('abcdefg1!'), false);
  assert.equal(validPassword('ABCDEFG!'), false);
  assert.equal(validPassword('Abcdefgh'), false);
  assert.equal(validPassword('Abc12!'), false);
  assert.equal(validPassword('ABCDEFG1 '), false);
  assert.equal(validPassword('Abcd123!\n'), false);
  assert.equal(validPassword(`A1!${'a'.repeat(126)}`), false);
});

test('user creation and reset DTOs enforce the shared password policy', () => {
  const account = {
    username: 'admin',
    displayName: 'Admin',
    roleAssignments: [{ role: UserRole.ADMIN, siteId: null }],
  };
  assert.doesNotThrow(() =>
    command(CreateUserDto, { ...account, temporaryPassword: 'Abcd123!' }),
  );
  assert.throws(
    () => command(CreateUserDto, { ...account, temporaryPassword: 'abcdefg1!' }),
    { status: 400 },
  );
  assert.throws(() => command(ResetPasswordDto, { temporaryPassword: 'ABCDEFG!' }), {
    status: 400,
  });
});

test('access JWT is scoped to one database session and expires after fifteen minutes', async () => {
  const tokens = new AuthTokenService(new JwtService(), createTestConfig());
  const userId = randomUUID();
  const sessionId = randomUUID();
  const issued = await tokens.issueAccessToken(userId, sessionId);
  const payload = await tokens.verifyAccessToken(issued.accessToken);
  assert.deepEqual({ userId: payload.userId, sessionId: payload.sessionId }, { userId, sessionId });
  assert.equal(payload.expiresAt.getTime() - payload.issuedAt.getTime(), 15 * 60 * 1000);
  assert.equal(issued.expiresAt.toISOString(), payload.expiresAt.toISOString());

  const wrongSecret = new AuthTokenService(
    new JwtService(),
    createTestConfig({ AUTH_JWT_SECRET: 'different-test-secret-at-least-32-characters' }),
  );
  await assert.rejects(wrongSecret.verifyAccessToken(issued.accessToken), UnauthorizedException);

  const secret = 'claim-validation-test-secret-at-least-32-characters';
  const strictTokens = new AuthTokenService(
    new JwtService(),
    createTestConfig({ AUTH_JWT_SECRET: secret }),
  );
  const now = Math.floor(Date.now() / 1000);
  const claims = { sub: userId, sid: sessionId, typ: 'access', iat: now, exp: now + 60 };
  for (const options of [
    { issuer: 'wrong', audience: 'smartsite-clients' },
    { issuer: 'smartsite-backend', audience: 'wrong' },
  ]) {
    const invalid = await new JwtService().signAsync(claims, {
      secret,
      algorithm: 'HS256',
      ...options,
    });
    await assert.rejects(strictTokens.verifyAccessToken(invalid), UnauthorizedException);
  }
  const wrongType = await new JwtService().signAsync(
    { ...claims, typ: 'refresh' },
    {
      secret,
      algorithm: 'HS256',
      issuer: 'smartsite-backend',
      audience: 'smartsite-clients',
    },
  );
  await assert.rejects(strictTokens.verifyAccessToken(wrongType), UnauthorizedException);
  const expired = await new JwtService().signAsync(
    { ...claims, iat: now - 120, exp: now - 60 },
    {
      secret,
      algorithm: 'HS256',
      issuer: 'smartsite-backend',
      audience: 'smartsite-clients',
    },
  );
  await assert.rejects(strictTokens.verifyAccessToken(expired), UnauthorizedException);
});

test('refresh tokens expose only a session id and hash their random secret', () => {
  const tokens = new AuthTokenService(new JwtService(), createTestConfig());
  const sessionId = randomUUID();
  const first = tokens.issueRefreshToken(sessionId);
  const second = tokens.issueRefreshToken(sessionId);
  assert.notEqual(first.refreshToken, second.refreshToken);
  assert.equal(first.secretHash.length, 64);
  assert.deepEqual(tokens.parseRefreshToken(first.refreshToken), {
    sessionId,
    secretHash: first.secretHash,
  });
  for (const malformed of ['', sessionId, `${sessionId}.short`, `not-a-uuid.${'A'.repeat(43)}`])
    assert.throws(() => tokens.parseRefreshToken(malformed), UnauthorizedException);
});

test('auth controller separates Web cookies from Mobile refresh-token JSON', async () => {
  const result = {
    accessToken: 'access.jwt.value',
    tokenType: 'Bearer' as const,
    accessTokenExpiresAt: new Date(Date.now() + 900_000).toISOString(),
    refreshToken: `${randomUUID()}.${'A'.repeat(43)}`,
    refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    user: {
      id: randomUUID(),
      username: 'admin',
      displayName: 'Admin',
      roleAssignments: [{ role: UserRole.ADMIN, siteId: null }],
      isActive: true,
      mustChangePassword: false,
    },
  };
  const auth = {
    login: async () => result,
    refresh: async () => result,
    logout: async () => undefined,
  };
  const controller = new AuthController(auth as never, createTestConfig());
  const cookies: Array<{ name: string; value: string; options: Record<string, unknown> }> = [];
  const response = {
    cookie: (name: string, value: string, options: Record<string, unknown>) => {
      cookies.push({ name, value, options });
    },
    clearCookie: () => undefined,
  };
  const web = await controller.login(
    { headers: { origin: 'http://localhost:5173' } } as never,
    response as never,
    { username: 'admin', password: 'password', clientType: AuthClientType.WEB },
  );
  assert.equal('refreshToken' in web, false);
  assert.deepEqual(
    {
      name: cookies[0]?.name,
      httpOnly: cookies[0]?.options.httpOnly,
      sameSite: cookies[0]?.options.sameSite,
      secure: cookies[0]?.options.secure,
      path: cookies[0]?.options.path,
    },
    {
      name: 'smartsite_refresh',
      httpOnly: true,
      sameSite: 'strict',
      secure: false,
      path: '/api/v1/auth',
    },
  );
  const mobile = await controller.login({ headers: {} } as never, response as never, {
    username: 'admin',
    password: 'password',
    clientType: AuthClientType.MOBILE,
  });
  assert.equal(mobile.refreshToken, result.refreshToken);
  await assert.rejects(
    controller.login(
      { headers: { origin: 'https://lookalike.invalid' } } as never,
      response as never,
      { username: 'admin', password: 'password', clientType: AuthClientType.WEB },
    ),
    { status: 403 },
  );
  await assert.rejects(
    controller.refresh(
      {
        headers: {
          origin: 'http://localhost:5173',
          cookie: `smartsite_refresh=${result.refreshToken}`,
        },
      } as never,
      response as never,
      { clientType: AuthClientType.WEB, refreshToken: result.refreshToken },
    ),
    { status: 401 },
  );
  await assert.rejects(
    controller.logout(
      {
        headers: {
          origin: 'http://localhost:5173',
          cookie: `smartsite_refresh=${result.refreshToken}`,
        },
      } as never,
      response as never,
      { clientType: AuthClientType.WEB, refreshToken: result.refreshToken },
    ),
    { status: 401 },
  );
  for (const refreshToken of ['', null]) {
    await assert.rejects(
      controller.refresh(
        {
          headers: {
            origin: 'http://localhost:5173',
            cookie: `smartsite_refresh=${result.refreshToken}`,
          },
        } as never,
        response as never,
        { clientType: AuthClientType.WEB, refreshToken } as never,
      ),
      { status: 401 },
    );
    await assert.rejects(
      controller.logout(
        {
          headers: {
            origin: 'http://localhost:5173',
            cookie: `smartsite_refresh=${result.refreshToken}`,
          },
        } as never,
        response as never,
        { clientType: AuthClientType.WEB, refreshToken } as never,
      ),
      { status: 401 },
    );
  }
  await assert.rejects(
    controller.refresh(
      {
        headers: {
          origin: 'http://localhost:5173',
          cookie: `smartsite_refresh=${'R'.repeat(81)}`,
        },
      } as never,
      response as never,
      { clientType: AuthClientType.WEB },
    ),
    { status: 401 },
  );
  const webRefresh = await controller.refresh(
    {
      headers: {
        origin: 'http://localhost:5173',
        cookie: `smartsite_refresh=${result.refreshToken}`,
      },
    } as never,
    response as never,
    { clientType: AuthClientType.WEB },
  );
  assert.equal('refreshToken' in webRefresh, false);
  const mobileRefresh = await controller.refresh(
    { headers: {} } as never,
    response as never,
    { clientType: AuthClientType.MOBILE, refreshToken: result.refreshToken },
  );
  assert.equal(mobileRefresh.refreshToken, result.refreshToken);
});

test('auth request bodies reject invalid security-sensitive fields and unknown fields', async () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
  });
  const bodyType = (method: 'login' | 'refresh' | 'changePassword') => {
    const types = Reflect.getMetadata(
      'design:paramtypes',
      AuthController.prototype,
      method,
    ) as unknown[];
    return types[2] as never;
  };
  const cases = [
    {
      method: 'login' as const,
      body: { username: 'u'.repeat(65), password: 'password', clientType: AuthClientType.MOBILE },
    },
    {
      method: 'login' as const,
      body: { username: 'admin', password: 'p'.repeat(129), clientType: AuthClientType.MOBILE },
    },
    {
      method: 'refresh' as const,
      body: { clientType: AuthClientType.MOBILE, refreshToken: 'r'.repeat(81) },
    },
    {
      method: 'refresh' as const,
      body: { clientType: AuthClientType.MOBILE, refreshToken: '' },
    },
    {
      method: 'refresh' as const,
      body: { clientType: AuthClientType.MOBILE, refreshToken: null },
    },
    {
      method: 'changePassword' as const,
      body: { currentPassword: 'p'.repeat(129), newPassword: 'valid-new-password' },
    },
    {
      method: 'changePassword' as const,
      body: { currentPassword: 'current-password', newPassword: 'p'.repeat(129) },
    },
    {
      method: 'changePassword' as const,
      body: { currentPassword: 'legacy', newPassword: 'abcdefg1!' },
    },
    {
      method: 'login' as const,
      body: {
        username: 'admin',
        password: 'password',
        clientType: AuthClientType.MOBILE,
        unexpected: true,
      },
    },
  ];
  for (const { method, body } of cases)
    await assert.rejects(
      pipe.transform(body, { type: 'body', metatype: bodyType(method) }),
      { status: 400 },
    );
});

test('logout rejects a client-type mismatch and remains idempotent after revocation', async () => {
  const tokens = new AuthTokenService(new JwtService(), createTestConfig());
  const sessionId = randomUUID();
  const refresh = tokens.issueRefreshToken(sessionId);
  const session = {
    id: sessionId,
    clientType: AuthClientType.MOBILE,
    refreshTokenHash: refresh.secretHash,
    revokedAt: null as Date | null,
  };
  let storedSession: typeof session | undefined = session;
  let saves = 0;
  const query = {
    setLock: () => query,
    where: () => query,
    getOne: async () => storedSession,
  };
  const manager = {
    getRepository: () => ({
      createQueryBuilder: () => query,
      save: async () => {
        saves += 1;
      },
    }),
  };
  const dataSource = {
    transaction: async (work: (value: typeof manager) => Promise<void>) => work(manager),
  };
  const auth = new AuthService(dataSource as never, tokens);

  await assert.rejects(auth.logout(refresh.refreshToken, AuthClientType.WEB), UnauthorizedException);
  assert.equal(session.revokedAt, null);

  await auth.logout(refresh.refreshToken, AuthClientType.MOBILE);
  assert.ok(session.revokedAt);
  assert.equal(saves, 1);
  await auth.logout(refresh.refreshToken, AuthClientType.MOBILE);
  assert.equal(saves, 1);
  storedSession = undefined;
  await auth.logout(refresh.refreshToken, AuthClientType.MOBILE);
  assert.equal(saves, 1);
});

test('user guard rejects service tokens, duplicate headers, and missing sessions', async () => {
  const user = {
    id: randomUUID(),
    username: 'admin',
    displayName: 'Admin',
    roleAssignments: [{ role: UserRole.ADMIN, siteId: null }],
    isActive: true,
    mustChangePassword: false,
  };
  const token = `${'A'.repeat(16)}.${'B'.repeat(16)}.${'C'.repeat(16)}`;
  const sessionId = randomUUID();
  const guard = new UserAuthGuard({
    authenticate: async (value: string) => {
      assert.equal(value, token);
      return { user, sessionId, clientType: AuthClientType.MOBILE };
    },
  } as never);
  const request = {
    headers: { authorization: `Bearer ${token}` },
    rawHeaders: ['Authorization', `Bearer ${token}`],
  };
  const context = { switchToHttp: () => ({ getRequest: () => request }) } as ExecutionContext;
  assert.equal(await guard.canActivate(context), true);
  assert.equal((request as typeof request & { user: typeof user }).user.id, user.id);
  assert.equal((request as typeof request & { sessionId: string }).sessionId, sessionId);
  request.headers.authorization = 'Bearer service-token';
  await assert.rejects(guard.canActivate(context), UnauthorizedException);
  request.headers.authorization = `Bearer ${token}`;
  request.rawHeaders.push('authorization', `Bearer ${token}`);
  await assert.rejects(guard.canActivate(context), UnauthorizedException);
});

test('Admin guard requires a global Admin assignment and a changed password', () => {
  const guard = new AdminGuard();
  const request = {
    user: {
      roleAssignments: [{ role: UserRole.SECURITY_OFFICER, siteId: randomUUID() as string | null }],
      mustChangePassword: false,
    },
  };
  const context = { switchToHttp: () => ({ getRequest: () => request }) } as ExecutionContext;
  assert.throws(() => guard.canActivate(context), { status: 403 });
  request.user.roleAssignments = [{ role: UserRole.ADMIN, siteId: null }];
  request.user.mustChangePassword = true;
  assert.throws(() => guard.canActivate(context), { status: 403 });
  request.user.mustChangePassword = false;
  assert.equal(guard.canActivate(context), true);
});

test('password change quota uses throttler storage independently per user', async () => {
  const storage = new ThrottlerStorageService();
  const guard = new ChangePasswordThrottleGuard(storage);
  const headers = new Map<string, string>();
  const request = { user: { id: randomUUID() } };
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ setHeader: (name: string, value: string) => headers.set(name, value) }),
    }),
  } as ExecutionContext;
  try {
    for (let attempt = 0; attempt < 5; attempt += 1)
      assert.equal(await guard.canActivate(context), true);
    await assert.rejects(guard.canActivate(context), { status: 429 });
    assert.ok(Number(headers.get('Retry-After')) > 0);
    request.user.id = randomUUID();
    assert.equal(await guard.canActivate(context), true);
  } finally {
    storage.onApplicationShutdown();
  }
});

test('AI camera allowlist validates UUIDs and denies by default', () => {
  const id = randomUUID();
  assert.deepEqual(validateEnvironment({ NODE_ENV: 'test' }).AI_CONFIGURATION_CAMERA_IDS, []);
  assert.deepEqual(
    validateEnvironment({ NODE_ENV: 'test', AI_CONFIGURATION_CAMERA_IDS: `${id},${id}` })
      .AI_CONFIGURATION_CAMERA_IDS,
    [id],
  );
  assert.throws(
    () => validateEnvironment({ NODE_ENV: 'test', AI_CONFIGURATION_CAMERA_IDS: 'wildcard' }),
    /AI_CONFIGURATION_CAMERA_IDS/,
  );
});
