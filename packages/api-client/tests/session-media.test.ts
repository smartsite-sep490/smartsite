import { afterEach, describe, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient, type ManagementSession } from '../src/index';

afterEach(() => vi.unstubAllGlobals());
type Kind = 'live' | 'recorded';
function fixture() {
  const controller = new AbortController();
  let token = 'synthetic-old';
  const session: ManagementSession = {
    signal: controller.signal,
    getAccessToken: vi.fn(() => token),
    refreshAccessToken: vi.fn(async () => (token = 'synthetic-new')),
    onUnauthorized: vi.fn(),
  };
  return {
    controller,
    session,
    client: new SmartSiteManagementClient('https://api.example.test', session),
  };
}
function responseFor(kind: Kind, body?: ReadableStream<Uint8Array>) {
  const frame = {
    type: 'media-frame',
    mediaVersion: 1,
    cameraExternalId: 'fixture-camera',
    sessionId: '11111111-1111-4111-8111-111111111111',
    sequenceNumber: '1',
    capturedAt: new Date().toISOString(),
    width: 640,
    height: 480,
    imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
  };
  return new Response(
    body ?? (kind === 'live' ? JSON.stringify(frame) + '\n' : new Uint8Array([1, 2, 3])),
    {
      headers: {
        'Content-Type': kind === 'live' ? 'application/x-ndjson' : 'video/mp4',
        'x-camera-external-id': 'fixture-camera',
      },
    },
  );
}
function read(
  client: SmartSiteManagementClient,
  kind: Kind,
  onFrame = vi.fn(),
  signal?: AbortSignal,
) {
  const options = { expectedCameraExternalId: 'fixture-camera', timeoutMs: 500, signal };
  return kind === 'live'
    ? client.streamCameraVideo('synthetic-old', 'site', 'camera', onFrame, options)
    : client.readRecordedCameraVideo('synthetic-old', 'site', 'camera', options);
}

describe.each<Kind>(['live', 'recorded'])('%s media uses the Main session lifecycle', (kind) => {
  it('refreshes an initial401 once and releases the rejected body before retrying', async () => {
    const { client, session } = fixture();
    const first = Response.json({ message: 'Unauthorized' }, { status: 401 });
    const cancel = vi.spyOn(first.body!, 'cancel');
    const fetcher = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(responseFor(kind));
    vi.stubGlobal('fetch', fetcher);
    const onFrame = vi.fn();
    await read(client, kind, onFrame);
    expect(session.refreshAccessToken).toHaveBeenCalledExactlyOnceWith('synthetic-old');
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledTimes(2);
    const [url, init] = fetcher.mock.calls[1] as [string, RequestInit];
    expect(url).not.toContain('synthetic-');
    expect(init).toMatchObject({
      headers: { Authorization: 'Bearer synthetic-new' },
      cache: 'no-store',
      redirect: 'error',
    });
    expect(session.onUnauthorized).not.toHaveBeenCalled();
    if (kind === 'live') expect(onFrame).toHaveBeenCalledOnce();
  });

  it('ends the current session after a second401 without looping', async () => {
    const { client, session } = fixture();
    const fetcher = vi.fn(async () => Response.json({ message: 'Unauthorized' }, { status: 401 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(read(client, kind)).rejects.toMatchObject({ status: 401 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(session.onUnauthorized).toHaveBeenCalledExactlyOnceWith('synthetic-new');
  });

  it('cancels headers on logout even when the fetch adapter ignores abort', async () => {
    const { client, controller } = fixture();
    let release!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      ),
    );
    const onFrame = vi.fn();
    const pending = read(client, kind, onFrame);
    const rejected = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    controller.abort();
    await rejected;
    const late = responseFor(kind);
    const cancel = vi.spyOn(late.body!, 'cancel');
    release(late);
    await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
    expect(onFrame).not.toHaveBeenCalled();
  });

  it('cancels an already-open body on logout and publishes no later frame', async () => {
    const { client, controller } = fixture();
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel: cancelled });
    const response = responseFor(kind, body);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    const onFrame = vi.fn();
    const pending = read(client, kind, onFrame);
    const rejected = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    await vi.waitFor(() => expect(body.locked).toBe(true));
    controller.abort();
    await rejected;
    expect(cancelled).toHaveBeenCalled();
    expect(onFrame).not.toHaveBeenCalled();
  });

  it('does not replay after caller cancellation while refresh is pending', async () => {
    const { client, session } = fixture();
    let release!: (value: string) => void;
    vi.mocked(session.refreshAccessToken).mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    const fetcher = vi.fn(async () => Response.json({ message: 'Unauthorized' }, { status: 401 }));
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    const pending = read(client, kind, vi.fn(), controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    await vi.waitFor(() => expect(session.refreshAccessToken).toHaveBeenCalledOnce());
    controller.abort();
    await rejected;
    release('synthetic-new');
    await Promise.resolve();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(session.onUnauthorized).not.toHaveBeenCalled();
  });

  it('keeps a temporary503 distinct from an expired session', async () => {
    const { client, session } = fixture();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ message: 'Unavailable' }, { status: 503, headers: { 'Retry-After': '3' } }),
      ),
    );
    await expect(read(client, kind)).rejects.toMatchObject({ status: 503, retryAfterSeconds: 3 });
    expect(session.refreshAccessToken).not.toHaveBeenCalled();
    expect(session.onUnauthorized).not.toHaveBeenCalled();
  });
});
