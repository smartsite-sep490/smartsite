import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '../src/index';
afterEach(() => vi.unstubAllGlobals());
it('attendance report queries encode filters/booleans, omit undefined fields and authenticate both reads', async () => {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ items: [], total: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  const client = new SmartSiteManagementClient('https://api.example.test');
  await client.attendanceSummary('synthetic-token', 'site/1', {
    fromDate: '2026-10-12',
    toDate: '2026-10-18',
    timezone: 'Asia/Ho_Chi_Minh',
    search: 'Worker & 01',
    shiftId: undefined,
  });
  await client.attendanceWorkers('synthetic-token', 'site/1', {
    fromDate: '2026-10-12',
    toDate: '2026-10-18',
    workerId: 'worker/1',
    includeDaily: false,
    limit: 20,
    offset: 20,
    todayStatus: 'ABSENT',
  });
  const calls = fetchMock.mock.calls as unknown as [string, RequestInit][];
  expect(calls[0]![0]).toContain('/api/v1/sites/site%2F1/attendance-summary?');
  const first = new URL(calls[0]![0]);
  expect(first.searchParams.get('search')).toBe('Worker & 01');
  expect(first.searchParams.has('shiftId')).toBe(false);
  const second = new URL(calls[1]![0]);
  expect(second.pathname).toContain('/attendance-workers');
  expect(second.searchParams.get('includeDaily')).toBe('false');
  expect(second.searchParams.get('workerId')).toBe('worker/1');
  for (const [, init] of calls) {
    expect(init.method).toBe('GET');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer synthetic-token' });
  }
});
