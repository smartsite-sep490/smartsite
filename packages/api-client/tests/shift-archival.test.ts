import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '../src/index';

afterEach(() => vi.unstubAllGlobals());
it('archives through an encoded scoped POST route and returns the archive timestamp', async () => {
  const response = { id: 'shift/1', archivedAt: '2030-01-01T00:00:00Z' };
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(response), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  expect(
    await new SmartSiteManagementClient('https://synthetic.test').archiveShift(
      'synthetic-token',
      'site/1',
      'shift/1',
    ),
  ).toEqual(response);
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toContain('/sites/site%2F1/shifts/shift%2F1/archive');
  expect(init.method).toBe('POST');
});
