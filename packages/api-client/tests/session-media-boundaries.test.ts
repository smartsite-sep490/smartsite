import { afterEach, describe, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient, type ManagementSession } from '../src/index';

afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const controller = new AbortController();
  const session: ManagementSession = {
    signal: controller.signal,
    getAccessToken: vi.fn(() => 'synthetic-old'),
    refreshAccessToken: vi.fn(async () => 'synthetic-new'),
    onUnauthorized: vi.fn(),
  };
  return {
    controller,
    session,
    client: new SmartSiteManagementClient('https://api.example.test', session),
  };
}

describe('live media error response lifecycle', () => {
  it('cancels a stalled503 error body on logout without waiting for the server to close', async () => {
    const { controller, client } = fixture();
    const cancelled = vi.fn();
    let close!: () => void;
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        close = () => stream.close();
      },
      cancel: cancelled,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(body, { status: 503, headers: { 'Content-Type': 'application/json' } }),
      ),
    );
    let outcome: unknown;
    const pending = client
      .streamCameraVideo('synthetic-old', 'site', 'camera', vi.fn(), { timeoutMs: 500 })
      .then(
        () => {
          outcome = 'unexpected-success';
        },
        (error) => {
          outcome = error;
        },
      );
    await vi.waitFor(() => expect(body.locked).toBe(true));
    controller.abort();
    try {
      await vi.waitFor(() => expect(outcome).toMatchObject({ code: 'cancelled' }), {
        timeout: 200,
      });
      expect(cancelled).toHaveBeenCalledOnce();
    } finally {
      if (!cancelled.mock.calls.length) close();
      await pending;
    }
  });

  it('bounds a503 error body and releases its reader even when the server never finishes', async () => {
    const { client } = fixture();
    const cancelled = vi.fn();
    let close!: () => void;
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        stream.enqueue(new Uint8Array(16_001).fill(32));
        close = () => stream.close();
      },
      cancel: cancelled,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(body, { status: 503, headers: { 'Content-Type': 'application/json' } }),
      ),
    );
    const pending = client.streamCameraVideo('synthetic-old', 'site', 'camera', vi.fn(), {
      timeoutMs: 50,
    });
    // Observe rejection immediately so the regression cannot leave an unhandled promise.
    const outcome = pending.then(
      () => null,
      (error) => error,
    );
    try {
      await vi.waitFor(() => expect(cancelled).toHaveBeenCalledOnce(), { timeout: 200 });
      expect(await outcome).toMatchObject({ status: 503 });
    } finally {
      if (!cancelled.mock.calls.length) close();
      await outcome;
    }
  });

  it('times out stalled error JSON', async () => {
    const { client } = fixture();
    const cancelled = vi.fn();
    let close!: () => void;
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        close = () => stream.close();
      },
      cancel: cancelled,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(body, { status: 503, headers: { 'Content-Type': 'application/json' } }),
      ),
    );
    let outcome: unknown;
    const pending = client
      .streamCameraVideo('synthetic-old', 'site', 'camera', vi.fn(), { timeoutMs: 30 })
      .then(
        () => {
          outcome = 'unexpected-success';
        },
        (error) => {
          outcome = error;
        },
      );
    try {
      await vi.waitFor(() => expect(outcome).toMatchObject({ code: 'timeout' }), { timeout: 200 });
      expect(cancelled).toHaveBeenCalledOnce();
    } finally {
      if (!cancelled.mock.calls.length) close();
      await pending;
    }
  });

  it('keeps a healthy200 stream open beyond the headers deadline until the caller cancels', async () => {
    const { client, controller } = fixture();
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel: cancelled });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } }),
      ),
    );
    let settled = false;
    const outcome = client
      .streamCameraVideo('synthetic-old', 'site', 'camera', vi.fn(), { timeoutMs: 20 })
      .then(
        () => {
          settled = true;
          return null;
        },
        (error) => {
          settled = true;
          return error;
        },
      );
    await vi.waitFor(() => expect(body.locked).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(settled).toBe(false);
    controller.abort();
    expect(await outcome).toMatchObject({ code: 'cancelled' });
    expect(cancelled).toHaveBeenCalledOnce();
  });
});

describe.each(['live', 'recorded'] as const)(
  '%s media rejects invalid session credentials',
  (kind) => {
    const read = (client: SmartSiteManagementClient) =>
      kind === 'live'
        ? client.streamCameraVideo('synthetic-old', 'site', 'camera', vi.fn())
        : client.readRecordedCameraVideo('synthetic-old', 'site', 'camera');

    it('does not send a captured stale Bearer token when the adapter returns an empty token', async () => {
      const { session, client } = fixture();
      vi.mocked(session.getAccessToken).mockReturnValue('');
      const fetcher = vi.fn(async () => Response.json({}, { status: 503 }));
      vi.stubGlobal('fetch', fetcher);
      await expect(read(client)).rejects.toMatchObject({ code: 'invalid-response' });
      expect(fetcher).not.toHaveBeenCalled();
    });

    it('does not retry anonymously or reuse a stale token if refresh returns an empty token', async () => {
      const { session, client } = fixture();
      vi.mocked(session.refreshAccessToken).mockResolvedValue('');
      const fetcher = vi.fn(async () => Response.json({}, { status: 401 }));
      vi.stubGlobal('fetch', fetcher);
      await expect(read(client)).rejects.toMatchObject({ code: 'invalid-response' });
      expect(fetcher).toHaveBeenCalledOnce();
      expect(session.onUnauthorized).not.toHaveBeenCalled();
    });
  },
);

it.each([200, 503])(
  'releases the auxiliary password-session check body at HTTP%s',
  async (status) => {
    const { session, client } = fixture();
    const check = Response.json({}, { status });
    const cancel = vi.spyOn(check.body!, 'cancel');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/auth/me') ? check : Response.json({}, { status: 401 }),
      ),
    );
    await expect(
      client.changePassword('synthetic-old', 'wrong', 'SyntheticNew1!'),
    ).rejects.toMatchObject({ status: status === 200 ? 401 : 503 });
    expect(cancel).toHaveBeenCalledOnce();
    expect(session.refreshAccessToken).not.toHaveBeenCalled();
    expect(session.onUnauthorized).not.toHaveBeenCalled();
  },
);
