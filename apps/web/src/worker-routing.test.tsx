// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { App } from './app';

const state = vi.hoisted(() => ({
  accessToken: null as string | null,
  restoring: false,
  profile: undefined as { roleAssignments: { role: string; siteId: string | null }[] } | undefined,
  profilePending: true,
  profileError: false,
  refetch: vi.fn(),
  dashboardRender: vi.fn(),
  loginSuccess: undefined as (() => void) | undefined,
}));

vi.mock('./features/auth/auth-session', () => ({
  useAuth: () => ({
    accessToken: state.accessToken,
    isSessionExpired: false,
    dismissSessionExpired: vi.fn(),
  }),
  useLogout: () => ({ mutate: vi.fn() }),
  useRestoreSession: () => ({ isLoading: state.restoring }),
  useCurrentUser: () => ({
    data: state.profile,
    isPending: state.profilePending,
    isError: state.profileError,
    refetch: state.refetch,
  }),
  SessionExpiredModal: () => null,
}));
vi.mock('./components/layout/AppLayout', () => ({
  AppLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('./components/dashboard/DashboardView', () => ({
  DashboardView: () => {
    state.dashboardRender();
    return <div>Management dashboard</div>;
  },
}));
vi.mock('./components/workforce/components/WorkforceView', () => ({
  WorkforceView: () => <div>Worker schedule</div>,
}));
vi.mock('./components/contractor/ContractorDashboardView', () => ({
  ContractorDashboardView: () => <div>Contractor teams</div>,
}));
vi.mock('./components/access/AccessControlView', () => ({
  AccessControlView: () => <div>Scoped Site access</div>,
}));
vi.mock('./components/workforce/components/SiteSetupView', () => ({
  SiteSetupView: () => <div>Site Manager setup</div>,
}));
vi.mock('./components/landing/LandingPage', () => ({
  LandingPage: () => <div>Public landing page</div>,
}));
vi.mock('./features/auth/LoginScreen', () => ({
  LoginScreen: ({ onLoginSuccess }: { onLoginSuccess?: () => void }) => {
    state.loginSuccess = onLoginSuccess;
    return <div>Sign in form</div>;
  },
}));
vi.mock('@smartsite/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@smartsite/api-client')>()),
  getBackendHealth: vi.fn().mockResolvedValue({ status: 'ok' }),
}));

let queries: QueryClient;
function Location() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}
function mount(path: string) {
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = () => (
    <QueryClientProvider client={queries}>
      <MemoryRouter initialEntries={[path]}>
        <App />
        <Location />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const result = render(view());
  return () => result.rerender(view());
}
function profile(roles: string[]) {
  state.profile = {
    roleAssignments: roles.map((role) => ({ role, siteId: role === 'ADMIN' ? null : 'site-1' })),
  };
  state.profilePending = false;
}
beforeEach(() => {
  state.accessToken = null;
  state.restoring = false;
  state.profile = undefined;
  state.profilePending = true;
  state.profileError = false;
  state.refetch.mockReset();
  state.dashboardRender.mockReset();
  state.loginSuccess = undefined;
});
afterEach(() => {
  cleanup();
  queries?.clear();
});

it('waits for the Worker profile after login without rendering Dashboard', async () => {
  const refresh = mount('/login');
  expect(await screen.findByText('Sign in form')).toBeTruthy();
  state.accessToken = 'synthetic-token';
  refresh();
  expect(screen.getByRole('status')).toBeTruthy();
  expect(screen.getByTestId('location').textContent).toBe('/login');
  expect(state.dashboardRender).not.toHaveBeenCalled();
  profile(['WORKER']);
  refresh();
  await screen.findByText('Worker schedule');
  expect(screen.getByTestId('location').textContent).toBe('/workforce');
  expect(state.dashboardRender).not.toHaveBeenCalled();
});

it('does not let a delayed login callback use a stale Dashboard default', async () => {
  const refresh = mount('/login');
  const delayedSuccess = state.loginSuccess;
  state.accessToken = 'synthetic-token';
  profile(['WORKER']);
  refresh();
  await screen.findByText('Worker schedule');
  delayedSuccess?.();
  await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/workforce'));
  expect(state.dashboardRender).not.toHaveBeenCalled();
});

it('redirects a Worker opening or refreshing /dashboard to /workforce', async () => {
  state.accessToken = 'synthetic-token';
  const refresh = mount('/dashboard');
  expect(state.dashboardRender).not.toHaveBeenCalled();
  profile(['WORKER']);
  refresh();
  await screen.findByText('Worker schedule');
  expect(state.dashboardRender).not.toHaveBeenCalled();
});

it.each(['WORKER', 'CONTRACTOR_REPRESENTATIVE'])(
  'blocks direct safety URLs for %s',
  async (role) => {
    state.accessToken = 'synthetic-token';
    profile([role]);
    mount('/incidents');
    await screen.findByText(role === 'WORKER' ? 'Worker schedule' : 'Contractor teams');
    expect(screen.getByTestId('location').textContent).toBe(
      role === 'WORKER' ? '/workforce' : '/contractor-teams',
    );
  },
);

it.each(['ADMIN', 'SITE_MANAGER'])(
  'retains Dashboard for %s after profile loading',
  async (role) => {
    state.accessToken = 'synthetic-token';
    profile([role]);
    mount('/login');
    await screen.findByText('Management dashboard');
    expect(screen.getByTestId('location').textContent).toBe('/dashboard');
  },
);

it.each(['/workforce', '/schedule-setup'])(
  'redirects an Admin-only account opening %s to Dashboard',
  async (path) => {
    state.accessToken = 'synthetic-token';
    profile(['ADMIN']);
    mount(path);
    await screen.findByText('Management dashboard');
    expect(screen.getByTestId('location').textContent).toBe('/dashboard');
  },
);

it('fails closed with Retry if the profile is unavailable', async () => {
  state.accessToken = 'synthetic-token';
  state.profilePending = false;
  state.profileError = true;
  mount('/dashboard');
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(state.dashboardRender).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(state.refetch).toHaveBeenCalledOnce();
});

it('redirects unauthenticated visitors to login', async () => {
  mount('/dashboard');
  await screen.findByText('Sign in form');
  expect(state.dashboardRender).not.toHaveBeenCalled();
});

it.each(['/access', '/workforce'])(
  'retains Site Manager access to %s with its scoped capabilities',
  async (path) => {
    state.accessToken = 'synthetic-token';
    profile(['SITE_MANAGER']);
    mount(path);
    await screen.findByText(path === '/access' ? 'Scoped Site access' : 'Worker schedule');
    expect(screen.getByTestId('location').textContent).toBe(path);
  },
);

it('keeps an existing Worker schedule URL when the restored profile loads', async () => {
  state.accessToken = 'synthetic-token';
  state.restoring = true;
  const refresh = mount('/workforce');
  expect(screen.queryByText('Worker schedule')).toBeNull();
  state.restoring = false;
  profile(['WORKER']);
  refresh();
  await screen.findByText('Worker schedule');
  expect(screen.getByTestId('location').textContent).toBe('/workforce');
});
