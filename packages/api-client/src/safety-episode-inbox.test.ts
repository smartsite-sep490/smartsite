import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from './management';
const id = '11111111-1111-4111-8111-111111111111',
  other = '22222222-2222-4222-8222-222222222222';
const time = '2026-11-02T03:00:00.000Z';
const page = () => ({
  items: [
    {
      id,
      episode: {
        id: other,
        siteId: id,
        cameraId: other,
        subject: { kind: 'TRACKED', segmentId: other, scopeSha256: 'a'.repeat(64) },
        configurationBundleId: null,
        firstObservedAt: time,
        lastObservedAt: time,
        contentRevision: 2,
        collectionState: 'COLLECTING',
        findingCount: 2,
      },
      seenRevision: 1,
      unread: true,
      firstDeliveredAt: time,
      updatedAt: time,
    },
  ],
  total: 1,
  unreadCount: 1,
});
afterEach(() => vi.unstubAllGlobals());
it('validates scoped inbox JSON with private bounded transport and snapshots options before await', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json(page()));
  vi.stubGlobal('fetch', fetcher);
  const client = new SmartSiteManagementClient('https://example.test');
  const options = { siteId: id };
  const pending = client.listSafetyEpisodeInbox('token', options);
  options.siteId = other;
  const result = await pending;
  options.siteId = id;
  expect(result.items[0]?.episode.subject.kind).toBe('TRACKED');
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store', redirect: 'error' });
  vi.stubGlobal('fetch', async () =>
    Response.json({
      ...page(),
      items: [{ ...page().items[0], episode: { ...page().items[0]!.episode, siteId: other } }],
    }),
  );
  await expect(client.listSafetyEpisodeInbox('token', options)).rejects.toMatchObject({
    code: 'invalid-response',
  });
});
it('rejects invalid request options before fetch, inconsistent counters and oversized success bodies', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ ...page(), unreadCount: 0 }));
  vi.stubGlobal('fetch', fetcher);
  const client = new SmartSiteManagementClient('https://example.test');
  await expect(client.listSafetyEpisodeInbox('token', { limit: 101 })).rejects.toBeDefined();
  expect(fetcher).not.toHaveBeenCalled();
  await expect(client.listSafetyEpisodeInbox('token')).rejects.toMatchObject({
    code: 'invalid-response',
  });
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response(' '.repeat(524289), { headers: { 'Content-Type': 'application/json' } }),
  );
  await expect(client.listSafetyEpisodeInbox('token')).rejects.toMatchObject({
    code: 'invalid-response',
  });
});
it('read sends displayed revision and rejects wrong-recipient or contradictory replies', async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({ id, contentRevision: 3, seenRevision: 2, unread: true }),
  );
  vi.stubGlobal('fetch', fetcher);
  const client = new SmartSiteManagementClient('https://example.test');
  expect(await client.readSafetyEpisodeInbox('token', id, { seenRevision: 2 })).toMatchObject({
    unread: true,
    contentRevision: 3,
  });
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
    cache: 'no-store',
    redirect: 'error',
    body: JSON.stringify({ seenRevision: 2 }),
  });
  for (const reply of [
    { id: other, contentRevision: 3, seenRevision: 2, unread: true },
    { id, contentRevision: 3, seenRevision: 2, unread: false },
  ]) {
    vi.stubGlobal('fetch', async () => Response.json(reply));
    await expect(
      client.readSafetyEpisodeInbox('token', id, { seenRevision: 2 }),
    ).rejects.toMatchObject({ code: 'invalid-response' });
  }
});
