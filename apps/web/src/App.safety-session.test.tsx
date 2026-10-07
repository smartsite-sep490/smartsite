// @vitest-environment jsdom
import { useState } from 'react';
import { act } from '@testing-library/react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
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
  cache.setQueryData(['auth', 'session'], { accessToken: 'test-token', user });
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
  expect(await screen.findByText('No incidents found.')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Sign out Representative' }));
  await waitFor(() => expect(logout).toHaveBeenCalledOnce());
  expect(await screen.findByRole('button', { name: 'Sign In' })).not.toBeNull();
  expect(screen.queryByRole('button', { name: 'Sign out Representative' })).toBeNull();
  expect(cache.getQueryCache().findAll({ queryKey: ['safety-workflow'] })).toHaveLength(0);
  expect(cache.getQueryData(['auth', 'me', 'http://localhost:3000'])).toBeUndefined();
  expect(sessionStorage.getItem('smartsite:signed-out')).toBe('true');
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
  expect(await screen.findByRole('button', { name: 'Sign In' })).not.toBeNull();
  expect(refresh).not.toHaveBeenCalled();
});

it('login animation cannot navigate back to Dashboard after opening Safety', async () => {
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
  cache.setQueryData(['auth', 'session'], null);
  vi.spyOn(api, 'getBackendHealth').mockResolvedValue({
    status: 'ok',
    service: 'smartsite-backend',
  });
  vi.spyOn(api.SmartSiteManagementClient.prototype, 'me').mockResolvedValue(user);
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
  vi.spyOn(api.SmartSiteManagementClient.prototype, 'listIncidents').mockResolvedValue({
    items: [],
    total: 0,
  });
  function OpenSafety() {
    const navigate = useNavigate();
    return <button onClick={() => navigate('/incidents')}>Open Safety</button>;
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
  fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'test-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
  await screen.findByRole('heading', { name: 'Site Operational Overview' });
  fireEvent.click(screen.getByRole('button', { name: 'Open Safety' }));
  await screen.findByRole('button', { name: 'Sign out Representative' });
  act(() => {
    for (const callback of animations.callbacks) callback();
  });
  expect(screen.getByRole('button', { name: 'Sign out Representative' })).not.toBeNull();
});
