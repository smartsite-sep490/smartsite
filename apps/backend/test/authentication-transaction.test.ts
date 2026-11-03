import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UnauthorizedException } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import { AuthService, type AuthenticatedRequest } from '../src/modules/auth/auth.service.js';
import { AuthTokenService } from '../src/modules/auth/auth-token.service.js';
import { UserAuthGuard } from '../src/modules/auth/user-auth.guard.js';
import { UserEntity, UserRole } from '../src/database/entities/user.entity.js';
import { AuthClientType, AuthSessionEntity } from '../src/database/entities/auth-session.entity.js';
import { UserRoleAssignmentEntity } from '../src/database/entities/user-role-assignment.entity.js';

function fixture() {
  const calls: string[] = [];
  const expiresAt = new Date(Date.now() + 60_000);
  const user = {
    id: 'synthetic-user',
    username: 'synthetic',
    displayName: 'Synthetic',
    isActive: true,
    mustChangePassword: false,
  };
  const session = {
    id: 'synthetic-session',
    userId: user.id,
    revokedAt: null as Date | null,
    expiresAt,
    clientType: AuthClientType.WEB,
  };
  const claims = { userId: user.id, sessionId: session.id, expiresAt };
  const roles = [{ role: UserRole.SAFETY_OFFICER, siteId: 'synthetic-site' }];
  const builder = (kind: string, value: unknown) => {
    const result = {
      setLock(mode: string) {
        calls.push(`${kind}:${mode}`);
        return result;
      },
      where(_sql: string, parameters: Record<string, unknown>) {
        assert.equal(parameters.id, value === user ? user.id : session.id);
        return result;
      },
      andWhere(_sql: string, parameters: Record<string, unknown>) {
        assert.equal(parameters.userId, user.id);
        return result;
      },
      async getOne() {
        calls.push(`${kind}:read`);
        return value;
      },
    };
    return result;
  };
  const manager = {
    queryRunner: { isTransactionActive: true },
    getRepository(entity: unknown) {
      if (entity === UserEntity) return { createQueryBuilder: () => builder('user', user) };
      if (entity === AuthSessionEntity)
        return { createQueryBuilder: () => builder('session', session) };
      assert.equal(entity, UserRoleAssignmentEntity);
      return {
        async findBy() {
          calls.push('roles:read');
          return roles;
        },
      };
    },
  };
  const auth = new AuthService(
    {
      getRepository() {
        throw new Error('Default repository must not be used for transactional auth');
      },
    } as unknown as DataSource,
    {
      async verifyAccessToken() {
        calls.push('token:verify');
        return claims;
      },
    } as unknown as AuthTokenService,
  );
  const authenticate = auth.authenticate.bind(auth) as (
    token: string,
    manager: EntityManager,
  ) => ReturnType<AuthService['authenticate']>;
  return { auth, authenticate, manager, calls, user, session, claims, roles };
}

test('transaction auth locks account then session and reads current roles through the supplied manager', async () => {
  const f = fixture();
  const account = await f.authenticate('synthetic-token', f.manager as unknown as EntityManager);
  assert.equal(account.user.id, f.user.id);
  assert.deepEqual(account.user.roleAssignments, f.roles);
  assert.equal(account.sessionId, f.session.id);
  assert.deepEqual(f.calls, [
    'token:verify',
    'user:pessimistic_read',
    'user:read',
    'session:pessimistic_read',
    'session:read',
    'roles:read',
  ]);
});

test('transaction auth refuses an inactive transaction, revoked/expired session, disabled account or expired token', async () => {
  const inactive = fixture();
  inactive.manager.queryRunner.isTransactionActive = false;
  await assert.rejects(
    inactive.authenticate('synthetic-token', inactive.manager as unknown as EntityManager),
    UnauthorizedException,
  );
  assert.deepEqual(inactive.calls, []);
  for (const reason of [
    'revoked',
    'session-expired',
    'disabled',
    'token-expired',
    'roles-removed',
  ]) {
    const f = fixture();
    if (reason === 'revoked') f.session.revokedAt = new Date();
    if (reason === 'session-expired') f.session.expiresAt = new Date(0);
    if (reason === 'disabled') f.user.isActive = false;
    if (reason === 'token-expired') f.claims.expiresAt = new Date(0);
    if (reason === 'roles-removed') f.roles.length = 0;
    await assert.rejects(
      f.authenticate('synthetic-token', f.manager as unknown as EntityManager),
      UnauthorizedException,
      reason,
    );
  }
});

test('internal guard reuses bearer validation and forwards the transaction without accepting duplicate headers', async () => {
  const f = fixture();
  const guard = new UserAuthGuard({
    async authenticate(token: string, manager: EntityManager) {
      assert.equal(token, 'aaa.bbb.ccc');
      assert.equal(manager, f.manager);
      return {
        user: { ...f.user, roleAssignments: f.roles },
        sessionId: f.session.id,
        clientType: AuthClientType.WEB,
      };
    },
  } as unknown as AuthService) as unknown as {
    authenticateRequest(request: AuthenticatedRequest, manager?: EntityManager): Promise<void>;
  };
  const request: AuthenticatedRequest = {
    headers: { authorization: 'Bearer aaa.bbb.ccc' },
    rawHeaders: ['Authorization', 'Bearer aaa.bbb.ccc'],
  };
  await guard.authenticateRequest(request, f.manager as unknown as EntityManager);
  assert.equal(request.user?.id, f.user.id);
  assert.equal(request.sessionId, f.session.id);
  request.rawHeaders!.push('authorization', 'Bearer aaa.bbb.ccc');
  await assert.rejects(
    guard.authenticateRequest(request, f.manager as unknown as EntityManager),
    UnauthorizedException,
  );
});
