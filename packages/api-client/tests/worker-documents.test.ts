import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '../src/index';
afterEach(() => vi.unstubAllGlobals());
it('sends document search and pending filters to the Backend before pagination', async () => {
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () =>
    Response.json({ items: [], total: 0 }),
  );
  vi.stubGlobal('fetch', fetch);
  const client = new SmartSiteManagementClient('https://api.example.test');
  await client.listWorkerCompliance('token', 'site', {
    offset: 20,
    limit: 20,
    search: 'Worker 21',
    pendingOnly: true,
    submissionStatus: 'PENDING_REVIEW',
    needsSupplement: true,
  });
  const url = new URL(fetch.mock.calls[0]![0]);
  expect(Object.fromEntries(url.searchParams)).toEqual({
    offset: '20',
    limit: '20',
    search: 'Worker 21',
    pendingOnly: 'true',
    submissionStatus: 'PENDING_REVIEW',
    needsSupplement: 'true',
  });
});
it('uploads native document and identity images through authenticated multipart without a JSON content type', async () => {
  class NativeForm {
    parts: [string, unknown][] = [];
    append(name: string, value: unknown) {
      this.parts.push([name, value]);
    }
  }
  vi.stubGlobal('FormData', NativeForm);
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () =>
    Response.json({}),
  );
  vi.stubGlobal('fetch', fetch);
  const client = new SmartSiteManagementClient('https://api.example.test');
  const file = { uri: 'file:///synthetic.jpg', name: 'synthetic.jpg', type: 'image/jpeg' };
  await client.checkDocumentImageQuality('token', 'site/a', 'contractor/a', file);
  await client.uploadWorkerIdentityImage('token', 'site/a', 'worker/a', 'FRONT', file);
  await client.uploadWorkerDocument('token', 'site/a', 'worker/a', 'SAFETY_CARD', file);
  for (const [, init] of fetch.mock.calls) {
    expect(init.headers).toMatchObject({ Authorization: 'Bearer token' });
    expect(init.headers).not.toHaveProperty('Content-Type');
    expect((init.body as unknown as NativeForm).parts).toEqual([['file', file]]);
  }
  expect(fetch.mock.calls[0]![0]).toContain(
    '/sites/site%2Fa/contractors/contractor%2Fa/document-image-quality',
  );
  expect(fetch.mock.calls[1]![0]).toContain('/workers/worker%2Fa/identity-images/FRONT');
});
it('keeps review dates and the expected document version in the Site and Worker scoped command', async () => {
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () =>
    Response.json({}),
  );
  vi.stubGlobal('fetch', fetch);
  const client = new SmartSiteManagementClient('https://api.example.test');
  const input = {
    expectedVersion: 4,
    approve: true,
    issuedOn: '2026-10-17',
    expiresOn: '2028-10-17',
    reviewNote: 'Synthetic review',
  };
  await client.reviewWorkerDocument('token', 'site/a', 'worker/a', 'doc/a', input);
  expect(fetch.mock.calls[0]![0]).toBe(
    'https://api.example.test/api/v1/sites/site%2Fa/workers/worker%2Fa/documents/doc%2Fa/reviews',
  );
  expect(fetch.mock.calls[0]![1].body).toBe(JSON.stringify(input));
});
it('sends an optional manual expiry with the file and keeps versioned corrections separate from approval', async () => {
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () =>
    Response.json({}),
  );
  vi.stubGlobal('fetch', fetch);
  const client = new SmartSiteManagementClient('https://api.example.test');
  await client.uploadWorkerDocument(
    'token',
    'site',
    'worker',
    'HEALTH_CERTIFICATE',
    new File(['synthetic'], 'sample.pdf', { type: 'application/pdf' }),
    { submittedIssuedOn: '2026-10-18' },
  );
  const form = fetch.mock.calls[0]![1].body as FormData;
  expect(form.get('submittedIssuedOn')).toBe('2026-10-18');
  expect(form.get('submittedExpiresOn')).toBeNull();
  expect(form.get('file')).toBeInstanceOf(File);
  const input = { expectedVersion: 3, submittedExpiresOn: null };
  await client.updateWorkerDocumentExpiry('token', 'site/a', 'worker/a', 'doc/a', input);
  expect(fetch.mock.calls[1]![0]).toContain(
    '/sites/site%2Fa/workers/worker%2Fa/documents/doc%2Fa/submitted-expiry',
  );
  expect(fetch.mock.calls[1]![1].method).toBe('PATCH');
  expect(fetch.mock.calls[1]![1].body).toBe(JSON.stringify(input));
});
it('loads protected PDF originals using bearer authentication', async () => {
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
    async () =>
      new Response('%PDF-1.7\nsynthetic\n%%EOF', {
        headers: { 'Content-Type': 'application/pdf' },
      }),
  );
  vi.stubGlobal('fetch', fetch);
  const client = new SmartSiteManagementClient('https://api.example.test');
  expect((await client.workerDocumentFile('token', 'site', 'worker', 'document')).type).toBe(
    'application/pdf',
  );
  expect(fetch.mock.calls[0]![1].headers).toMatchObject({ Authorization: 'Bearer token' });
});
