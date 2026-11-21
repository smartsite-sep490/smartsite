import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '../src/index';
afterEach(() => vi.unstubAllGlobals());
it('reads scoped Worker history and exact time requests with encoded filters', async () => {
  const fetcher = vi.fn(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetcher);
  const client = new SmartSiteManagementClient('https://api.example.test');
  await client.myWorkerRequests('synthetic-token', 'site/one', {
    kind: 'CORRECTION',
    status: 'REJECTED',
    offset: 10,
    limit: 10,
  });
  await client.attendanceTimeRequests('synthetic-token', 'site/one', {
    kind: 'LEAVE',
    requestId: 'request-id',
    limit: 1,
  });
  const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
  expect(calls[0]![0]).toContain(
    '/sites/site%2Fone/my-requests?kind=CORRECTION&status=REJECTED&offset=10&limit=10',
  );
  expect(calls[1]![0]).toContain(
    '/sites/site%2Fone/attendance-time-requests?kind=LEAVE&requestId=request-id&limit=1',
  );
  expect(calls.every(([, init]) => init.method === 'GET')).toBe(true);
});
