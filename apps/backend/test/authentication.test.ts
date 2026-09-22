import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ThrottlerStorageService } from '@nestjs/throttler';
import { validateEnvironment } from '../src/config/environment.js';
import {
  AdminGuard,
  ChangePasswordThrottleGuard,
  UserAuthGuard,
} from '../src/modules/auth/user-auth.guard.js';
import { hashPassword, validPassword, verifyPassword } from '../src/modules/auth/password.js';
import { tokenHash } from '../src/modules/auth/auth.service.js';
import { UserRole } from '../src/database/entities/user.entity.js';

test('password hashing uses a random salt and rejects an incorrect password', async () => {
  const password = 'correct horse battery staple';
  assert.equal(validPassword(password), true);
  assert.equal(validPassword('short'), false);
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword('wrong-password-123', first), false);
  assert.equal(await verifyPassword(password, 'bad-hash'), false);
  assert.equal(first.includes(password), false);
  assert.equal(tokenHash('fake-token').length, 64);
});

test('user guard rejects service tokens, duplicate headers, and missing sessions', async () => {
  const user = {
    id: randomUUID(),
    username: 'admin',
    displayName: 'Admin',
    role: UserRole.ADMIN,
    isActive: true,
    mustChangePassword: false,
  };
  const token = 'A'.repeat(43);
  const guard = new UserAuthGuard({
    authenticate: async (value: string) => {
      assert.equal(value, token);
      return { user, tokenHash: tokenHash(value) };
    },
  } as never);
  const request = {
    headers: { authorization: `Bearer ${token}` },
    rawHeaders: ['Authorization', `Bearer ${token}`],
  };
  const context = { switchToHttp: () => ({ getRequest: () => request }) } as ExecutionContext;
  assert.equal(await guard.canActivate(context), true);
  assert.equal((request as typeof request & { user: typeof user }).user.id, user.id);
  request.headers.authorization = 'Bearer service-token';
  await assert.rejects(guard.canActivate(context), UnauthorizedException);
  request.headers.authorization = `Bearer ${token}`;
  request.rawHeaders.push('authorization', `Bearer ${token}`);
  await assert.rejects(guard.canActivate(context), UnauthorizedException);
});

test('Admin guard excludes Worker and temporary-password Admin', () => {
  const guard = new AdminGuard();
  const request = {
    user: { role: UserRole.WORKER, mustChangePassword: false },
  };
  const context = { switchToHttp: () => ({ getRequest: () => request }) } as ExecutionContext;
  assert.throws(() => guard.canActivate(context), ForbiddenException);
  request.user.role = UserRole.ADMIN;
  request.user.mustChangePassword = true;
  assert.throws(() => guard.canActivate(context), ForbiddenException);
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
