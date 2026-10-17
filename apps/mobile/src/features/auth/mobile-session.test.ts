import { afterEach, describe, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient, type LoginResponse } from '@smartsite/api-client';
import { MobileSession } from './mobile-session';

const response = (accessToken = 'access', refreshToken = 'refresh'): LoginResponse => ({
  accessToken,
  refreshToken,
  tokenType: 'Bearer',
  accessTokenExpiresAt: '2026-11-01T00:00:00Z',
  refreshTokenExpiresAt: '2026-12-01T00:00:00Z',
  user: {
    id: 'worker-user',
    username: 'synthetic-worker',
    displayName: 'Synthetic Worker',
    roleAssignments: [{ role: 'WORKER', siteId: 'site-a' }],
    isActive: true,
    mustChangePassword: false,
  },
});
function fixture(initial: string | null = null) {
  let saved = initial;
  const store = {
    read: vi.fn(async () => saved),
    write: vi.fn(async (v: string) => {
      saved = v;
    }),
    remove: vi.fn(async () => {
      saved = null;
    }),
  };
  const manager = new MobileSession(
    store,
    new SmartSiteManagementClient('https://api.example.test'),
  );
  return { manager, store, saved: () => saved };
}
afterEach(() => vi.unstubAllGlobals());
describe('mobile credentials and refresh lifecycle', () => {
  it('authenticates MOBILE with the supplied password and persists only its refresh token', async () => {
    const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () =>
      Response.json(response()),
    );
    vi.stubGlobal('fetch', fetch);
    const f = fixture();
    await f.manager.login(' synthetic-worker ', 'correct-password');
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toEqual({
      username: 'synthetic-worker',
      password: 'correct-password',
      clientType: 'MOBILE',
    });
    expect(f.store.write).toHaveBeenCalledWith('refresh');
    expect(f.saved()).toBe('refresh');
    expect(f.manager.getSnapshot().response?.user.roleAssignments[0]?.role).toBe('WORKER');
  });
  it('does not accept invalid passwords or derive a role from an admin-like username', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 401 })),
    );
    const f = fixture();
    await expect(f.manager.login('admin-contractor', 'wrong')).rejects.toMatchObject({
      status: 401,
    });
    expect(f.manager.getSnapshot().response).toBeNull();
    expect(f.saved()).toBeNull();
  });
  it('rotates a stored refresh token once for concurrent restore calls', async () => {
    const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () =>
      Response.json(response('new-access', 'new-refresh')),
    );
    vi.stubGlobal('fetch', fetch);
    const f = fixture('old-refresh');
    await Promise.all([f.manager.restore(), f.manager.restore()]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(f.saved()).toBe('new-refresh');
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toMatchObject({
      clientType: 'MOBILE',
      refreshToken: 'old-refresh',
    });
  });
  it('uses a single rotation for simultaneous authenticated 401 responses', async () => {
    let refreshes = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        if (url.endsWith('/auth/login')) return Response.json(response());
        if (url.endsWith('/auth/refresh')) {
          refreshes++;
          return Response.json(response('new-access', 'new-refresh'));
        }
        if ((init.headers as Record<string, string>).Authorization === 'Bearer access')
          return new Response('{}', { status: 401 });
        return Response.json({ items: [], total: 0 });
      }),
    );
    const f = fixture();
    await f.manager.login('worker', 'password');
    const client = new SmartSiteManagementClient('https://api.example.test', f.manager.adapter());
    await Promise.all([client.listSites('access'), client.listSites('access')]);
    expect(refreshes).toBe(1);
    expect(f.saved()).toBe('new-refresh');
  });
  it('never resurrects a session when logout races a refresh response', async () => {
    let resolve!: (value: Response) => void;
    const started = Promise.withResolvers<void>();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/auth/refresh')) {
          started.resolve();
          return new Promise<Response>((r) => {
            resolve = r;
          });
        }
        return new Response(null, { status: 204 });
      }),
    );
    const f = fixture('old-refresh');
    const restore = f.manager.restore();
    await started.promise;
    const logout = f.manager.logout();
    resolve(Response.json(response('new-access', 'new-refresh')));
    await expect(restore).rejects.toMatchObject({ code: 'cancelled' });
    await logout;
    const logoutCall = vi
      .mocked(globalThis.fetch)
      .mock.calls.find(([url]) => String(url).endsWith('/auth/logout'));
    expect(JSON.parse(logoutCall?.[1]?.body as string)).toMatchObject({
      refreshToken: 'new-refresh',
      clientType: 'MOBILE',
    });
    expect(f.saved()).toBeNull();
    expect(f.manager.getSnapshot().response).toBeNull();
  });
  it('clears rejected refresh credentials but retains them during an offline restore', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 401 })),
    );
    const rejected = fixture('revoked');
    expect(await rejected.manager.restore()).toBeNull();
    expect(rejected.saved()).toBeNull();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline');
      }),
    );
    const offline = fixture('retry-token');
    await expect(offline.manager.restore()).rejects.toMatchObject({ code: 'network' });
    expect(offline.saved()).toBe('retry-token');
  });
  it('deletes local credentials even if server logout fails and aborts obsolete adapters', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/auth/login')
          ? Response.json(response())
          : new Response('{}', { status: 503 }),
      ),
    );
    const f = fixture();
    await f.manager.login('worker', 'password');
    const adapter = f.manager.adapter();
    await expect(f.manager.logout()).rejects.toMatchObject({ status: 503 });
    expect(f.saved()).toBeNull();
    expect(adapter.signal.aborted).toBe(true);
    expect(() => adapter.getAccessToken('access')).toThrow();
  });
});
