// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError, SmartSiteManagementClient } from '@smartsite/api-client';
import { AuthContext } from './features/auth/auth-session';
import { App } from './app';

const controls = vi.hoisted(() => ({ signOut: vi.fn(), expired: vi.fn() }));
vi.mock('@smartsite/api-client', async () => ({
  ...(await vi.importActual<typeof import('@smartsite/api-client')>('@smartsite/api-client')),
  getBackendHealth: vi.fn().mockResolvedValue({ status: 'ok', service: 'smartsite-backend' }),
}));
vi.mock('./features/auth/auth-session', async () => ({
  ...(await vi.importActual<typeof import('./features/auth/auth-session')>(
    './features/auth/auth-session',
  )),
  useRestoreSession: () => ({ isLoading: false }),
  useLogout: () => ({ mutate: controls.signOut }),
}));
vi.mock('./components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock('./components/zones/RestrictedZoneView', () => ({
  RestrictedZoneView: () => <h2>Protected zone content</h2>,
}));
vi.mock('./components/alerts/SafetyAlertsView', () => ({
  SafetyAlertsView: () => <h2>Protected evidence content</h2>,
}));

const profile = {
  id: 'synthetic-user',
  username: 'synthetic',
  displayName: 'Synthetic Officer',
  isActive: true,
  mustChangePassword: false,
  roleAssignments: [],
};
let queryClient: QueryClient;
let fetchFixture: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;
beforeEach(() => {
  vi.clearAllMocks();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  fetchFixture = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(
      new Response(JSON.stringify(profile), { headers: { 'Content-Type': 'application/json' } }),
    );
  vi.stubGlobal('fetch', fetchFixture);
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function renderRoute(path = '/zones') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider
          value={{
            accessToken: 'synthetic-token',
            sessionScope: 'synthetic-scope',
            setAccessToken: vi.fn(),
            isSessionExpired: false,
            triggerSessionExpired: controls.expired,
            dismissSessionExpired: vi.fn(),
          }}
        >
          <App />
        </AuthContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

it.each([
  [
    new ApiError('http', 'private-profile-canary', 401),
    'Your session is no longer valid. Sign in again.',
    true,
  ],
  [
    new ApiError('http', 'private-profile-canary', 403),
    'This account cannot access the current user profile. Sign out and sign in with an authorized account.',
    true,
  ],
  [
    new ApiError('network', 'private-profile-canary'),
    'Cannot reach the sign-in service. Check your connection and try again.',
    false,
  ],
  [
    new ApiError('timeout', 'private-profile-canary'),
    'Loading your profile timed out. Please try again.',
    false,
  ],
  [
    new ApiError('http', 'private-profile-canary', 503),
    'The sign-in service is temporarily unavailable. Please try again.',
    false,
  ],
  [
    new ApiError('invalid-response', 'private-profile-canary'),
    'The sign-in service returned an invalid profile. Please try again.',
    false,
  ],
  [new Error('private-profile-canary'), 'Could not load your profile. Please try again.', false],
] as const)('provides safe profile recovery for %s', async (error, message, denied) => {
  const me = vi.spyOn(SmartSiteManagementClient.prototype, 'me').mockRejectedValue(error);
  const user = userEvent.setup();
  renderRoute();
  expect((await screen.findByRole('alert')).textContent).toContain(message);
  expect(document.body.textContent).not.toContain('private-profile-canary');
  expect(screen.queryByText('Protected zone content')).toBeNull();
  const retry = screen.getByRole('button', { name: 'Retry' }) as HTMLButtonElement;
  expect(retry.disabled).toBe(denied);
  if (denied) {
    await user.click(retry);
    expect(me).toHaveBeenCalledTimes(1);
  }
  await user.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(controls.signOut).toHaveBeenCalledTimes(1);
});

it.each([
  ['/zones', 'Protected zone content', 403],
  ['/zones', 'Protected zone content', 503],
  ['/incidents', 'Protected evidence content', 403],
  ['/incidents', 'Protected evidence content', 503],
] as const)(
  'hides cached protected content after profile revalidation fails: %s %s %s',
  async (path, title, status) => {
    renderRoute(path);
    expect(await screen.findByRole('heading', { name: title })).toBeDefined();
    fetchFixture.mockResolvedValue(
      new Response(JSON.stringify({ message: 'private-profile-canary' }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
    });
    // TanStack preserves successful cached data on a failed background refetch.
    expect(queryClient.getQueriesData({ queryKey: ['auth', 'me'] })[0]?.[1]).toEqual(profile);
    expect(await screen.findByRole('alert')).toBeDefined();
    expect(screen.queryByRole('heading', { name: title })).toBeNull();
    expect(document.body.textContent).not.toContain('private-profile-canary');
  },
);

it('keeps cached content blocked and prevents duplicate retries until a fresh profile succeeds', async () => {
  const user = userEvent.setup();
  renderRoute();
  await screen.findByText('Protected zone content');
  fetchFixture.mockResolvedValue(new Response('{}', { status: 503 }));
  await act(async () => {
    await queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
  });
  await screen.findByRole('alert');
  let finish!: (response: Response) => void;
  fetchFixture.mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(fetchFixture).toHaveBeenCalledTimes(3));
  const retry = screen.getByRole('button', { name: 'Retrying…' }) as HTMLButtonElement;
  expect(retry.disabled).toBe(true);
  await user.click(retry);
  expect(fetchFixture).toHaveBeenCalledTimes(3);
  expect(screen.queryByText('Protected zone content')).toBeNull();
  await act(async () => {
    finish(new Response(JSON.stringify(profile)));
  });
  expect(await screen.findByText('Protected zone content')).toBeDefined();
  expect(screen.queryByRole('alert')).toBeNull();
});
