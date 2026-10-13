import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '../src/index';

afterEach(() => vi.unstubAllGlobals());
it('loads representative Contractor options and creates a linked Worker account through scoped endpoints', async () => {
  const fetch = vi.fn(
    async () => new Response(JSON.stringify({ contractors: [] }), { status: 200 }),
  );
  vi.stubGlobal('fetch', fetch);
  const client = new SmartSiteManagementClient('https://api.example.test');
  await client.contractorWorkerAccountOptions('representative-token', 'site/a');
  const input = {
    siteId: 'site/a',
    displayName: 'Synthetic Worker',
    username: 'worker001',
  };
  await client.createContractorWorkerAccount('representative-token', 'contractor/a', input);
  expect(fetch.mock.calls[0]).toEqual([
    'https://api.example.test/api/v1/sites/site%2Fa/contractor-worker-account-options',
    expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Bearer representative-token' }),
    }),
  ]);
  expect(fetch.mock.calls[1]).toEqual([
    'https://api.example.test/api/v1/contractors/contractor%2Fa/worker-accounts',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify(input),
      headers: expect.objectContaining({ Authorization: 'Bearer representative-token' }),
    }),
  ]);
});

it('updates a worker through the Contractor and Site scoped route with the expected profile', async () => {
  const fetch = vi.fn(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  const client = new SmartSiteManagementClient('https://api.example.test');
  const snapshot = { externalId: 'W001', displayName: 'Synthetic Worker', isActive: true };
  const input = { ...snapshot, isActive: false, expectedSnapshot: snapshot };
  await client.updateContractorWorker(
    'representative-token',
    'site/a',
    'contractor/a',
    'worker/a',
    input,
  );
  expect(fetch).toHaveBeenCalledWith(
    'https://api.example.test/api/v1/sites/site%2Fa/contractors/contractor%2Fa/workers/worker%2Fa',
    expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify(input),
      headers: expect.objectContaining({ Authorization: 'Bearer representative-token' }),
    }),
  );
});
