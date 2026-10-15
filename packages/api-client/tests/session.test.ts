import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, SmartSiteManagementClient } from '../src/index';

afterEach(() => vi.unstubAllGlobals());

function session() {
  let token = 'old';
  return {
    getAccessToken: vi.fn(() => token),
    refreshAccessToken: vi.fn(async () => (token = 'new')),
    onUnauthorized: vi.fn(),
    signal: new AbortController().signal,
  };
}

describe('opt-in Web session transport', () => {
  it('does not add a Web session timeout or signal to default Mobile auth requests', async () => {
    const fetch = vi.fn(async () => Response.json({ accessToken: 'mobile' }));
    vi.stubGlobal('fetch', fetch);
    await new SmartSiteManagementClient('https://api.example.test').login(
      'worker',
      'password',
      'MOBILE',
    );
    expect((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].signal).toBeUndefined();
  });
  it.each(['json', 'multipart', 'blob'] as const)(
    'refreshes and retries %s once without changing the request',
    async (kind) => {
      const adapter = session();
      const calls: RequestInit[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: string, init: RequestInit) => {
          calls.push(init);
          if (calls.length === 1) return new Response('{}', { status: 401 });
          return kind === 'blob'
            ? new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'image/jpeg' } })
            : Response.json({ items: [] });
        }),
      );
      const client = new SmartSiteManagementClient('https://api.example.test', adapter);
      if (kind === 'json') await client.listSites('old');
      else if (kind === 'blob')
        await client.getSafetyAlertEvidence('old', 'site', 'alert', 'event', 0);
      else
        await client.incidentCommand(
          'old',
          'site',
          'incident',
          'submit',
          { commandId: 'command', expectedVersion: 1, resultDescription: 'Result' },
          'action',
        );
      expect(adapter.refreshAccessToken).toHaveBeenCalledOnce();
      expect(calls).toHaveLength(2);
      expect(calls[1]?.body).toBe(calls[0]?.body);
      expect(calls[1]?.headers).toMatchObject({ Authorization: 'Bearer new' });
      expect(adapter.onUnauthorized).not.toHaveBeenCalled();
    },
  );

  it('ends the session on a second authenticated 401, without an infinite retry', async () => {
    const adapter = session();
    const fetch = vi.fn(async () => new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetch);
    await expect(
      new SmartSiteManagementClient('https://api.example.test', adapter).me('old'),
    ).rejects.toMatchObject({ status: 401 });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(adapter.onUnauthorized).toHaveBeenCalledOnce();
  });

  it('does not refresh login or retry network failures', async () => {
    const adapter = session();
    const fetch = vi.fn(async () => new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetch);
    const client = new SmartSiteManagementClient('https://api.example.test', adapter);
    await expect(client.login('worker', 'wrong')).rejects.toMatchObject({ status: 401 });
    fetch.mockRejectedValueOnce(new TypeError('offline'));
    await expect(client.me('old')).rejects.toMatchObject({ code: 'network' });
    expect(adapter.refreshAccessToken).not.toHaveBeenCalled();
    expect(adapter.onUnauthorized).not.toHaveBeenCalled();
  });

  it('checks the current session before treating a password rejection as expiry', async () => {
    const adapter = session();
    const fetch = vi.fn(async (url: string) =>
      url.endsWith('/auth/me')
        ? Response.json({ id: 'user' })
        : new Response('{}', { status: 401 }),
    );
    vi.stubGlobal('fetch', fetch);
    await expect(
      new SmartSiteManagementClient('https://api.example.test', adapter).changePassword(
        'old',
        'wrong',
        'NewPassword1!',
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(adapter.refreshAccessToken).not.toHaveBeenCalled();
    expect(adapter.onUnauthorized).not.toHaveBeenCalled();
  });

  it('keeps the session and Retry-After metadata on a temporary failure', async () => {
    const adapter = session();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 429, headers: { 'Retry-After': '45' } })),
    );
    await expect(
      new SmartSiteManagementClient('https://api.example.test', adapter).me('old'),
    ).rejects.toMatchObject({ status: 429, retryAfterSeconds: 45 });
    expect(adapter.onUnauthorized).not.toHaveBeenCalled();
  });

  it.each(['network', 'server'] as const)(
    'does not expire the session when the password session check encounters a %s error',
    async (failure) => {
      const adapter = session();
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          if (!url.endsWith('/auth/me')) return new Response('{}', { status: 401 });
          if (failure === 'network') throw new TypeError('Offline');
          return new Response('{}', { status: 503 });
        }),
      );
      await expect(
        new SmartSiteManagementClient('https://api.example.test', adapter).changePassword(
          'old',
          'wrong',
          'NewPassword1!',
        ),
      ).rejects.toMatchObject(failure === 'network' ? { code: 'network' } : { status: 503 });
      expect(adapter.refreshAccessToken).not.toHaveBeenCalled();
      expect(adapter.onUnauthorized).not.toHaveBeenCalled();
    },
  );

  it('cancels a request waiting for refresh without replaying it', async () => {
    const adapter = session();
    let release!: (value: string) => void;
    adapter.refreshAccessToken.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    const fetch = vi.fn(async () => new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetch);
    const controller = new AbortController();
    const request = new SmartSiteManagementClient('https://api.example.test', adapter).listSites(
      'old',
      undefined,
      { signal: controller.signal },
    );
    await vi.waitFor(() => expect(adapter.refreshAccessToken).toHaveBeenCalledOnce());
    controller.abort();
    await expect(request).rejects.toBeInstanceOf(ApiError);
    release('new');
    expect(fetch).toHaveBeenCalledOnce();
  });
});
