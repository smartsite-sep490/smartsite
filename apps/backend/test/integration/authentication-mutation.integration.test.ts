import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../../src/modules/auth/auth.service.js';
import { AuthTokenService } from '../../src/modules/auth/auth-token.service.js';
import { hashPassword } from '../../src/modules/auth/password.js';
import {
  AuthClientType,
  SiteEntity,
  UserEntity,
  UserRole,
  UserRoleAssignmentEntity,
} from '../../src/database/entities/index.js';
import { createTestConfig } from '../support/config.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';

test(
  'real mutation claim pins account/session until commit and rejects completed revocation',
  { timeout: 30000 },
  async (t) => {
    const isolated = createIsolatedTestDatabase({ legacy: true });
    const db = isolated.dataSource;
    try {
      await isolated.initialize();
      const actorId = randomUUID(),
        siteId = randomUUID();
      const username = `claim-${actorId.slice(0, 8)}`,
        password = 'SyntheticClaim1!';
      await db
        .getRepository(SiteEntity)
        .insert({ id: siteId, code: `S-${siteId}`, name: 'Synthetic claim Site' });
      await db.getRepository(UserEntity).insert({
        id: actorId,
        username,
        displayName: 'Synthetic claim reviewer',
        passwordHash: await hashPassword(password),
        isActive: true,
        mustChangePassword: false,
      });
      await db
        .getRepository(UserRoleAssignmentEntity)
        .insert({ id: randomUUID(), userId: actorId, role: UserRole.SAFETY_OFFICER, siteId });
      const tokens = new AuthTokenService(new JwtService(), createTestConfig());
      const auth = new AuthService(db, tokens);
      const login = await auth.login(username, password, AuthClientType.MOBILE);
      const claims = await tokens.verifyAccessToken(login.accessToken);
      const claim = db.createQueryRunner();
      try {
        await claim.startTransaction();
        assert.equal((await auth.authenticate(login.accessToken, claim.manager)).user.id, actorId);
        for (const target of ['account', 'session'] as const) {
          await t.test(`${target} revocation waits for the authorized claim`, async () => {
            const writer = db.createQueryRunner();
            try {
              await writer.startTransaction();
              await writer.query("SET LOCAL lock_timeout = '100ms'");
              // Production status/password/role writers lock this account; logout locks this session.
              await assert.rejects(
                target === 'account'
                  ? writer.manager
                      .getRepository(UserEntity)
                      .update({ id: actorId }, { isActive: false })
                  : writer.query('UPDATE auth_session SET revoked_at=now() WHERE id=$1', [
                      claims.sessionId,
                    ]),
                (error: unknown) =>
                  (error as { driverError?: { code?: string } }).driverError?.code === '55P03',
              );
            } finally {
              try {
                if (writer.isTransactionActive) await writer.rollbackTransaction();
              } finally {
                await writer.release();
              }
            }
          });
        }
        await claim.commitTransaction();
      } finally {
        try {
          if (claim.isTransactionActive) await claim.rollbackTransaction();
        } finally {
          await claim.release();
        }
      }
      await auth.logout(login.refreshToken, AuthClientType.MOBILE);
      await assert.rejects(
        db.transaction((manager) => auth.authenticate(login.accessToken, manager)),
        UnauthorizedException,
      );
      const next = await auth.login(username, password, AuthClientType.MOBILE);
      await db.getRepository(UserEntity).update({ id: actorId }, { isActive: false });
      await assert.rejects(
        db.transaction((manager) => auth.authenticate(next.accessToken, manager)),
        UnauthorizedException,
      );
    } finally {
      await isolated.dispose();
    }
  },
);
