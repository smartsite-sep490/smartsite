// @vitest-environment jsdom
import { useState } from 'react';
import { act } from '@testing-library/react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { it, expect, vi, afterEach } from 'vitest';
import * as api from '@smartsite/api-client';
import { AuthContext, AuthProvider } from './features/auth/auth-session';
import { App } from './app';
const animations = vi.hoisted(() => ({ callbacks: [] as (() => void)[] }));
vi.mock('@gsap/react', () => ({ useGSAP: () => undefined }));
vi.mock('gsap', () => ({
  default: {
    registerPlugin: vi.fn(),
    set: vi.fn(),
    to: (_target: unknown, options: { onComplete?: () => void }) => {
      if (options.onComplete) animations.callbacks.push(options.onComplete);
    },
    timeline: () => {
      const chain = { to: () => chain };
      return chain;
    },
  },
}));
vi.mock('./components/landing/LandingPage', () => ({ LandingPage: () => <div>Landing</div> }));
vi.mock('./components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
  animations.callbacks.length = 0;
});

it('App clears the authenticated Safety workspace even when server logout fails', async () => {
  const user = {
    id: 'representative',
    username: 'rep',
    displayName: 'Representative',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [{ role: 'CONTRACTOR_REPRESENTATIVE' as const, siteId: 'site' }],
  };
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  cache.setQueryData(['auth', 'session', 'http://localhost:3000', 0], true);
  vi.spyOn(api, 'getBackendHealth').mockResolvedValue({
    status: 'ok',
    service: 'smartsite-backend',
  });
  vi.spyOn(api.SmartSiteManagementClient.prototype, 'me').mockResolvedValue(user);
  vi.spyOn(api.SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
    items: [{ id: 'site', code: 'A', name: 'Site A', createdAt: '2026-10-05T00:00:00Z' }],
    total: 1,
  });
  vi.spyOn(api.SmartSiteManagementClient.prototype, 'listIncidents').mockResolvedValue({
    items: [],
    total: 0,
  });
  const logout = vi
    .spyOn(api.SmartSiteManagementClient.prototype, 'logout')
    .mockRejectedValue(new Error('Network unavailable'));
  function Session() {
    const [accessToken, setAccessToken] = useState<string | null>('test-token');
    return (
      <AuthContext.Provider
        value={{
          accessToken,
          sessionScope: accessToken ? 'synthetic-app-safety-scope' : '',
          setAccessToken,
          isSessionExpired: false,
          triggerSessionExpired: vi.fn(),
          dismissSessionExpired: vi.fn(),
        }}
      >
        <App />
      </AuthContext.Provider>
    );
  }
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={['/incidents']}>
        <Session />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText('No incidents found.', {}, { timeout: 8000 })).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Sign out Representative' }));
  await waitFor(() => expect(logout).toHaveBeenCalledOnce());
  expect(await screen.findByRole('button', { name: /^sign in$/i })).not.toBeNull();
  expect(screen.queryByRole('button', { name: 'Sign out Representative' })).toBeNull();
  expect(cache.getQueryCache().findAll({ queryKey: ['safety-workflow'] })).toHaveLength(0);
  const profileQueries = cache
    .getQueryCache()
    .findAll({ queryKey: ['auth', 'me', 'http://localhost:3000'] });
  expect(
    profileQueries.filter((query) => query.queryKey[3] === 'synthetic-app-safety-scope'),
  ).toHaveLength(0);
  expect(profileQueries.every((query) => query.state.data === undefined)).toBe(true);
  expect(sessionStorage.getItem('smartsite:logout:http://localhost:3000')).toBe('1');
  cleanup();
  const refresh = vi.spyOn(api.SmartSiteManagementClient.prototype, 'refresh');
  const freshCache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={freshCache}>
      <MemoryRouter initialEntries={['/incidents']}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByRole('button', { name: /^sign in$/i })).not.toBeNull();
  expect(refresh).not.toHaveBeenCalled();
});

it('an account refresh after sign-in cannot navigate back to Dashboard after opening Safety', async () => {
  const user = {
    id: 'representative',
    username: 'rep',
    displayName: 'Representative',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [{ role: 'CONTRACTOR_REPRESENTATIVE' as const, siteId: 'site' }],
  };
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  cache.setQueryData(['auth', 'session', 'http://localhost:3000', 0], null);
  vi.spyOn(api, 'getBackendHealth').mockResolvedValue({
    status: 'ok',
    service: 'smartsite-backend',
  });
  const me = vi.spyOn(api.SmartSiteManagementClient.prototype, 'me').mockResolvedValue(user);
  vi.spyOn(api.SmartSiteManagementClient.prototype, 'login').mockResolvedValue({
    accessToken: 'test-token',
    tokenType: 'Bearer',
    accessTokenExpiresAt: '2026-10-06T10:00:00Z',
    refreshTokenExpiresAt: '2026-10-07T10:00:00Z',
    user,
  });
  vi.spyOn(api.SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
    items: [{ id: 'site', code: 'A', name: 'Site A', createdAt: '2026-10-05T00:00:00Z' }],
    total: 1,
  });
  vi.spyOn(api.SmartSiteManagementClient.prototype, 'contractorDashboardScopes').mockResolvedValue({
    items: [
      {
        siteId: 'site',
        siteName: 'Site A',
        siteCode: 'A',
        contractorId: 'c1',
        contractorName: 'Contractor 1',
      },
    ],
  });
  vi.spyOn(api.SmartSiteManagementClient.prototype, 'contractorDashboard').mockResolvedValue({
    scope: {
      siteId: 'site',
      siteName: 'Site A',
      siteCode: 'A',
      contractorId: 'c1',
      contractorName: 'Contractor 1',
    },
    workerCount: 10,
    teamCount: 2,
    unassignedWorkerCount: 0,
  });
  vi.spyOn(api.SmartSiteManagementClient.prototype, 'listContractorTeams').mockResolvedValue({
    items: [],
    total: 0,
  });
  vi.spyOn(api.SmartSiteManagementClient.prototype, 'listIncidents').mockResolvedValue({
    items: [],
    total: 0,
  });
  function OpenSafety() {
    const navigate = useNavigate();
    const location = useLocation();
    return (
      <>
        <button onClick={() => navigate('/incidents')}>Open Safety</button>
        <output data-testid="safety-location">{location.pathname}</output>
      </>
    );
  }
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={['/login']}>
        <AuthProvider>
          <OpenSafety />
          <App />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.change(await screen.findByPlaceholderText('Enter your username'), {
    target: { value: 'rep' },
  });
  fireEvent.change(screen.getByLabelText(/^password$/i), { target: { value: 'test-password' } });
  fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
  await screen.findByRole('heading', { name: /Site A/i }, { timeout: 8000 });
  fireEvent.click(screen.getByRole('button', { name: 'Open Safety' }));
  await screen.findByRole('button', { name: 'Sign out Representative' });
  const callsBeforeRefresh = me.mock.calls.length;
  await act(async () => {
    await cache.invalidateQueries({ queryKey: ['auth', 'me'] });
  });
  await waitFor(() => expect(me.mock.calls.length).toBeGreaterThan(callsBeforeRefresh));
  expect(screen.getByTestId('safety-location').textContent).toBe('/incidents');
  expect(screen.getByRole('button', { name: 'Sign out Representative' })).not.toBeNull();
});
