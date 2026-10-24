import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UnauthorizedException } from '@nestjs/common';
import type { DataSource, EntityManager } from 'typeorm';
import { AuthService } from '../src/modules/auth/auth.service.js';
import type { AuthTokenService } from '../src/modules/auth/auth-token.service.js';
import { UserEntity, UserRole } from '../src/database/entities/user.entity.js';
import { AuthSessionEntity, AuthClientType } from '../src/database/entities/auth-session.entity.js';
import { UserRoleAssignmentEntity } from '../src/database/entities/user-role-assignment.entity.js';

function fixture(change: 'none' | 'logout' | 'deactivated' | 'expired' | 'no-roles' = 'none') {
  const locks: string[] = [];
  const user = {
    id: 'actor',
    isActive: change !== 'deactivated',
    mustChangePassword: false,
    username: 'synthetic',
    displayName: 'Synthetic',
  };
  const session = {
    id: 'session',
    userId: user.id,
    clientType: AuthClientType.WEB,
    revokedAt: change === 'logout' ? new Date() : null,
    expiresAt: new Date(Date.now() + (change === 'expired' ? -1000 : 60_000)),
  };
  const manager = {
    queryRunner: { isTransactionActive: true },
    getRepository: (entity: unknown) => {
      if (entity === UserRoleAssignmentEntity)
        return {
          findBy: async () =>
            change === 'no-roles' ? [] : [{ role: UserRole.SAFETY_OFFICER, siteId: 'site' }],
        };
      const kind = entity === UserEntity ? 'user' : entity === AuthSessionEntity ? 'session' : null;
      if (!kind) throw new Error('Unexpected repository');
      const query = {
        setLock: (lock: string) => {
          locks.push(`${kind}:${lock}`);
          return query;
        },
        where: () => query,
        andWhere: () => query,
        getOne: async () => (kind === 'user' ? user : session),
      };
      return { createQueryBuilder: () => query };
    },
  } as unknown as EntityManager;
  const outside = {
    getRepository: () => {
      throw new Error('Mutation must use its own transaction connection');
    },
  } as unknown as DataSource;
  const tokens = {
    verifyAccessToken: async () => ({
      userId: 'actor',
      sessionId: 'session',
      expiresAt: new Date(Date.now() + 60_000),
    }),
  } as unknown as AuthTokenService;
  const service = new AuthService(outside, tokens);
  const authenticate = (value = manager) =>
    (service.authenticate as (...args: unknown[]) => Promise<{ user: { id: string } }>)(
      'synthetic-token',
      value,
    );
  return { authenticate, manager, locks };
}

test('mutation authentication reads its transaction and locks account before session', async () => {
  const f = fixture();
  assert.equal((await f.authenticate()).user.id, 'actor');
  assert.deepEqual(f.locks, ['user:pessimistic_read', 'session:pessimistic_read']);
});

for (const change of ['logout', 'deactivated', 'expired', 'no-roles'] as const)
  test(`mutation authentication rejects ${change} inside the transaction`, async () => {
    const f = fixture(change);
    await assert.rejects(f.authenticate(), UnauthorizedException);
  });

test('mutation authentication cannot run without an active transaction', async () => {
  const f = fixture();
  await assert.rejects(
    f.authenticate({
      ...f.manager,
      queryRunner: { isTransactionActive: false },
    } as unknown as EntityManager),
    UnauthorizedException,
  );
  assert.deepEqual(f.locks, []);
});
