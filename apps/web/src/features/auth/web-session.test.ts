import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type LoginResponse } from '@smartsite/api-client';
import { captureSessionScopes } from '../../../../../packages/api-client/src/session-expiry';
import { WebSession } from './web-session';

const result = (token: string): LoginResponse => ({
  accessToken: token,
  tokenType: 'Bearer',
  accessTokenExpiresAt: '2026-10-15T10:15:00Z',
  refreshTokenExpiresAt: '2026-11-14T10:00:00Z',
  user: {
    id: 'user',
    username: 'worker',
    displayName: 'Worker',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [{ role: 'WORKER', siteId: 'site' }],
  },
});
afterEach(() => vi.unstubAllGlobals());

describe('Web session ownership', () => {
  it('does not register a late bootstrap credential after its owner disconnects', async () => {
    let release!: (value: LoginResponse) => void;
    const client = {
      refresh: vi.fn(
        () =>
          new Promise<LoginResponse>((resolve) => {
            release = resolve;
          }),
      ),
    };
    const manager = new WebSession('https://late.example.test', client as never);
    manager.connect();
    const pending = manager.restore();
    manager.dispose();
    release(result('late-disposed-fixture'));
    await pending;
    expect(captureSessionScopes('late-disposed-fixture')).toEqual([]);
  });

  it('refuses silent refresh for an injected credential without an established account', async () => {
    const client = { refresh: vi.fn().mockResolvedValue(result('other-account')) };
    const manager = new WebSession('https://opaque.example.test', client as never);
    manager.setAccessToken('unbound-account');
    await expect(manager.adapter().refreshAccessToken('unbound-account')).rejects.toMatchObject({
      status: 401,
    });
    expect(client.refresh).not.toHaveBeenCalled();
  });

  it('does not revoke a replacement session when an obsolete logout finally acquires the lock', async () => {
    const operations: Array<() => Promise<unknown>> = [];
    vi.stubGlobal('navigator', {
      locks: {
        request: (_name: string, operation: () => Promise<unknown>) =>
          new Promise((resolve, reject) => {
            operations.push(() => Promise.resolve().then(operation).then(resolve, reject));
          }),
      },
    });
    const client = { logout: vi.fn(async () => {}) };
    const manager = new WebSession('https://queued.example.test', client as never);
    manager.accept(result('old'));
    const pending = manager.logout();
    const rejected = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    manager.setAccessToken('new');
    await operations[0]!();
    await rejected;
    expect(client.logout).not.toHaveBeenCalled();
    expect(manager.getSnapshot().token).toBe('new');
  });

  it('does not globally sign other tabs out when a login attempt fails', async () => {
    const entries = new Map<string, string>();
    const storage = {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => {
        entries.set(key, value);
      },
      removeItem: (key: string) => {
        entries.delete(key);
      },
    };
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('sessionStorage', storage);
    const client = { login: vi.fn().mockRejectedValue(new ApiError('http', 'Denied', 401)) };
    const attempting = new WebSession('https://shared.example.test', client as never);
    const otherTab = new WebSession('https://shared.example.test', {} as never);
    await expect(attempting.login('user', 'wrong')).rejects.toMatchObject({ status: 401 });
    expect(otherTab.canRestore()).toBe(true);
  });

  it('honors a legacy API-specific logout marker until a real login succeeds', async () => {
    const entries = new Map([['smartsite:logout:https://legacy.example.test', '1']]);
    const storage = {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => {
        entries.set(key, value);
      },
      removeItem: (key: string) => {
        entries.delete(key);
      },
    };
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('sessionStorage', storage);
    const client = { refresh: vi.fn(), login: vi.fn().mockResolvedValue(result('legacy-login')) };
    const manager = new WebSession('https://legacy.example.test/', client as never);
    expect(manager.canRestore()).toBe(false);
    expect(await manager.restore()).toBeNull();
    expect(client.refresh).not.toHaveBeenCalled();
    await manager.login('user', 'password');
    expect(manager.canRestore()).toBe(true);
    expect(entries.has('smartsite:logout:https://legacy.example.test')).toBe(false);
  });

  it('returns an already-aborted signal when an obsolete epoch constructs an adapter', () => {
    const manager = new WebSession('https://epoch.example.test', {} as never);
    const oldEpoch = manager.getSnapshot().epoch;
    manager.setAccessToken('replacement');
    expect(manager.adapter(oldEpoch).signal.aborted).toBe(true);
  });
  it('invalidates previous adapters when an explicit access token replaces the session', () => {
    const manager = new WebSession('https://api.example.test', {} as never);
    manager.accept(result('old'));
    const previous = manager.adapter();
    manager.setAccessToken('replacement');
    expect(manager.getSnapshot().token).toBe('replacement');
    expect(() => previous.getAccessToken('old')).toThrow(ApiError);
  });
  it('ignores an old bootstrap rejection after a newer login', async () => {
    vi.stubGlobal('navigator', {});
    let reject!: (error: ApiError) => void;
    const client = {
      refresh: vi.fn(
        () =>
          new Promise<LoginResponse>((_resolve, fail) => {
            reject = fail;
          }),
      ),
      login: vi.fn().mockResolvedValue(result('new-login')),
    };
    const manager = new WebSession('https://api.example.test', client as never);
    const restore = manager.restore();
    const cancelled = expect(restore).rejects.toMatchObject({ code: 'cancelled' });
    await manager.login('worker', 'password');
    reject(new ApiError('http', 'Unauthorized', 401));
    await cancelled;
    expect(manager.getSnapshot().token).toBe('new-login');
  });
  it('shares a refresh and reuses a newer token for delayed 401 responses', async () => {
    let release!: (value: LoginResponse) => void;
    const client = {
      refresh: vi.fn(
        () =>
          new Promise<LoginResponse>((resolve) => {
            release = resolve;
          }),
      ),
    };
    const manager = new WebSession('https://api.example.test', client as never);
    manager.accept(result('old'));
    const adapter = manager.adapter();
    const first = adapter.refreshAccessToken('old');
    const second = adapter.refreshAccessToken('old');
    await vi.waitFor(() => expect(client.refresh).toHaveBeenCalledOnce());
    release(result('new'));
    expect(await first).toBe('new');
    expect(await second).toBe('new');
    expect(await adapter.refreshAccessToken('old')).toBe('new');
    expect(client.refresh).toHaveBeenCalledOnce();
    manager.dispose();
  });

  it('does not resurrect a logged-out session when refresh completes late', async () => {
    let release!: (value: LoginResponse) => void;
    const client = {
      refresh: vi.fn(
        () =>
          new Promise<LoginResponse>((resolve) => {
            release = resolve;
          }),
      ),
      logout: vi.fn(async () => {}),
    };
    const manager = new WebSession('https://api.example.test', client as never);
    manager.accept(result('old'));
    const adapter = manager.adapter();
    const pending = adapter.refreshAccessToken('old');
    const rejected = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    await vi.waitFor(() => expect(client.refresh).toHaveBeenCalledOnce());
    const logout = manager.logout();
    release(result('new'));
    await logout;
    await rejected;
    expect(manager.getSnapshot().token).toBeNull();
    expect(adapter.signal.aborted).toBe(true);
    manager.dispose();
  });

  it('keeps cookie rotation under the lock until logout can send the rotated cookie', async () => {
    let queue = Promise.resolve();
    vi.stubGlobal('navigator', {
      locks: {
        request: (_name: string, operation: () => Promise<unknown>) => {
          const next = queue.then(operation);
          queue = next.then(
            () => undefined,
            () => undefined,
          );
          return next;
        },
      },
    });
    let release!: () => void;
    let cookie = 'old';
    let aborted = false;
    const client = {
      refresh: vi.fn(
        (_type: string, _token: undefined, options: { signal?: AbortSignal }) =>
          new Promise<LoginResponse>((resolve, reject) => {
            options.signal?.addEventListener('abort', () => {
              aborted = true;
              reject(new ApiError('cancelled', 'Aborted'));
            });
            release = () => {
              cookie = 'rotated';
              resolve(result('new'));
            };
          }),
      ),
      logout: vi.fn(async () => {
        expect(cookie).toBe('rotated');
      }),
    };
    const manager = new WebSession('https://api.example.test', client as never);
    manager.accept(result('old'));
    const adapter = manager.adapter();
    const refresh = expect(adapter.refreshAccessToken('old')).rejects.toMatchObject({
      code: 'cancelled',
    });
    await vi.waitFor(() => expect(client.refresh).toHaveBeenCalledOnce());
    const logout = manager.logout();
    expect(adapter.signal.aborted).toBe(true);
    expect(manager.getSnapshot().token).toBeNull();
    expect(aborted).toBe(false);
    expect(client.logout).not.toHaveBeenCalled();
    release();
    await Promise.all([refresh, logout]);
    expect(client.logout).toHaveBeenCalledOnce();
    expect(manager.getSnapshot().token).toBeNull();
  });

  it('retains the session after a temporary refresh error and permits retry', async () => {
    const client = {
      refresh: vi
        .fn()
        .mockRejectedValueOnce(new ApiError('network', 'Offline'))
        .mockResolvedValueOnce(result('new')),
    };
    const manager = new WebSession('https://api.example.test', client as never);
    manager.accept(result('old'));
    await expect(manager.adapter().refreshAccessToken('old')).rejects.toMatchObject({
      code: 'network',
    });
    expect(manager.getSnapshot().token).toBe('old');
    expect(await manager.adapter().refreshAccessToken('old')).toBe('new');
    manager.dispose();
  });

  it('expires only the active session and rejects adapters from a previous account', () => {
    const manager = new WebSession('https://api.example.test', {} as never);
    manager.accept(result('old'));
    const old = manager.adapter();
    manager.clear(false);
    manager.accept({ ...result('other'), user: { ...result('other').user, id: 'other-user' } });
    old.onUnauthorized('old');
    expect(manager.getSnapshot().token).toBe('other');
    expect(() => old.getAccessToken('old')).toThrow(ApiError);
    manager.dispose();
  });

  it('serializes cookie rotation across managers using the browser lock', async () => {
    let queue = Promise.resolve();
    const request = vi.fn((_name: string, operation: () => Promise<unknown>) => {
      const next = queue.then(operation);
      queue = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    });
    vi.stubGlobal('navigator', { locks: { request } });
    let release!: (value: LoginResponse) => void;
    const client = {
      refresh: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<LoginResponse>((resolve) => {
              release = resolve;
            }),
        )
        .mockResolvedValueOnce(result('newer')),
    };
    const first = new WebSession('https://api.example.test', client as never);
    const second = new WebSession('https://api.example.test', client as never);
    first.accept(result('old'));
    second.accept(result('old'));
    const one = first.adapter().refreshAccessToken('old');
    const two = second.adapter().refreshAccessToken('old');
    await vi.waitFor(() => expect(client.refresh).toHaveBeenCalledOnce());
    release(result('new'));
    expect(await one).toBe('new');
    expect(await two).toBe('newer');
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('keeps local logout effective even when storage and server revocation are unavailable', async () => {
    vi.stubGlobal('localStorage', {
      setItem: () => {
        throw new Error('Storage denied');
      },
    });
    const client = {
      logout: vi.fn().mockRejectedValue(new ApiError('network', 'offline')),
      refresh: vi.fn(),
    };
    const manager = new WebSession('https://api.example.test', client as never);
    manager.accept(result('old'));
    await expect(manager.logout()).rejects.toMatchObject({ code: 'network' });
    expect(await manager.restore()).toBeNull();
    expect(client.refresh).not.toHaveBeenCalled();
    expect(manager.getSnapshot().logoutUnconfirmed).toBe(true);
  });
});
