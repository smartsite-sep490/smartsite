import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from './management';

const site = '11111111-1111-4111-8111-111111111111';
const episode = '22222222-2222-4222-8222-222222222222';
const source = {
  alertId: '33333333-3333-4333-8333-333333333333',
  eventId: '44444444-4444-4444-8444-444444444444',
  personObservationIndex: 2,
  evidenceIndex: 4,
};
// Only a signature fixture. Actual JPEG decoding remains the Backend reader's responsibility.
const jpeg = new Uint8Array([255, 216, 255, 224, 0, 2, 255, 217]);
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const sha = hash(jpeg);
function media(bytes: Uint8Array = jpeg, headers: Record<string, string> = {}): Response {
  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': 'image/jpeg',
      'x-smartsite-frame-sha256': sha,
      'x-smartsite-content-sha256': hash(bytes),
      'x-smartsite-media-representation': 'FRAME',
      ...headers,
    },
  });
}
const client = () => new SmartSiteManagementClient('https://example.test');
afterEach(() => vi.unstubAllGlobals());

it('verifies original FRAME digest and uses private scoped transport', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => media());
  vi.stubGlobal('fetch', fetcher);
  const result = await client().readTrackedEpisodeMedia(
    'token',
    site,
    episode,
    source,
    'FRAME',
    sha,
  );
  expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(jpeg);
  expect(result).toMatchObject({ sha256: sha, frameSha256: sha, representation: 'FRAME' });
  expect(result.blob.type).toBe('image/jpeg');
  const [url, init] = fetcher.mock.calls[0]!;
  expect(String(url)).toContain(`/findings/${source.alertId}/events/${source.eventId}/frame?`);
  expect(String(url)).toContain('personObservationIndex=2');
  expect(String(url)).toContain('evidenceIndex=4');
  expect(init).toMatchObject({ cache: 'no-store', redirect: 'error' });
  expect(new Headers(init?.headers).get('authorization')).toBe('Bearer token');
});

it('checks crop bytes separately while binding SUBJECT to the original frame digest', async () => {
  const crop = new Uint8Array([255, 216, 255, 225, 0, 2, 255, 217]);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      media(crop, {
        'x-smartsite-media-representation': 'SUBJECT',
      }),
    ),
  );
  const result = await client().readTrackedEpisodeMedia(
    'token',
    site,
    episode,
    source,
    'SUBJECT',
    sha,
  );
  expect(result.sha256).toBe(hash(crop));
  expect(result.sha256).not.toBe(result.frameSha256);
  expect(result.frameSha256).toBe(sha);
});

it('rejects wrong source SHA, substituted content, wrong representation and missing bindings', async () => {
  const variants: Record<string, string>[] = [
    { 'x-smartsite-frame-sha256': 'b'.repeat(64) },
    { 'x-smartsite-content-sha256': 'c'.repeat(64) },
    { 'x-smartsite-media-representation': 'SUBJECT' },
    { 'x-smartsite-content-sha256': '' },
  ];
  for (const headers of variants) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => media(jpeg, headers)),
    );
    await expect(
      client().readTrackedEpisodeMedia('token', site, episode, source, 'FRAME', sha),
    ).rejects.toMatchObject({ code: 'invalid-response' });
  }
});

it('bounds streamed bytes even without content-length and cancels excess data', async () => {
  const cancel = vi.fn();
  const oversized = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(1_048_577));
    },
    cancel,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(oversized, { headers: media().headers })),
  );
  await expect(
    client().readTrackedEpisodeMedia('token', site, episode, source, 'FRAME', sha),
  ).rejects.toMatchObject({ code: 'invalid-response' });
  expect(cancel).toHaveBeenCalledTimes(1);
});

it('rejects invalid JPEG signatures, media type and inconsistent lengths', async () => {
  for (const response of [
    media(new Uint8Array([1, 2, 3, 4])),
    media(jpeg, { 'content-type': 'text/html' }),
    media(jpeg, { 'content-length': '1048577' }),
    media(jpeg, { 'content-length': '9' }),
  ]) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response),
    );
    await expect(
      client().readTrackedEpisodeMedia('token', site, episode, source, 'FRAME', sha),
    ).rejects.toMatchObject({ code: 'invalid-response' });
  }
});

it('validates source/options before network and keeps denied HTTP errors', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => media());
  vi.stubGlobal('fetch', fetcher);
  await expect(
    client().readTrackedEpisodeMedia(
      'token',
      site,
      episode,
      { ...source, personObservationIndex: -1 },
      'FRAME',
      sha,
    ),
  ).rejects.toBeDefined();
  await expect(
    client().readTrackedEpisodeMedia('token', site, episode, source, 'FRAME', 'bad-hash'),
  ).rejects.toBeDefined();
  expect(fetcher).not.toHaveBeenCalled();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ message: 'Forbidden' }, { status: 403 })),
  );
  await expect(
    client().readTrackedEpisodeMedia('token', site, episode, source, 'FRAME', sha),
  ).rejects.toMatchObject({ code: 'http', status: 403 });
});

it('cancels an active media stream without delivering old bytes', async () => {
  const cancel = vi.fn();
  const controller = new AbortController();
  const stream = new ReadableStream<Uint8Array>({
    start(reader) {
      reader.enqueue(jpeg.subarray(0, 3));
    },
    cancel,
  });
  const fetcher = vi.fn<typeof fetch>(
    async () => new Response(stream, { headers: media().headers }),
  );
  vi.stubGlobal('fetch', fetcher);
  const pending = client().readTrackedEpisodeMedia('token', site, episode, source, 'FRAME', sha, {
    signal: controller.signal,
  });
  const assertion = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  controller.abort();
  await assertion;
  await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
});
