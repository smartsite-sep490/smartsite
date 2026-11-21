import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { ConfigService } from '@nestjs/config';
import type { BackendEnvironment } from '../../src/config/environment.js';
import { createIsolatedTestDatabase } from '../support/isolated-test-database.js';
import { UserEntity } from '../../src/database/entities/user.entity.js';
import {
  AuthSessionEntity,
  AuthClientType,
} from '../../src/database/entities/auth-session.entity.js';
import { AccountEmailService } from '../../src/modules/auth/account-email.service.js';
import { decryptAccountEmail } from '../../src/modules/auth/account-email-crypto.js';
import { hashPassword, verifyPassword } from '../../src/modules/auth/password.js';
import { MobilePushService } from '../../src/modules/workforce/notifications/mobile-push.service.js';
import type { AuthenticatedUser } from '../../src/modules/auth/auth.service.js';

test('account email schema, attempt commits, verified reset, session revocation and push ownership', async () => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  const secret = 'synthetic-integration-email-secret';
  const config = new ConfigService<BackendEnvironment, true>({
    NODE_ENV: 'test',
    AUTH_JWT_SECRET: secret,
    RESEND_API_KEY: 'synthetic-never-sent',
    RESEND_FROM_EMAIL: 'sender@example.test',
    EXPO_PUSH_ENABLED: true,
  });
  try {
    await owned.initialize();
    const user = await db.getRepository(UserEntity).save({
      id: randomUUID(),
      username: randomUUID(),
      displayName: 'Synthetic Worker',
      passwordHash: await hashPassword('SyntheticPassword9!'),
      email: 'worker@example.test',
      emailVerifiedAt: null,
      isActive: true,
      mustChangePassword: false,
    });
    const service = new AccountEmailService(db, config);
    await db.transaction((manager) =>
      service.queueWelcome(manager, user, 'SyntheticPassword9!', 'vi'),
    );
    const [queued] = await db.query<Array<{ payload_ciphertext: string }>>(
      'SELECT payload_ciphertext FROM account_email_outbox WHERE user_id=$1',
      [user.id],
    );
    assert.ok(queued);
    assert.equal(queued.payload_ciphertext.includes('SyntheticPassword9!'), false);
    const welcome = decryptAccountEmail(queued.payload_ciphertext, secret) as { text: string };
    assert.ok(welcome.text.includes(user.username));
    assert.ok(welcome.text.includes('SyntheticPassword9!'));
    const verificationCode = /: (\d{6})\n/.exec(welcome.text)?.[1];
    assert.ok(verificationCode);
    assert.deepEqual(await service.requestReset(user.username), { accepted: true });
    const [beforeVerify] = await db.query<Array<{ count: number }>>(
      "SELECT count(*)::int AS count FROM account_email_challenge WHERE user_id=$1 AND purpose='RESET'",
      [user.id],
    );
    assert.ok(beforeVerify);
    assert.equal(beforeVerify.count, 0);
    await assert.rejects(
      service.verify(user.id, verificationCode === '999999' ? '888888' : '999999'),
    );
    const [attempt] = await db.query<Array<{ attempts: number }>>(
      "SELECT attempts FROM account_email_challenge WHERE user_id=$1 AND purpose='VERIFY'",
      [user.id],
    );
    assert.ok(attempt);
    assert.equal(attempt.attempts, 1);
    await service.verify(user.id, verificationCode);
    await assert.rejects(service.verify(user.id, verificationCode));
    await service.requestReset(user.email!);
    const [resetMail] = await db.query<Array<{ payload_ciphertext: string }>>(
      "SELECT o.payload_ciphertext FROM account_email_outbox o JOIN account_email_challenge c ON c.id=o.challenge_id WHERE c.user_id=$1 AND c.purpose='RESET'",
      [user.id],
    );
    assert.ok(resetMail);
    const resetCode = /: (\d{6})\n/.exec(
      (decryptAccountEmail(resetMail.payload_ciphertext, secret) as { text: string }).text,
    )?.[1];
    assert.ok(resetCode);
    const session = await db.getRepository(AuthSessionEntity).save({
      id: randomUUID(),
      userId: user.id,
      clientType: AuthClientType.MOBILE,
      refreshTokenHash: 'a'.repeat(64),
      lastRefreshedAt: new Date(),
      expiresAt: new Date(Date.now() + 3600000),
      revokedAt: null,
    });
    await service.confirmReset(user.username, resetCode, 'NewSyntheticPassword9!');
    assert.ok(
      (await db.getRepository(AuthSessionEntity).findOneByOrFail({ id: session.id })).revokedAt,
    );
    assert.equal(
      await verifyPassword(
        'NewSyntheticPassword9!',
        (await db.getRepository(UserEntity).findOneByOrFail({ id: user.id })).passwordHash,
      ),
      true,
    );
    await assert.rejects(
      service.confirmReset(user.username, resetCode, 'OtherSyntheticPassword9!'),
    );
    const actor: AuthenticatedUser = { ...user, roleAssignments: [] };
    const push = new MobilePushService(db, config),
      device = randomUUID(),
      installationSecret = 'b'.repeat(64);
    const input = {
      installationSecret,
      expoPushToken: 'ExpoPushToken[synthetic-test-token]',
      platform: 'ios' as const,
      language: 'vi' as const,
    };
    await assert.rejects(push.register(actor, session.id, device, input));
    await db.getRepository(AuthSessionEntity).update(session.id, { revokedAt: null });
    await push.register(actor, session.id, device, input);
    const [storedDevice] = await db.query<
      Array<{ token_ciphertext: string; installation_secret_hash: string }>
    >('SELECT token_ciphertext,installation_secret_hash FROM mobile_push_device WHERE id=$1', [
      device,
    ]);
    assert.ok(storedDevice);
    assert.equal(storedDevice.token_ciphertext.includes(input.expoPushToken), false);
    assert.notEqual(storedDevice.installation_secret_hash, installationSecret);
    await assert.rejects(
      push.register(actor, session.id, device, { ...input, installationSecret: 'c'.repeat(64) }),
    );
    await assert.rejects(push.remove({ ...actor, id: randomUUID() }, device, installationSecret));
    assert.equal((await push.settings(actor)).devices[0]?.active, true);
    await db.getRepository(AuthSessionEntity).update(session.id, { revokedAt: new Date() });
    assert.equal((await push.settings(actor)).devices[0]?.active, false);
    await push.remove(actor, device, installationSecret);
    const [policy] = await db.query<Array<{ effective_from: Date }>>(
      'SELECT effective_from FROM team_attendance_policy WHERE id=true',
    );
    assert.ok(policy);
    assert.ok(policy.effective_from instanceof Date);
    await assert.rejects(
      db.query('UPDATE app_user SET email=$2 WHERE id=$1', [user.id, 'UPPERCASE@example.test']),
    );
  } finally {
    await owned.dispose();
  }
});

