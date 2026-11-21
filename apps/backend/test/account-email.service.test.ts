import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ConfigService } from '@nestjs/config';
import type { DataSource, EntityManager } from 'typeorm';
import { AccountEmailService } from '../src/modules/auth/account-email.service.js';
import { emailCodeHash } from '../src/modules/auth/account-email-crypto.js';
import { AuthSessionEntity } from '../src/database/entities/auth-session.entity.js';
import { UserEntity } from '../src/database/entities/user.entity.js';
import type { BackendEnvironment } from '../src/config/environment.js';
import { verifyPassword } from '../src/modules/auth/password.js';

const secret = 'synthetic-unit-test-email-secret';
function fixture(verified = true) {
  const user = {
    id: 'synthetic-user',
    username: 'synthetic',
    email: 'synthetic@example.test',
    emailVerifiedAt: verified ? new Date() : null,
    passwordHash: 'old-synthetic-hash',
    isActive: true,
    mustChangePassword: false,
  } as UserEntity;
  let committed = false,
    attempts = 0,
    consumed = false,
    revoked = false,
    queueCalls = 0;
  const repository = {
    createQueryBuilder: () => ({
      setLock() {
        return this;
      },
      where() {
        return this;
      },
      getOne: async () => user,
    }),
    save: async () => user,
  };
  const manager = {
    getRepository: (entity: unknown) =>
      entity === AuthSessionEntity
        ? {
            update: async () => {
              revoked = true;
            },
          }
        : repository,
    query: async (sql: string, args: unknown[] = []) => {
      if (sql.startsWith('SELECT EXISTS')) return [{ recent: false }];
      if (sql.startsWith('SELECT id,token_hash'))
        return consumed
          ? []
          : [
              {
                id: 'challenge',
                token_hash: emailCodeHash(secret, user.id, 'RESET', '123456'),
                attempts,
              },
            ];
      if (sql.startsWith('UPDATE account_email_challenge SET attempts')) {
        attempts++;
        consumed = args[1] === true || attempts >= 5;
      }
      if (sql.startsWith('INSERT INTO')) queueCalls++;
      return [];
    },
  } as unknown as EntityManager;
  const source = {
    transaction: async (run: (m: EntityManager) => Promise<unknown>) => {
      const result = await run(manager);
      committed = true;
      return result;
    },
  } as DataSource;
  const config = new ConfigService<BackendEnvironment, true>({
    NODE_ENV: 'test',
    AUTH_JWT_SECRET: secret,
    RESEND_API_KEY: 'synthetic-unused',
    RESEND_FROM_EMAIL: 'sender@example.test',
  });
  return {
    user,
    service: new AccountEmailService(source, config),
    state: () => ({ committed, attempts, consumed, revoked, queueCalls }),
  };
}

test('wrong reset code commits its attempt and locks after five failures without changing password or sessions', async () => {
  const f = fixture();
  for (let attempt = 1; attempt <= 6; attempt++) {
    await assert.rejects(f.service.confirmReset('synthetic', '999999', 'SyntheticPassword9!'));
    assert.equal(f.state().committed, true);
    assert.equal(f.state().attempts, Math.min(attempt, 5));
  }
  assert.equal(f.user.passwordHash, 'old-synthetic-hash');
  assert.equal(f.state().revoked, false);
});

test('valid reset hashes the new password, consumes the code once, and revokes existing sessions', async () => {
  const f = fixture();
  assert.deepEqual(await f.service.confirmReset('synthetic', '123456', 'SyntheticPassword9!'), {
    accepted: true,
  });
  assert.equal(await verifyPassword('SyntheticPassword9!', f.user.passwordHash), true);
  assert.equal(f.state().revoked, true);
  assert.equal(f.user.mustChangePassword, false);
  await assert.rejects(f.service.confirmReset('synthetic', '123456', 'OtherPassword9!'));
  assert.equal(await verifyPassword('SyntheticPassword9!', f.user.passwordHash), true);
});

test('unverified email cannot request or confirm a password reset and the request stays generic', async () => {
  const f = fixture(false);
  assert.deepEqual(await f.service.requestReset('synthetic'), { accepted: true });
  assert.equal(f.state().queueCalls, 0);
  await assert.rejects(f.service.confirmReset('synthetic', '123456', 'SyntheticPassword9!'));
  assert.equal(f.state().attempts, 0);
  assert.equal(f.state().revoked, false);
});
