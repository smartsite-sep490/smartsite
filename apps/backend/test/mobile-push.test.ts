import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataSource } from 'typeorm';
import {
  MobilePushService,
  pushInstallationHash,
  pushInstallationMatches,
} from '../src/modules/workforce/notifications/mobile-push.service.js';
import { sealJson } from '../src/common/secure-envelope.js';
import { createTestConfig } from './support/config.js';
import { validateEnvironment } from '../src/config/environment.js';

test('push is opt-in, validates provider settings and binds installations to their secret', () => {
  assert.equal(validateEnvironment({ NODE_ENV: 'test' }).EXPO_PUSH_ENABLED, false);
  assert.equal(
    validateEnvironment({ NODE_ENV: 'test', EXPO_PUSH_ENABLED: 'true' }).EXPO_PUSH_ENABLED,
    true,
  );
  assert.throws(() => validateEnvironment({ NODE_ENV: 'test', EXPO_PUSH_ENABLED: 'yes' }));
  assert.throws(() =>
    validateEnvironment({ NODE_ENV: 'test', EXPO_ACCESS_TOKEN: 'invalid token' }),
  );
  const hash = pushInstallationHash('installation', 'synthetic-secret');
  assert.equal(pushInstallationMatches('installation', 'synthetic-secret', hash), true);
  assert.equal(pushInstallationMatches('another', 'synthetic-secret', hash), false);
  assert.equal(pushInstallationMatches('installation', 'other-secret', hash), false);
  assert.equal(pushInstallationMatches('installation', 'synthetic-secret', 'broken'), false);
});

test('push sends generic content and treats a rejected device token as revoked without exposing business data', async () => {
  const config = createTestConfig({ EXPO_PUSH_ENABLED: 'true' }),
    statements: Array<{ sql: string; args?: unknown[] }> = [];
  const row = { device_id: 'device', notification_id: 'notification', attempts: 1 };
  const source = {
    query: async (sql: string, args?: unknown[]) => {
      statements.push({ sql, args });
      if (sql.includes("UPDATE mobile_push_delivery p SET status='SENDING'"))
        return sql.trimStart().startsWith('UPDATE') ? [[row], 1] : [row];
      if (sql.startsWith('SELECT d.token_hash'))
        return [
          {
            token_hash: 'synthetic-token-hash',
            token_ciphertext: sealJson(
              'ExpoPushToken[synthetic-token]',
              config.getOrThrow('AUTH_JWT_SECRET', { infer: true }),
              'mobile-push-token-v1',
            ),
            language: 'vi',
          },
        ];
      return [];
    },
  } as unknown as DataSource;
  const originalFetch = globalThis.fetch;
  const sent: unknown[] = [];
  globalThis.fetch = async (_input, init) => {
    sent.push(JSON.parse(String(init?.body)));
    return new Response(
      JSON.stringify({ data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }] }),
      { status: 200 },
    );
  };
  try {
    await new MobilePushService(source, config).flush();
    assert.equal(sent.length, 1);
    const message = (sent[0] as Array<Record<string, unknown>>)[0]!;
    assert.deepEqual(message.data, {
      kind: 'smartsite-notification',
      notificationId: 'notification',
    });
    assert.deepEqual(Object.keys(message).sort(), [
      'body',
      'channelId',
      'data',
      'sound',
      'title',
      'to',
    ]);
    assert.equal(message.body, 'Bạn có thông báo mới. Mở ứng dụng để xem.');
    const revoked = statements.find((item) =>
      item.sql.startsWith('UPDATE mobile_push_device SET revoked_at'),
    );
    assert.deepEqual(revoked?.args, ['device', 'synthetic-token-hash']);
    const finished = statements.find((item) =>
      item.sql.startsWith('UPDATE mobile_push_delivery SET status=$4'),
    );
    assert.equal(finished?.args?.[3], 'FAILED');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
