import { afterEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from './management';

const maximum = 1_048_576;
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
const client = () => new SmartSiteManagementClient('http://localhost:3000');
const load = (options?: { signal?: AbortSignal; timeoutMs?: number }) =>
  client().getSafetyAlertEvidence('test-token', 'site', 'alert', 'event', 0, options);
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('fetches private evidence without browser cache or redirects', async () => {
  const fetch = vi
    .fn()
    .mockResolvedValue(new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } }));
  vi.stubGlobal('fetch', fetch);
  expect(new Uint8Array(await (await load()).arrayBuffer())).toEqual(jpeg);
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({
    cache: 'no-store',
    redirect: 'error',
    signal: expect.any(AbortSignal),
  });
});

it('accepts case-insensitive JPEG MIME types', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(jpeg, { headers: { 'content-type': 'IMAGE/JPEG; charset=binary' } }),
      ),
  );
  expect((await load()).type).toBe('image/jpeg');
});

it.each(['1048577', 'not-a-length', '-1'])(
  'rejects invalid Content-Length %s and cancels unread response',
  async (length) => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(jpeg);
      },
      cancel,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(body, {
          headers: { 'content-type': 'image/jpeg', 'content-length': length },
        }),
      ),
    );
    await expect(load({ timeoutMs: 40 })).rejects.toMatchObject({ code: 'invalid-response' });
    expect(cancel).toHaveBeenCalledTimes(1);
  },
);

it('rejects streamed oversize even with a lying small Content-Length and no EOF', async () => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(maximum + 1));
    },
    cancel,
  });
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(body, { headers: { 'content-type': 'image/jpeg', 'content-length': '4' } }),
      ),
  );
  await expect(load({ timeoutMs: 40 })).rejects.toMatchObject({ code: 'invalid-response' });
  expect(cancel).toHaveBeenCalledTimes(1);
});

it('times out and cancels a stalled response body', async () => {
  const cancel = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'image/jpeg' } }),
      ),
  );
  await expect(load({ timeoutMs: 20 })).rejects.toMatchObject({ code: 'timeout' });
  expect(cancel).toHaveBeenCalledTimes(1);
});

it('uses a 5s default deadline for a body that never arrives', async () => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(new ReadableStream({ cancel }), { headers: { 'content-type': 'image/jpeg' } }),
      ),
  );
  const outcome = load().then(
    () => null,
    (error: unknown) => error,
  );
  await vi.advanceTimersByTimeAsync(5000);
  expect(await outcome).toMatchObject({ code: 'timeout' });
  expect(cancel).toHaveBeenCalledTimes(1);
});

it.each([new Uint8Array(), new Uint8Array([0xff, 0xd8, 1, 2]), new Uint8Array([1, 2, 0xff, 0xd9])])(
  'rejects empty or truncated JPEG despite its declared MIME type',
  async (bytes) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(bytes, { headers: { 'content-type': 'image/jpeg' } })),
    );
    await expect(load()).rejects.toMatchObject({ code: 'invalid-response' });
  },
);

it('accepts the exact maximum image size', async () => {
  const bytes = new Uint8Array(maximum);
  bytes.set(jpeg.slice(0, 2));
  bytes.set(jpeg.slice(2), maximum - 2);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(bytes, { headers: { 'content-type': 'image/jpeg' } })),
  );
  expect((await load()).size).toBe(maximum);
});

it('still rejects an oversized image from a native adapter without streaming support', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
      body: null,
      blob: async () => new Blob([new Uint8Array(maximum + 1)], { type: 'image/jpeg' }),
    }),
  );
  await expect(load()).rejects.toMatchObject({ code: 'invalid-response' });
});

it('returns a valid JPEG from a native adapter without streaming support', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
      body: null,
      blob: async () => new Blob([jpeg], { type: 'image/jpeg' }),
    }),
  );
  expect(new Uint8Array(await (await load()).arrayBuffer())).toEqual(jpeg);
});

it('does not wait for a broken adapter cancellation promise before reporting an oversize body', async () => {
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(maximum + 1));
    },
    cancel,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(body, { headers: { 'content-type': 'image/jpeg' } })),
  );
  await expect(load({ timeoutMs: 40 })).rejects.toMatchObject({ code: 'invalid-response' });
  expect(cancel).toHaveBeenCalledTimes(1);
});
