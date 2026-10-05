import { afterEach, describe, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '../src/index';

afterEach(() => vi.unstubAllGlobals());

describe('notification API client', () => {
  it('uses authenticated personal APIs, encoded IDs and explicit filters', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ items: [], total: 0, unreadCount: 0 }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new SmartSiteManagementClient('https://api.example.test/');
    await client.listNotifications('synthetic-token', {
      readStatus: 'UNREAD',
      offset: 20,
      limit: 20,
    });
    await client.readNotification('synthetic-token', 'notification/1');
    await client.readAllNotifications('synthetic-token');
    await client.getShiftChangeRequest('synthetic-token', 'site/2', 'request/1');
    await client.getShiftSwapRequest('synthetic-token', 'site/2', 'request/1');
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map((c) => c[0])).toEqual([
      'https://api.example.test/api/v1/me/notifications?offset=20&limit=20&readStatus=UNREAD',
      'https://api.example.test/api/v1/me/notifications/notification%2F1/read',
      'https://api.example.test/api/v1/me/notifications/read-all',
      'https://api.example.test/api/v1/sites/site%2F2/shift-change-requests/request%2F1',
      'https://api.example.test/api/v1/sites/site%2F2/shift-swap-requests/request%2F1',
    ]);
    for (const [, init] of calls)
      expect(init.headers).toMatchObject({ Authorization: 'Bearer synthetic-token' });
    expect(calls[1]![1].method).toBe('PATCH');
    expect(calls[1]![1].body).toBeUndefined();
  });
});
