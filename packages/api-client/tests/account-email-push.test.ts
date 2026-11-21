import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '../src/index';
afterEach(() => vi.unstubAllGlobals());
it('keeps password recovery public and account email/device changes authenticated', async () => {
  const request = vi.fn(
    async () => new Response(JSON.stringify({ accepted: true }), { status: 200 }),
  );
  vi.stubGlobal('fetch', request);
  const client = new SmartSiteManagementClient('https://api.example.test');
  await client.requestPasswordReset({ identifier: 'synthetic@example.test', language: 'vi' });
  await client.confirmPasswordReset({
    identifier: 'synthetic@example.test',
    code: '123456',
    password: 'SyntheticPassword9!',
  });
  await client.setAccountEmail('synthetic-token', {
    email: 'synthetic@example.test',
    currentPassword: 'SyntheticPassword9!',
    language: 'vi',
  });
  await client.resendEmailVerification('synthetic-token', 'vi');
  await client.verifyAccountEmail('synthetic-token', { code: '123456' });
  await client.mobilePushSettings('synthetic-token');
  await client.registerMobilePush('synthetic-token', 'device/1', {
    installationSecret: 'a'.repeat(64),
    expoPushToken: 'ExpoPushToken[synthetic-token]',
    platform: 'ios',
    language: 'vi',
  });
  await client.removeMobilePush('synthetic-token', 'device/1', {
    installationSecret: 'a'.repeat(64),
  });
  const calls = request.mock.calls as unknown as [string, RequestInit][];
  expect(calls.map(([url, init]) => [new URL(url).pathname, init.method])).toEqual([
    ['/api/v1/auth/password-reset/request', 'POST'],
    ['/api/v1/auth/password-reset/confirm', 'POST'],
    ['/api/v1/auth/email', 'PUT'],
    ['/api/v1/auth/email/verification', 'POST'],
    ['/api/v1/auth/email/verify', 'POST'],
    ['/api/v1/me/push-devices', 'GET'],
    ['/api/v1/me/push-devices/device%2F1', 'PUT'],
    ['/api/v1/me/push-devices/device%2F1', 'DELETE'],
  ]);
  for (const [, init] of calls.slice(0, 2))
    expect(init.headers).not.toHaveProperty('Authorization');
  for (const [, init] of calls.slice(2))
    expect(init.headers).toMatchObject({ Authorization: 'Bearer synthetic-token' });
  expect(JSON.parse(calls[7]![1].body as string)).toEqual({ installationSecret: 'a'.repeat(64) });
  expect(JSON.parse(calls[3]![1].body as string)).toEqual({ language: 'vi' });
});
