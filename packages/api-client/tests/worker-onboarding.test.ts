import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '../src/index';

afterEach(() => vi.unstubAllGlobals());

it('keeps intake drafts, batch creation, batch review and personal identity on scoped routes', async () => {
  const fetch = vi.fn<(url: string, options: RequestInit) => Promise<Response>>(
    async () => new Response('{}'),
  );
  vi.stubGlobal('fetch', fetch);
  const client = new SmartSiteManagementClient('https://api.example.test');
  const items = [{ id: 'row', version: 2 }];
  const draft = {
    expectedVersion: 0,
    displayName: 'Synthetic Worker',
    username: '',
    email: '',
    safetyCardRequired: null,
    documents: { HEALTH_CERTIFICATE: {} },
  };
  const photo = new File(['sample'], 'sample.png', { type: 'image/png' });
  await client.saveWorkerOnboardingDraft('token', 'site/a', 'contractor/a', 'row/a', draft, {
    HEALTH_CERTIFICATE: photo,
  });
  await client.provisionWorkerOnboardingBatch('token', 'site/a', 'contractor/a', items);
  await client.sendWorkerDocumentsBatch('token', 'site/a', 'contractor/a', items);
  await client.updateMyWorkerIdentity(
    'token',
    'site/a',
    {
      expectedVersion: 0,
      nationalId: '000000000001',
      phoneNumber: '0900000000',
      gender: 'OTHER',
      address: 'Synthetic address',
    },
    { FRONT: photo },
  );
  expect(fetch.mock.calls.map(([url, options]) => [new URL(url).pathname, options.method])).toEqual(
    [
      ['/api/v1/sites/site%2Fa/contractors/contractor%2Fa/worker-onboarding-drafts/row%2Fa', 'PUT'],
      [
        '/api/v1/sites/site%2Fa/contractors/contractor%2Fa/worker-onboarding-drafts/provision',
        'POST',
      ],
      [
        '/api/v1/sites/site%2Fa/contractors/contractor%2Fa/worker-document-submissions/batch',
        'POST',
      ],
      ['/api/v1/sites/site%2Fa/workers/me/identity', 'PUT'],
    ],
  );
  const body = fetch.mock.calls[0]?.[1].body as FormData;
  expect(JSON.parse(body.get('metadata') as string)).toEqual(draft);
  expect(body.get('HEALTH_CERTIFICATE')).toBeInstanceOf(File);
  expect(fetch.mock.calls[2]?.[1].body).toBe(JSON.stringify({ items }));
});
it('loads representative Contractor options through the scoped endpoint', async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ contractors: [] })));
  vi.stubGlobal('fetch', fetch);
  const client = new SmartSiteManagementClient('https://api.example.test');
  await client.contractorWorkerAccountOptions('representative-token', 'site/a');
  expect(fetch).toHaveBeenCalledWith(
    'https://api.example.test/api/v1/sites/site%2Fa/contractor-worker-account-options',
    expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Bearer representative-token' }),
    }),
  );
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
