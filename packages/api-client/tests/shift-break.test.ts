import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '../src/index';

afterEach(() => vi.unstubAllGlobals());
it('sends and reads the configured break through the scoped shift API', async () => {
  const input = {
    name: 'Day',
    startsAt: '2026-10-01T08:00:00+07:00',
    endsAt: '2026-10-01T17:00:00+07:00',
    timezone: 'Asia/Ho_Chi_Minh',
    breakStartsAt: '2026-10-01T12:00:00+07:00',
    breakEndsAt: '2026-10-01T13:00:00+07:00',
  };
  const fetchMock = vi.fn(
    async () => new Response(JSON.stringify({ id: 'shift-1', ...input }), { status: 201 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  const result = await new SmartSiteManagementClient('https://synthetic.test').createShift(
    'synthetic-token',
    'site/1',
    input,
  );
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toContain('/sites/site%2F1/shifts');
  expect(JSON.parse(init.body as string)).toEqual(input);
  expect(result.breakStartsAt).toBe(input.breakStartsAt);
});
