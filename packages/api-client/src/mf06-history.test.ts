import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from './management';

const site = '11111111-1111-4111-8111-111111111111',
  id = '22222222-2222-4222-8222-222222222222',
  other = '33333333-3333-4333-8333-333333333333';
const client = new SmartSiteManagementClient('https://backend.example');
const record = () => ({
  assessmentId: id,
  requestId: id,
  siteId: site,
  eventId: other,
  cameraId: other,
  zoneId: other,
  capturedAt: '2026-11-04T00:00:00Z',
  assessedAt: '2026-11-04T00:00:01Z',
  purpose: 'INITIAL_OBSERVATION_ASSESSMENT',
  outcome: 'UNAVAILABLE',
  reasonCode: 'IDENTITY_UNAVAILABLE',
  evaluatorVersion: 'v1',
  provenance: 'UNAVAILABLE',
  frameDelivery: {
    frameId: other,
    sequenceNumber: '18446744073709551615',
    partCount: 2,
    receivedParts: 1,
    status: 'PARTIAL',
  },
});
const status = () => ({
  requestId: id,
  siteId: site,
  eventId: other,
  cameraId: other,
  zoneId: other,
  capturedAt: '2026-11-04T00:00:00Z',
  requestedAt: '2026-11-04T00:00:01Z',
  purpose: 'INITIAL_OBSERVATION_ASSESSMENT',
  jobStatus: 'NOT_QUEUED',
  attemptCount: null,
  deadlineAt: null,
  deadlinePassed: false,
  assessmentId: null,
});
const json = (v: unknown) =>
  new Response(JSON.stringify(v), { headers: { 'Content-Type': 'application/json' } });
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('reads scoped assessment pages with exact uint64 and private bounded transport', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(json({ items: [record()], offset: 20, limit: 20, total: 21 }));
  vi.stubGlobal('fetch', fetcher);
  const result = await client.listMf06Assessments('secret', site, { offset: 20, limit: 20 });
  expect(result.items[0]?.frameDelivery?.sequenceNumber).toBe('18446744073709551615');
  expect(fetcher).toHaveBeenCalledOnce();
  const [url, options] = fetcher.mock.calls[0]!;
  expect(url).toBe(
    `https://backend.example/api/v1/sites/${site}/mf06-assessments?offset=20&limit=20`,
  );
  expect(options).toMatchObject({
    cache: 'no-store',
    redirect: 'error',
    headers: { Authorization: 'Bearer secret' },
  });
});
it.each(['site', 'paging', 'sequence', 'extra'] as const)(
  'rejects invalid assessment page %s',
  async (fault) => {
    const value = { items: [record()], offset: 0, limit: 20, total: 1 };
    if (fault === 'site') value.items[0]!.siteId = other;
    if (fault === 'paging') value.offset = 20;
    if (fault === 'sequence') value.items[0]!.frameDelivery.sequenceNumber = '18446744073709551616';
    if (fault === 'extra') Object.assign(value.items[0]!, { workerId: other });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(value)));
    await expect(client.listMf06Assessments('secret', site)).rejects.toMatchObject({
      code: 'invalid-response',
    });
  },
);
it('binds assessment detail and request status detail to requested IDs', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(json(record()))
    .mockResolvedValueOnce(json({ ...record(), assessmentId: other }))
    .mockResolvedValueOnce(json(status()))
    .mockResolvedValueOnce(json({ ...status(), requestId: other }));
  vi.stubGlobal('fetch', fetcher);
  expect((await client.getMf06Assessment('secret', site, id)).assessmentId).toBe(id);
  await expect(client.getMf06Assessment('secret', site, id)).rejects.toMatchObject({
    code: 'invalid-response',
  });
  expect((await client.getMf06RequestStatus('secret', site, id)).jobStatus).toBe('NOT_QUEUED');
  await expect(client.getMf06RequestStatus('secret', site, id)).rejects.toMatchObject({
    code: 'invalid-response',
  });
});
it('validates request status page Site and offset', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(json({ items: [status()], total: 1, offset: 0, limit: 20 }))
    .mockResolvedValueOnce(
      json({ items: [{ ...status(), siteId: other }], total: 1, offset: 0, limit: 20 }),
    );
  vi.stubGlobal('fetch', fetcher);
  expect((await client.listMf06RequestStatuses('secret', site)).items).toHaveLength(1);
  await expect(client.listMf06RequestStatuses('secret', site)).rejects.toMatchObject({
    code: 'invalid-response',
  });
});
it('uses exact frame request/event binding and accepts only bounded JPEG', async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(new Uint8Array([255, 216, 255, 217]), {
      headers: { 'Content-Type': 'image/jpeg' },
    }),
  );
  vi.stubGlobal('fetch', fetcher);
  expect((await client.getMf06AssessmentFrame('secret', site, id, id, other)).size).toBe(4);
  expect(fetcher.mock.calls[0]![0]).toBe(
    `https://backend.example/api/v1/sites/${site}/mf06-assessments/${id}/frame?requestId=${id}&eventId=${other}`,
  );
  expect(fetcher.mock.calls[0]![1]).toMatchObject({ cache: 'no-store', redirect: 'error' });
});
it.each(['type', 'size', 'signature'] as const)('rejects bad frame %s', async (fault) => {
  const bytes =
    fault === 'size'
      ? new Uint8Array(1048577)
      : fault === 'signature'
        ? new Uint8Array([0, 1, 2])
        : new Uint8Array([255, 216, 255, 217]);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(bytes, {
        headers: { 'Content-Type': fault === 'type' ? 'image/png' : 'image/jpeg' },
      }),
    ),
  );
  await expect(client.getMf06AssessmentFrame('secret', site, id, id, other)).rejects.toMatchObject({
    code: 'invalid-response',
  });
});
it('aborts stalled frame body on deadline and cancels its stream', async () => {
  const cancel = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(new ReadableStream({ cancel }), { headers: { 'Content-Type': 'image/jpeg' } }),
      ),
  );
  await expect(
    client.getMf06AssessmentFrame('secret', site, id, id, other, { timeoutMs: 20 }),
  ).rejects.toMatchObject({ code: 'timeout' });
  expect(cancel).toHaveBeenCalledOnce();
});
it('cancels a pending frame body when the caller scope ends', async () => {
  const cancel = vi.fn(),
    controller = new AbortController();
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(new ReadableStream({ cancel }), { headers: { 'Content-Type': 'image/jpeg' } }),
      ),
  );
  const pending = client.getMf06AssessmentFrame('secret', site, id, id, other, {
    signal: controller.signal,
  });
  const checked = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  controller.abort();
  await checked;
  expect(cancel).toHaveBeenCalledOnce();
});
it('bounds JSON history before accepting oversized metadata', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        json({ items: [], total: 0, offset: 0, limit: 20, padding: 'x'.repeat(262145) }),
      ),
  );
  await expect(client.listMf06Assessments('secret', site)).rejects.toMatchObject({
    code: 'invalid-response',
  });
});
it('retains the Backend disabled/denied status without inventing an empty page', async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'SERVICE_UNAVAILABLE', message: 'Unavailable' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    .mockResolvedValueOnce(
      new Response('{}', { status: 403, headers: { 'Content-Type': 'application/json' } }),
    );
  vi.stubGlobal('fetch', fetcher);
  await expect(client.listMf06Assessments('secret', site)).rejects.toMatchObject({ status: 503 });
  await expect(client.listMf06RequestStatuses('secret', site)).rejects.toMatchObject({
    status: 403,
  });
});
