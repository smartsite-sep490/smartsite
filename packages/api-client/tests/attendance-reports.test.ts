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

it('exports all report filters with authentication and supports cancellation', async () => {
  const controller = new AbortController();
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer synthetic-token' });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    return new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  const client = new SmartSiteManagementClient('https://api.example.test');
  const result = client.attendanceExport(
    'synthetic-token',
    'site/1',
    {
      fromDate: '2026-10-12',
      toDate: '2026-10-18',
      timezone: 'Asia/Ho_Chi_Minh',
      search: 'Worker & 01',
      contractorId: 'contractor/1',
      workerId: 'worker/1',
      shiftId: 'shift/1',
      todayStatus: 'ABSENT',
    },
    { signal: controller.signal },
  );
  const url = new URL(fetchMock.mock.calls[0]![0]);
  expect(url.pathname).toBe('/api/v1/sites/site%2F1/attendance-export');
  expect(Object.fromEntries(url.searchParams)).toEqual({
    fromDate: '2026-10-12',
    toDate: '2026-10-18',
    timezone: 'Asia/Ho_Chi_Minh',
    search: 'Worker & 01',
    contractorId: 'contractor/1',
    workerId: 'worker/1',
    shiftId: 'shift/1',
    todayStatus: 'ABSENT',
  });
  controller.abort();
  await expect(result).rejects.toMatchObject({ code: 'cancelled' });
});
