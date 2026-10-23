import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '../src/index';
afterEach(() => vi.unstubAllGlobals());
it('carries the exact Site filter on list and both bulk commands, including explicit empty input', async () => {
  const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  const client = new SmartSiteManagementClient('https://api.example.test');
  for (const siteId of ['site/a', '']) {
    await client.listNotifications('synthetic', { siteId });
    await client.readAllNotifications('synthetic', siteId);
    await client.deleteReadNotifications('synthetic', siteId);
  }
  expect(fetchMock.mock.calls.map((call) => (call as unknown[])[0])).toEqual([
    'https://api.example.test/api/v1/me/notifications?siteId=site%2Fa',
    'https://api.example.test/api/v1/me/notifications/read-all?siteId=site%2Fa',
    'https://api.example.test/api/v1/me/notifications/read?siteId=site%2Fa',
    'https://api.example.test/api/v1/me/notifications?siteId=',
    'https://api.example.test/api/v1/me/notifications/read-all?siteId=',
    'https://api.example.test/api/v1/me/notifications/read?siteId=',
  ]);
});
