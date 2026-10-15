// @vitest-environment jsdom
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode, useEffect, useLayoutEffect, useRef } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import {
  AuthProvider,
  useAuth,
  useCurrentUser,
  useLogin,
  useLogout,
  useRestoreSession,
} from './auth-session';

// Real shared-client fetch against an isolated HTTP fixture. No runtime DB,
// cookies, AI service or production credential is involved in these tests.
let server: Server;
let baseUrl: string;
let providerApiUrl: string;
let queryClient: QueryClient;
let handle: (request: IncomingMessage, response: ServerResponse, body: string) => void;
const responseFor = (name: string) => ({
  accessToken: `synthetic-${name}-token`,
  tokenType: 'Bearer',
  accessTokenExpiresAt: '2026-10-10T00:00:00Z',
  refreshTokenExpiresAt: '2026-10-11T00:00:00Z',
  user: {
    id: name,
    username: name,
    displayName: name,
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: 'synthetic-site' }],
  },
});
function reply(response: ServerResponse, status: number, data: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(data));
}
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider apiUrl={providerApiUrl}>{children}</AuthProvider>
  </QueryClientProvider>
);
const credentials = { username: 'new-account', password: 'Synthetic1!' };

beforeEach(async () => {
  sessionStorage.clear();
  vi.restoreAllMocks();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  handle = (request, response) => {
    if (request.url?.endsWith('/auth/login')) reply(response, 200, responseFor('new-account'));
    else if (request.url?.endsWith('/auth/refresh'))
      reply(response, 401, { message: 'Unauthorized' });
    else if (request.url?.endsWith('/auth/logout')) response.writeHead(204).end();
    else if (request.url?.endsWith('/auth/me'))
      reply(response, 200, responseFor('new-account').user);
    else reply(response, 404, {});
  };
  server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on('end', () => handle(request, response, body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  providerApiUrl = baseUrl;
});
afterEach(async () => {
  cleanup();
  queryClient.clear();
  sessionStorage.clear();
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

it('does not silently restore the cookie session after failed logout and a fresh app mount', async () => {
  let refreshCalls = 0;
  handle = (request, response) => {
    if (request.url?.endsWith('/auth/refresh')) {
      refreshCalls += 1;
      reply(response, 200, responseFor('old-account'));
    } else reply(response, 503, { message: 'Unavailable' });
  };
  const first = renderHook(() => ({ auth: useAuth(), logout: useLogout(baseUrl) }), { wrapper });
  act(() => first.result.current.auth.setAccessToken('synthetic-old-token'));
  await act(async () => {
    await first.result.current.logout.mutateAsync().catch(() => undefined);
  });
  first.unmount();
  queryClient.clear();
  const next = renderHook(() => ({ auth: useAuth(), restore: useRestoreSession(baseUrl) }), {
    wrapper,
  });
  await waitFor(() => expect(next.result.current.restore.isFetching).toBe(false));
  expect(refreshCalls).toBe(0);
  expect(next.result.current.auth.accessToken).toBeNull();
});

it('isolates restore requests across API endpoints and ignores a late prior endpoint response', async () => {
  providerApiUrl = `${baseUrl}/old`;
  const refreshObserver = vi.spyOn(SmartSiteManagementClient.prototype, 'refresh');
  let oldRefresh: ServerResponse | undefined;
  handle = (request, response) => {
    if (request.url?.startsWith('/old/')) oldRefresh = response;
    else reply(response, 200, responseFor('new-account'));
  };
  const { result, rerender } = renderHook(
    ({ apiUrl }) => ({ auth: useAuth(), restore: useRestoreSession(apiUrl) }),
    {
      wrapper,
      initialProps: { apiUrl: `${baseUrl}/old` },
    },
  );
  await waitFor(() => expect(oldRefresh).toBeDefined());
  providerApiUrl = `${baseUrl}/new`;
  rerender({ apiUrl: `${baseUrl}/new` });
  await waitFor(() =>
    expect(result.current.auth.accessToken).toBe(responseFor('new-account').accessToken),
  );
  await act(async () => {
    reply(oldRefresh!, 200, responseFor('old-account'));
    await refreshObserver.mock.results[0]!.value;
  });
  expect(result.current.auth.accessToken).toBe(responseFor('new-account').accessToken);
});

it.each([200, 401])(
  'allows automatic restore again only after an explicit successful login, HTTP %s',
  async (status) => {
    let refreshCalls = 0;
    handle = (request, response) => {
      if (request.url?.endsWith('/auth/logout')) reply(response, 503, { message: 'Unavailable' });
      else if (request.url?.endsWith('/auth/login'))
        reply(
          response,
          status,
          status === 200 ? responseFor('new-account') : { message: 'Unauthorized' },
        );
      else {
        refreshCalls += 1;
        reply(response, 200, responseFor('new-account'));
      }
    };
    const first = renderHook(
      () => ({ auth: useAuth(), login: useLogin(baseUrl), logout: useLogout(baseUrl) }),
      { wrapper },
    );
    act(() => first.result.current.auth.setAccessToken('synthetic-old-token'));
    await act(async () => {
      await first.result.current.logout.mutateAsync().catch(() => undefined);
    });
    await act(async () => {
      await first.result.current.login.mutateAsync(credentials).catch(() => undefined);
    });
    first.unmount();
    queryClient.clear();
    const next = renderHook(() => ({ auth: useAuth(), restore: useRestoreSession(baseUrl) }), {
      wrapper,
    });
    await waitFor(() => expect(next.result.current.restore.isFetching).toBe(false));
    expect(refreshCalls).toBe(status === 200 ? 1 : 0);
    expect(next.result.current.auth.accessToken).toBe(
      status === 200 ? responseFor('new-account').accessToken : null,
    );
  },
);

it('clears credentials and sensitive caches before a slow logout reaches the server, even if it fails', async () => {
  let pendingLogout: ServerResponse | undefined;
  const original = handle;
  handle = (request, response, body) => {
    if (request.url?.endsWith('/auth/logout')) pendingLogout = response;
    else original(request, response, body);
  };
  const { result } = renderHook(() => ({ auth: useAuth(), logout: useLogout(baseUrl) }), {
    wrapper,
  });
  act(() => result.current.auth.setAccessToken('synthetic-current-token'));
  queryClient.setQueryData(['safety-alert-evidence', 'old-scope'], new Blob(['private-fixture']));
  let outcome!: Promise<unknown>;
  act(() => {
    outcome = result.current.logout.mutateAsync().catch((error: unknown) => error);
  });
  await waitFor(() => expect(pendingLogout).toBeDefined());
  expect(result.current.auth.accessToken).toBeNull();
  expect(queryClient.getQueryData(['safety-alert-evidence', 'old-scope'])).toBeUndefined();
  await act(async () => {
    reply(pendingLogout!, 503, { message: 'Unavailable' });
    await outcome;
  });
  expect(result.current.auth.accessToken).toBeNull();
});

it.each([200, 401])('ignores a late restore HTTP %s after a new login succeeds', async (status) => {
  const refreshObserver = vi.spyOn(SmartSiteManagementClient.prototype, 'refresh');
  let pendingRefresh: ServerResponse | undefined;
  const original = handle;
  handle = (request, response, body) => {
    if (request.url?.endsWith('/auth/refresh')) pendingRefresh = response;
    else original(request, response, body);
  };
  const { result } = renderHook(
    () => ({ auth: useAuth(), restore: useRestoreSession(baseUrl), login: useLogin(baseUrl) }),
    { wrapper },
  );
  await waitFor(() => expect(pendingRefresh).toBeDefined());
  await act(async () => {
    await result.current.login.mutateAsync(credentials);
  });
  expect(result.current.auth.accessToken).toBe(responseFor('new-account').accessToken);
  await act(async () => {
    reply(
      pendingRefresh!,
      status,
      status === 200 ? responseFor('old-account') : { message: 'Expired' },
    );
    await refreshObserver.mock.results[0]!.value.catch(() => undefined);
  });
  await waitFor(() => expect(result.current.restore.isFetching).toBe(false));
  expect(result.current.auth.accessToken).toBe(responseFor('new-account').accessToken);
});

it('does not resurrect a session from a login response arriving after logout', async () => {
  let pendingLogin: ServerResponse | undefined;
  const original = handle;
  handle = (request, response, body) => {
    if (request.url?.endsWith('/auth/login')) pendingLogin = response;
    else original(request, response, body);
  };
  const { result } = renderHook(
    () => ({ auth: useAuth(), login: useLogin(baseUrl), logout: useLogout(baseUrl) }),
    { wrapper },
  );
  let outcome!: Promise<unknown>;
  act(() => {
    outcome = result.current.login.mutateAsync(credentials).catch((error: unknown) => error);
  });
  await waitFor(() => expect(pendingLogin).toBeDefined());
  await act(async () => {
    await result.current.logout.mutateAsync();
  });
  await act(async () => {
    reply(pendingLogin!, 200, responseFor('old-account'));
    await outcome;
  });
  expect(result.current.auth.accessToken).toBeNull();
});

it('does not let a late logout response clear a newer login', async () => {
  let pendingLogout: ServerResponse | undefined;
  const original = handle;
  handle = (request, response, body) => {
    if (request.url?.endsWith('/auth/logout')) pendingLogout = response;
    else original(request, response, body);
  };
  const { result } = renderHook(
    () => ({ auth: useAuth(), login: useLogin(baseUrl), logout: useLogout(baseUrl) }),
    { wrapper },
  );
  act(() => result.current.auth.setAccessToken('synthetic-old-token'));
  let logout!: Promise<unknown>;
  act(() => {
    logout = result.current.logout.mutateAsync();
  });
  await waitFor(() => expect(pendingLogout).toBeDefined());
  await act(async () => {
    await result.current.login.mutateAsync(credentials);
  });
  await act(async () => {
    pendingLogout!.writeHead(204).end();
    await logout;
  });
  expect(result.current.auth.accessToken).toBe(responseFor('new-account').accessToken);
});

it('keeps access tokens out of query and mutation response data', async () => {
  handle = (_request, response) => reply(response, 200, responseFor('new-account'));
  const { result } = renderHook(
    () => ({ restore: useRestoreSession(baseUrl), login: useLogin(baseUrl) }),
    { wrapper },
  );
  await waitFor(() => expect(result.current.restore.isFetching).toBe(false));
  await act(async () => {
    await result.current.login.mutateAsync(credentials);
  });
  const cachedData = [
    ...queryClient
      .getQueryCache()
      .getAll()
      .map((query) => query.state.data),
    ...queryClient
      .getMutationCache()
      .getAll()
      .map((mutation) => mutation.state.data),
  ];
  expect(JSON.stringify(cachedData)).not.toContain(responseFor('new-account').accessToken);
});

it('expires a current profile401 and removes other sensitive cached data', async () => {
  let pendingMe: ServerResponse | undefined;
  handle = (request, response) => {
    if (request.url?.endsWith('/auth/refresh')) reply(response, 401, { message: 'Unauthorized' });
    else pendingMe = response;
  };
  const { result } = renderHook(() => ({ auth: useAuth(), user: useCurrentUser(baseUrl) }), {
    wrapper,
  });
  act(() => result.current.auth.setAccessToken('synthetic-expiring-token'));
  await waitFor(() => expect(pendingMe).toBeDefined());
  queryClient.setQueryData(['safety-alert-evidence', 'old-scope'], new Blob(['private-fixture']));
  await act(async () => {
    reply(pendingMe!, 401, { message: 'Unauthorized' });
  });
  await waitFor(() => expect(result.current.auth.isSessionExpired).toBe(true));
  expect(result.current.auth.accessToken).toBeNull();
  expect(queryClient.getQueryData(['safety-alert-evidence', 'old-scope'])).toBeUndefined();
});

it('does not expire a newer login when an older authenticated metadata request returns401', async () => {
  let pendingMetadata: ServerResponse | undefined;
  const original = handle;
  handle = (request, response, body) => {
    if (request.url?.endsWith('/sites')) pendingMetadata = response;
    else original(request, response, body);
  };
  const { result } = renderHook(() => ({ auth: useAuth(), login: useLogin(baseUrl) }), { wrapper });
  act(() => result.current.auth.setAccessToken('synthetic-old-metadata-token'));
  const metadata = new SmartSiteManagementClient(baseUrl).listSites('synthetic-old-metadata-token');
  const outcome = metadata.catch((error: unknown) => error);
  await waitFor(() => expect(pendingMetadata).toBeDefined());
  await act(async () => {
    await result.current.login.mutateAsync(credentials);
  });
  expect(result.current.auth.accessToken).toBe(responseFor('new-account').accessToken);
  await act(async () => {
    reply(pendingMetadata!, 401, { message: 'Unauthorized' });
    await outcome;
  });
  expect(result.current.auth.accessToken).toBe(responseFor('new-account').accessToken);
  expect(result.current.auth.isSessionExpired).toBe(false);
});

it('expires the matching current credential on an authenticated metadata401', async () => {
  const original = handle;
  handle = (request, response, body) => {
    if (request.url?.endsWith('/sites')) reply(response, 401, { message: 'Unauthorized' });
    else original(request, response, body);
  };
  const { result } = renderHook(() => useAuth(), { wrapper });
  act(() => result.current.setAccessToken('synthetic-current-metadata-token'));
  await act(async () => {
    await new SmartSiteManagementClient(baseUrl)
      .listSites('synthetic-current-metadata-token')
      .catch(() => undefined);
  });
  expect(result.current.accessToken).toBeNull();
  expect(result.current.isSessionExpired).toBe(true);
});

it.each(['rotation', 'remount'] as const)(
  'ignores a held metadata401 after same-token %s',
  async (change) => {
    let pendingMetadata: ServerResponse | undefined;
    const original = handle;
    handle = (request, response, body) => {
      if (request.url?.endsWith('/sites')) pendingMetadata = response;
      else original(request, response, body);
    };
    let current = renderHook(() => useAuth(), { wrapper });
    act(() => current.result.current.setAccessToken('synthetic-reused-token'));
    const oldScope = current.result.current.sessionScope;
    const outcome = new SmartSiteManagementClient(baseUrl)
      .listSites('synthetic-reused-token')
      .catch(() => undefined);
    await waitFor(() => expect(pendingMetadata).toBeDefined());
    if (change === 'remount') {
      current.unmount();
      current = renderHook(() => useAuth(), { wrapper });
    }
    act(() => current.result.current.setAccessToken('synthetic-reused-token'));
    expect(current.result.current.sessionScope).not.toBe(oldScope);
    await act(async () => {
      reply(pendingMetadata!, 401, { message: 'Unauthorized' });
      await outcome;
    });
    expect(current.result.current.accessToken).toBe('synthetic-reused-token');
    expect(current.result.current.isSessionExpired).toBe(false);
  },
);

it('ignores old metadata401 while a newer login is still waiting for its response', async () => {
  let pendingMetadata: ServerResponse | undefined, pendingLogin: ServerResponse | undefined;
  handle = (request, response) => {
    if (request.url?.endsWith('/sites')) pendingMetadata = response;
    else if (request.url?.endsWith('/auth/login')) pendingLogin = response;
    else reply(response, 404, {});
  };
  const { result } = renderHook(() => ({ auth: useAuth(), login: useLogin(baseUrl) }), { wrapper });
  act(() => result.current.auth.setAccessToken('synthetic-overlap-old-token'));
  const metadata = new SmartSiteManagementClient(baseUrl)
    .listSites('synthetic-overlap-old-token')
    .catch(() => undefined);
  await waitFor(() => expect(pendingMetadata).toBeDefined());
  let login!: Promise<unknown>;
  act(() => {
    login = result.current.login.mutateAsync(credentials).catch((error: unknown) => error);
  });
  await waitFor(() => expect(pendingLogin).toBeDefined());
  await act(async () => {
    reply(pendingMetadata!, 401, { message: 'Unauthorized' });
    await metadata;
  });
  await act(async () => {
    reply(pendingLogin!, 200, responseFor('new-account'));
    await login;
  });
  expect(result.current.auth.accessToken).toBe(responseFor('new-account').accessToken);
  expect(result.current.auth.isSessionExpired).toBe(false);
});

it('does not treat an explicitly captured empty scope as the current later session', () => {
  const { result } = renderHook(() => useAuth(), { wrapper });
  const oldScope = result.current.sessionScope;
  expect(oldScope).toBe('');
  act(() => result.current.setAccessToken('synthetic-later-session'));
  act(() => result.current.triggerSessionExpired(oldScope));
  expect(result.current.accessToken).toBe('synthetic-later-session');
});

it('does not let an unscoped callback captured by an old render expire a later account', () => {
  const { result } = renderHook(() => useAuth(), { wrapper });
  const oldExpire = result.current.triggerSessionExpired;
  act(() => result.current.setAccessToken('synthetic-later-callback-session'));
  act(() => oldExpire());
  expect(result.current.accessToken).toBe('synthetic-later-callback-session');
});

it('expires a current401 started by a child passive effect during StrictMode replay', async () => {
  const responses: ServerResponse[] = [];
  handle = (_request, response) => {
    responses.push(response);
  };
  const strictWrapper = ({ children }: { children: React.ReactNode }) => (
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <AuthProvider apiUrl={baseUrl}>{children}</AuthProvider>
      </QueryClientProvider>
    </StrictMode>
  );
  const { result } = renderHook(
    () => {
      const auth = useAuth();
      const seeded = useRef(false);
      const setAccessToken = auth.setAccessToken;
      useLayoutEffect(() => {
        if (!seeded.current) {
          seeded.current = true;
          setAccessToken('synthetic-strict-token');
        }
      }, [setAccessToken]);
      useEffect(() => {
        void new SmartSiteManagementClient(baseUrl)
          .listSites('synthetic-strict-token')
          .catch(() => undefined);
      }, []);
      return auth;
    },
    { wrapper: strictWrapper, reactStrictMode: true },
  );
  await waitFor(() => expect(responses).toHaveLength(2));
  await act(async () => {
    reply(responses[0]!, 200, { items: [], total: 0 });
    reply(responses[1]!, 401, { message: 'Unauthorized' });
  });
  await waitFor(() => expect(result.current.accessToken).toBeNull());
  expect(result.current.isSessionExpired).toBe(true);
});