test('email sender claims actual PostgreSQL rows, retries a rejection and marks acceptance without retaining credentials', async (t) => {
  const owned = createIsolatedTestDatabase(),
    db = owned.dataSource;
  const config = new ConfigService<BackendEnvironment, true>({
    NODE_ENV: 'test',
    AUTH_JWT_SECRET: 'synthetic-integration-delivery-secret',
    RESEND_API_KEY: 'synthetic-never-sent',
    RESEND_FROM_EMAIL: 'sender@example.test',
  });
  let attempts = 0;
  const keys: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    keys.push(new Headers(init.headers).get('Idempotency-Key')!);
    return ++attempts === 1
      ? new Response('{}', { status: 503 })
      : new Response(JSON.stringify({ id: 'synthetic-provider-id' }), { status: 200 });
  });
  try {
    await owned.initialize();
    const user = await db.getRepository(UserEntity).save({
      id: randomUUID(),
      username: randomUUID(),
      displayName: 'Synthetic Worker',
      passwordHash: await hashPassword('SyntheticPassword9!'),
      email: 'delivery@example.test',
      emailVerifiedAt: null,
      isActive: true,
      mustChangePassword: false,
    });
    const service = new AccountEmailService(db, config);
    await db.transaction((manager) =>
      service.queueWelcome(manager, user, 'SyntheticPassword9!', 'en'),
    );
    await service.flush();
    const [retry] = await db.query<
      Array<{ id: string; status: string; attempts: number; payload_ciphertext: string | null }>
    >('SELECT id,status,attempts,payload_ciphertext FROM account_email_outbox WHERE user_id=$1', [
      user.id,
    ]);
    assert.ok(retry);
    assert.equal(retry.status, 'PENDING');
    assert.equal(retry.attempts, 1);
    assert.ok(retry.payload_ciphertext);
    await db.query('UPDATE account_email_outbox SET next_attempt_at=now() WHERE id=$1', [retry.id]);
    await service.flush();
    const [sent] = await db.query<
      Array<{
        status: string;
        attempts: number;
        payload_ciphertext: string | null;
        sent_at: Date | null;
      }>
    >('SELECT status,attempts,payload_ciphertext,sent_at FROM account_email_outbox WHERE id=$1', [
      retry.id,
    ]);
    assert.ok(sent);
    assert.equal(sent.status, 'SENT');
    assert.equal(sent.attempts, 2);
    assert.equal(sent.payload_ciphertext, null);
    assert.ok(sent.sent_at);
    assert.deepEqual(keys, [`account-email/${retry.id}`, `account-email/${retry.id}`]);
  } finally {
    await owned.dispose();
  }
});
