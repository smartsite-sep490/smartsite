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
const syntheticUserId = '11111111-1111-4111-8111-111111111111';

function fixture(
  verified = true,
  options?: {
    onBetweenPrecheckAndCommand?: (state: {
      user: UserEntity;
      expireChallenge: () => void;
      replaceChallengeId: (nextId: string) => void;
    }) => void;
  },
) {
  const user = {
    id: syntheticUserId,
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
    expired = false,
    revoked = false,
    queueCalls = 0,
    authorityCommands = 0,
    challengeId = 'challenge-1',
    transactionCount = 0;
  const repository = {
    createQueryBuilder: () => ({
      setLock() {
        return this;
      },
      where() {
        return this;
      },
      getOne: async () => (user.isActive ? user : null),
    }),
    findOne: async () => (user.isActive ? user : null),
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
      if (sql.startsWith('SELECT id FROM app_user')) return user.isActive ? [{ id: user.id }] : [];
      if (sql.startsWith('SELECT count(*) FILTER'))
        return [{ n: 0, legacy: 0, baseline: 0, history: 0 }];
      if (sql.startsWith('SELECT id,token_hash'))
        return consumed || expired
          ? []
          : [
              {
                id: challengeId,
                token_hash: emailCodeHash(secret, user.id, 'RESET', '123456'),
                attempts,
              },
            ];
      if (sql.startsWith('UPDATE account_email_challenge SET attempts')) {
        attempts++;
        consumed = args[1] === true || attempts >= 5;
      }
      if (sql.includes('authorization_history_command')) authorityCommands++;
      if (sql.startsWith('INSERT INTO')) queueCalls++;
      return [];
    },
  } as unknown as EntityManager;
  const source = {
    transaction: async (
      isolationOrRun: string | ((m: EntityManager) => Promise<unknown>),
      maybeRun?: (m: EntityManager) => Promise<unknown>,
    ) => {
      const run = typeof isolationOrRun === 'function' ? isolationOrRun : maybeRun!;
      transactionCount += 1;
      if (transactionCount === 2) {
        options?.onBetweenPrecheckAndCommand?.({
          user,
          expireChallenge: () => {
            expired = true;
          },
          replaceChallengeId: (nextId: string) => {
            challengeId = nextId;
          },
        });
      }
      const result = await run(manager);
      committed = true;
      return result;
    },
  } as unknown as DataSource;
  const config = new ConfigService<BackendEnvironment, true>({
    NODE_ENV: 'test',
    AUTH_JWT_SECRET: secret,
    RESEND_API_KEY: 'synthetic-unused',
    RESEND_FROM_EMAIL: 'sender@example.test',
  });
  return {
    user,
    service: new AccountEmailService(source, config),
    state: () => ({
      committed,
      attempts,
      consumed,
      expired,
      revoked,
      queueCalls,
      authorityCommands,
    }),
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

test('confirmReset fails closed when account email, password version, or challenge changes or is replaced with the same code between precheck and command', async () => {
  const cases: Array<{
    name: string;
    mutate: (ctx: {
      user: UserEntity;
      expireChallenge: () => void;
      replaceChallengeId: (nextId: string) => void;
    }) => void;
    expectedHash: string;
  }> = [
    {
      name: 'account email changed',
      mutate: ({ user }) => {
        user.email = 'changed@example.test';
      },
      expectedHash: 'old-synthetic-hash',
    },
    {
      name: 'email verification cleared',
      mutate: ({ user }) => {
        user.emailVerifiedAt = null;
      },
      expectedHash: 'old-synthetic-hash',
    },
    {
      name: 'password version changed',
      mutate: ({ user }) => {
        user.passwordHash = 'rotated-by-other-request';
      },
      expectedHash: 'rotated-by-other-request',
    },
    {
      name: 'challenge expired',
      mutate: ({ expireChallenge }) => {
        expireChallenge();
      },
      expectedHash: 'old-synthetic-hash',
    },
    {
      name: 'account deactivated',
      mutate: ({ user }) => {
        user.isActive = false;
      },
      expectedHash: 'old-synthetic-hash',
    },
    {
      name: 'challenge replaced with new challengeId carrying the same code',
      mutate: ({ replaceChallengeId }) => {
        replaceChallengeId('challenge-2');
      },
      expectedHash: 'old-synthetic-hash',
    },
  ];

  for (const item of cases) {
    const f = fixture(true, { onBetweenPrecheckAndCommand: item.mutate });
    await assert.rejects(
      f.service.confirmReset('synthetic', '123456', 'SyntheticPassword9!'),
      (error: unknown) => (error as { getStatus?: () => number }).getStatus?.() === 400,
      `expected 400 when ${item.name}`,
    );
    assert.equal(f.user.passwordHash, item.expectedHash, `password unchanged when ${item.name}`);
    assert.equal(f.state().revoked, false, `sessions unrevoked when ${item.name}`);
    assert.equal(f.state().consumed, false, `challenge not consumed when ${item.name}`);
    assert.equal(f.state().authorityCommands, 0, `no authority command recorded when ${item.name}`);
  }
});
