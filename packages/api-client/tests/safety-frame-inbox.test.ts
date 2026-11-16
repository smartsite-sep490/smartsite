import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '../src/index';

vi.mock('@smartsite/contracts', () => {
  throw new Error('Browser client imported the Node-only contracts root');
});
afterEach(() => vi.unstubAllGlobals());
const id = (index: number) => `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const siteId = id(1),
  cameraId = id(2),
  frameKey = `event:${id(3)}`;
function page() {
  return {
    total: 1,
    unreadCount: 1,
    items: [
      {
        siteId,
        cameraId,
        frameKey,
        siteName: 'Synthetic Site',
        cameraName: 'Synthetic Camera',
        capturedAt: '2026-11-16T00:00:00Z',
        unread: true,
        findingCount: 6,
        cases: [0, 1, 2].map((index) => ({
          recipientId: id(10 + index),
          episodeId: id(20 + index),
          findingCount: 2,
          unread: true,
          contentRevision: 1,
          source: null,
          zoneEntries: [],
        })),
      },
    ],
  };
}
function reply(value: unknown) {
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify(value), {
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
const client = () => new SmartSiteManagementClient('https://api.example.test');

it('forwards scoped Camera filtering and pagination to the server, retaining one frame with three cases', async () => {
  const fetcher = reply(page());
  const result = await client().listSafetyFrameInbox('synthetic-token', {
    siteId,
    cameraId,
    frameKey,
    offset: 0,
    limit: 1,
    readStatus: 'UNREAD',
  });
  const url = new URL(String(fetcher.mock.calls[0]?.[0]));
  expect(url.pathname).toBe('/api/v1/me/safety-episode-inbox/frames');
  expect(Object.fromEntries(url.searchParams)).toEqual({
    siteId,
    cameraId,
    frameKey,
    offset: '0',
    limit: '1',
    readStatus: 'UNREAD',
  });
  expect(fetcher.mock.calls[0]?.[1]?.headers).toMatchObject({
    Authorization: 'Bearer synthetic-token',
  });
  expect(result.items[0]?.cases).toHaveLength(3);
  expect(result.items[0]?.findingCount).toBe(6);
});

it.each(['siteId', 'cameraId', 'frameKey'] as const)(
  'rejects a response outside requested %s',
  async (field) => {
    const value = page();
    value.items[0]![field] = field === 'frameKey' ? `event:${id(99)}` : id(99);
    reply(value);
    await expect(
      client().listSafetyFrameInbox('token', { siteId, cameraId, frameKey }),
    ).rejects.toMatchObject({ code: 'invalid-response' });
  },
);

it('rejects contradictory finding totals and duplicate case identities', async () => {
  const badTotal = page();
  badTotal.items[0]!.findingCount = 5;
  reply(badTotal);
  await expect(client().listSafetyFrameInbox('token')).rejects.toMatchObject({
    code: 'invalid-response',
  });
  const duplicate = page();
  duplicate.items[0]!.cases[1]!.recipientId = duplicate.items[0]!.cases[0]!.recipientId;
  reply(duplicate);
  await expect(client().listSafetyFrameInbox('token')).rejects.toMatchObject({
    code: 'invalid-response',
  });
});

it.each([
  { limit: 0 },
  { limit: 101 },
  { offset: -1 },
  { cameraId: 'bad' },
  { siteId: '' },
  { frameKey: '' },
  { readStatus: 'OTHER' },
])('rejects malformed filters before fetch: %j', async (options) => {
  const fetcher = reply(page());
  await expect(client().listSafetyFrameInbox('token', options as never)).rejects.toBeInstanceOf(
    TypeError,
  );
  expect(fetcher).not.toHaveBeenCalled();
});
