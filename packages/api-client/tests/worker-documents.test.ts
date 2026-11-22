import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '../src/index';
afterEach(() => vi.unstubAllGlobals());

it('requests AI analysis for the stored document through a scoped command without an upload', async () => {
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
    async () => new Response(null, { status: 204 }),
  );
  vi.stubGlobal('fetch', fetch);
  const client = new SmartSiteManagementClient('https://api.example.test');
  await client.analyzeWorkerDocument('token', 'site/a', 'worker/a', 'doc/a');
  const [url, init] = fetch.mock.calls[0]!;
  expect(url).toBe(
    'https://api.example.test/api/v1/sites/site%2Fa/workers/worker%2Fa/documents/doc%2Fa/ai-analysis',
  );
  expect(init.method).toBe('POST');
  expect(init.headers).toMatchObject({ Authorization: 'Bearer token' });
  expect(init.body).toBeUndefined();
});

it('preflights certificate dates through authenticated scoped multipart', async () => {
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () =>
    Response.json({}),
  );
  vi.stubGlobal('fetch', fetch);
  const client = new SmartSiteManagementClient('https://api.example.test');
  const file = new File(['synthetic'], 'card.pdf', { type: 'application/pdf' });
  await client.checkWorkerDocumentDates('token', 'site/a', 'worker/a', 'SAFETY_CARD', file, {
    submittedExpiresOn: '2030-10-27',
  });
  const [url, init] = fetch.mock.calls[0]!;
  expect(url).toContain('/sites/site%2Fa/workers/worker%2Fa/documents/SAFETY_CARD/check');
  expect(init.method).toBe('POST');
  expect(init.headers).toMatchObject({ Authorization: 'Bearer token' });
  expect(init.headers).not.toHaveProperty('Content-Type');
  const form = init.body as FormData;
  expect(form.get('submittedExpiresOn')).toBe('2030-10-27');
  expect(form.get('file')).toBeInstanceOf(File);
});
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
it('submits a complete versioned bundle using one authenticated multipart request', async () => {
  const fetch = vi.fn(async () =>
    Response.json({ requestId: 'request', version: 2, documentIds: ['doc'] }),
  );
  vi.stubGlobal('fetch', fetch);
  const client = new SmartSiteManagementClient('https://api.example.test');
  const file = new File(['synthetic'], 'health.pdf', { type: 'application/pdf' });
  const input = {
    requestId: 'request',
    expectedVersion: 1,
    safetyCardRequired: false,
    documents: { HEALTH_CERTIFICATE: { submittedIssuedOn: '2026-11-01' } },
  };
  await client.submitWorkerDocuments('token', 'site/a', 'worker/a', input, {
    HEALTH_CERTIFICATE: file,
  });
  const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe(
    'https://api.example.test/api/v1/sites/site%2Fa/workers/worker%2Fa/document-submissions',
  );
  expect(init.headers).toMatchObject({ Authorization: 'Bearer token' });
  expect(init.headers).not.toHaveProperty('Content-Type');
  const form = init.body as FormData;
  expect(JSON.parse(String(form.get('metadata')))).toEqual(input);
  expect(form.get('HEALTH_CERTIFICATE')).toBeInstanceOf(File);
});
