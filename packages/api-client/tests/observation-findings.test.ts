import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '../src/index';
afterEach(() => vi.unstubAllGlobals());
it('loads same-observation findings through the authorized cancellable transport', async () => {
  const page = { subject: null, items: [], total: 0 };
  const fetcher = vi.fn(async () => new Response(JSON.stringify(page)));
  vi.stubGlobal('fetch', fetcher);
  const controller = new AbortController();
  const client = new SmartSiteManagementClient('https://api.example.test');
  expect(
    await client.listSafetyObservationFindings(
      'synthetic',
      'site/a',
      'alert/b',
      'event/c',
      { offset: 20, limit: 20 },
      { signal: controller.signal },
    ),
  ).toEqual(page);
  expect(fetcher.mock.calls[0]?.[0]).toBe(
    'https://api.example.test/api/v1/sites/site%2Fa/safety-alerts/alert%2Fb/detections/event%2Fc/findings?offset=20&limit=20',
  );
});
