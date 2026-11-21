import 'reflect-metadata';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { BackendEnvironment } from '../src/config/environment.js';
import { AccountEmailService } from '../src/modules/auth/account-email.service.js';
import { encryptAccountEmail } from '../src/modules/auth/account-email-crypto.js';

const secret = 'synthetic-delivery-test-secret';
function fixture({ attempts = 0, claimable = true, valid = true } = {}) {
  const passwordHash = 'synthetic-password-hash';
  const row = {
    id: 'synthetic-outbox',
    user_id: 'synthetic-user',
    challenge_id: 'synthetic-challenge',
    recipient: 'worker@example.test',
    attempts,
    status: 'PENDING',
    payload_ciphertext: encryptAccountEmail(
      {
        subject: 'Synthetic welcome',
        text: 'Username: synthetic\nInitial password: SyntheticPassword9!',
        passwordVersion: createHash('sha256').update(passwordHash).digest('hex'),
      },
      secret,
    ) as string | null,
  };
  let currentReads = 0,
    completionWrites = 0;
  const source = {
    query: async (sql: string, args: unknown[] = []) => {
      if (sql.startsWith('SELECT id FROM account_email_outbox')) return [{ id: row.id }];
      if (sql.includes("SET status='SENDING'") && sql.includes('RETURNING')) {
        const claimed = claimable ? [{ ...row, status: 'SENDING', attempts: ++row.attempts }] : [];
        if (claimable) row.status = 'SENDING';
        // Match PostgresQueryRunner: UPDATE returns [rows, count]; a SELECT
        // (including a data-modifying CTE) returns rows directly.
        return /^\s*UPDATE\b/.test(sql) ? [claimed, claimed.length] : claimed;
      }
      if (sql.startsWith('SELECT u.email')) {
        currentReads++;
        return [{ email: row.recipient, password_hash: passwordHash, valid }];
      }
      completionWrites++;
      if (args[1] !== row.attempts || row.status !== 'SENDING') return [[], 0];
      if (sql.includes("SET status='SENT'")) {
        row.status = 'SENT';
        row.payload_ciphertext = null;
      } else if (sql.includes("SET status='CANCELLED'")) {
        row.status = 'CANCELLED';
        row.payload_ciphertext = null;
      } else if (sql.includes('SET status=CASE')) {
        row.status = row.attempts >= 5 ? 'FAILED' : 'PENDING';
      } else throw new Error('Unexpected delivery query');
      return [[], 1];
    },
  } as unknown as DataSource;
  const config = new ConfigService<BackendEnvironment, true>({
    NODE_ENV: 'test',
    AUTH_JWT_SECRET: secret,
    RESEND_API_KEY: 'synthetic-never-sent',
    RESEND_FROM_EMAIL: 'sender@example.test',
  });
  return {
    service: new AccountEmailService(source, config),
    row,
    reads: () => currentReads,
    writes: () => completionWrites,
  };
}

test('welcome delivery handles PostgreSQL claim results, submits credentials once and clears sent ciphertext', async (t) => {
  const f = fixture();
  const send = t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as { to: string[]; text: string };
    assert.deepEqual(body.to, ['worker@example.test']);
    assert.ok(body.text.includes('SyntheticPassword9!'));
    assert.equal(
      new Headers(init.headers).get('Idempotency-Key'),
      'account-email/synthetic-outbox',
    );
    return new Response(JSON.stringify({ id: 'synthetic-provider-id' }), { status: 200 });
  });
  await f.service.flush();
  assert.equal(send.mock.callCount(), 1);
  assert.equal(f.row.status, 'SENT');
  assert.equal(f.row.attempts, 1);
  assert.equal(f.row.payload_ciphertext, null);
});

test('a concurrently claimed message is left alone without sending or completion writes', async (t) => {
  const f = fixture({ claimable: false });
  const send = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Must not send');
  });
  await f.service.flush();
  assert.equal(send.mock.callCount(), 0);
  assert.equal(f.reads(), 0);
  assert.equal(f.writes(), 0);
});

test('provider rejection leaves the claimed message retryable instead of stuck sending', async (t) => {
  const f = fixture();
  const warn = t.mock.method(Logger.prototype, 'warn', () => {});
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 403 }));
  await f.service.flush();
  assert.equal(f.row.status, 'PENDING');
  assert.equal(f.row.attempts, 1);
  assert.ok(f.row.payload_ciphertext);
  assert.deepEqual(warn.mock.calls[0]?.arguments[0], {
    action: 'account_email.delivery_failed',
    outboxId: f.row.id,
    providerStatus: 403,
  });
});

test('delivery stops after five failed provider attempts', async (t) => {
  const f = fixture({ attempts: 4 });
  t.mock.method(Logger.prototype, 'warn', () => {});
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 503 }));
  await f.service.flush();
  assert.equal(f.row.status, 'FAILED');
  assert.equal(f.row.attempts, 5);
});

test('expired or consumed verification cancels delivery without leaking credentials', async (t) => {
  const f = fixture({ valid: false });
  const send = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Must not send');
  });
  await f.service.flush();
  assert.equal(send.mock.callCount(), 0);
  assert.equal(f.row.status, 'CANCELLED');
  assert.equal(f.row.payload_ciphertext, null);
});
