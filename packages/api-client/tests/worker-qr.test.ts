import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '../src/index';

afterEach(() => vi.unstubAllGlobals());

it('issues the Worker own code by direction and sends Security internal session for manual verification', async () => {
  const fetch = vi.fn(async () =>
    Response.json({ token: 'ABCD2345', expiresAt: '2030-01-01T00:05:00Z', direction: 'IN' }),
  );
  vi.stubGlobal('fetch', fetch);
  const client = new SmartSiteManagementClient('https://api.example.test');
  const signal = new AbortController().signal;
  await client.issueWorkerQr('worker-token', 'site/a', { direction: 'IN' }, { signal });
  expect(fetch.mock.calls[0]).toMatchObject([
    'https://api.example.test/api/v1/sites/site%2Fa/worker-qr',
    {
      method: 'POST',
      body: JSON.stringify({ direction: 'IN' }),
      signal,
    },
  ]);
  const command = {
    token: 'ABCD2345',
    direction: 'IN' as const,
    requestId: 'synthetic-request',
    fallbackSessionId: 'internal-officer-session',
  };
  await client.verifyWorkerQr('guard-token', 'site/a', 'gate/a', command);
  expect(fetch.mock.calls[1]).toMatchObject([
    'https://api.example.test/api/v1/sites/site%2Fa/gates/gate%2Fa/qr-verifications',
    {
      method: 'POST',
      body: JSON.stringify(command),
    },
  ]);
});

it('keeps the legacy issue-by-session call compatible', async () => {
  const fetch = vi.fn(async () => Response.json({ token: 'ABCD2345' }));
  vi.stubGlobal('fetch', fetch);
  await new SmartSiteManagementClient('https://api.example.test').issueWorkerQr(
    'token',
    'site',
    'legacy-session',
  );
  expect(fetch.mock.calls[0]).toMatchObject([
    expect.any(String),
    { body: JSON.stringify({ fallbackSessionId: 'legacy-session' }) },
  ]);
});
