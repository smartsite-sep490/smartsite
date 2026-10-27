// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import type { LoginResponse } from '@smartsite/api-client';
import { AuthContext } from './auth-session';
import { WebSession } from './web-session';
import { WorkerAbsenceSummary } from '../../components/workforce/components/WorkerAbsenceSummary';

const apiUrl = 'https://api.example.test';
const response: LoginResponse = {
  accessToken: 'expired-access',
  tokenType: 'Bearer',
  accessTokenExpiresAt: '2026-10-18T00:15:00Z',
  refreshTokenExpiresAt: '2026-11-17T00:00:00Z',
  user: {
    id: 'worker-user',
    username: 'synthetic-worker',
    displayName: 'Synthetic Worker',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [{ role: 'WORKER', siteId: 'site' }],
  },
};
let cache: QueryClient;
afterEach(() => {
  cleanup();
  cache?.clear();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

function mount() {
  const manager = new WebSession(apiUrl);
  manager.accept(response);
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cache}>
      <AuthContext.Provider
        value={{
          manager,
          epoch: manager.getSnapshot().epoch,
          accessToken: response.accessToken,
          setAccessToken: manager.setAccessToken.bind(manager),
          isSessionExpired: false,
          triggerSessionExpired: vi.fn(),
          dismissSessionExpired: vi.fn(),
        }}
      >
        <WorkerAbsenceSummary
          apiUrl={apiUrl}
          token={response.accessToken}
          siteId="site"
          workerId="worker"
          sessionScope="worker-user"
        />
      </AuthContext.Provider>
    </QueryClientProvider>,
  );
  return manager;
}

it('refreshes an expired credential and displays the worker absence data without ending the session', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/auth/refresh'))
        return Response.json({ ...response, accessToken: 'renewed-access' });
      if (new Headers(init.headers).get('Authorization') === 'Bearer expired-access')
        return new Response('{}', { status: 401 });
      return Response.json({ items: [], total: 7 });
    }),
  );
  const manager = mount();
  await waitFor(() => expect(screen.getByText('7')).toBeTruthy());
  expect(calls).toHaveLength(3);
  expect(calls[1]?.url).toBe(`${apiUrl}/api/v1/auth/refresh`);
  expect(calls[1]?.init.credentials).toBe('include');
  expect(JSON.parse(calls[1]!.init.body as string)).toEqual({ clientType: 'WEB' });
  expect(calls[2]?.url).toBe(calls[0]?.url);
  expect(new Headers(calls[2]?.init.headers).get('Authorization')).toBe('Bearer renewed-access');
  expect(manager.getSnapshot()).toMatchObject({ token: 'renewed-access', expired: false });
  expect(screen.queryByRole('alert')).toBeNull();
});

it.each([401, 503])('handles refresh HTTP %s without retrying indefinitely', async (status) => {
  const fetch = vi.fn(
    async (url: string) =>
      new Response('{}', {
        status: url.endsWith('/auth/refresh') ? status : 401,
      }),
  );
  vi.stubGlobal('fetch', fetch);
  const manager = mount();
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(manager.getSnapshot()).toMatchObject(
    status === 401 ? { token: null, expired: true } : { token: 'expired-access', expired: false },
  );
});
