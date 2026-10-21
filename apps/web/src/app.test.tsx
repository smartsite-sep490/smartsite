// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { App } from './app';
import type { RoleAssignmentResponse } from '@smartsite/contracts/management';

const accountState = vi.hoisted(() => ({
  mustChangePassword: false,
  roleAssignments: [] as RoleAssignmentResponse[],
}));

vi.mock('@smartsite/api-client', async () => {
  const actual =
    await vi.importActual<typeof import('@smartsite/api-client')>('@smartsite/api-client');
  return {
    ...actual,
    getBackendHealth: vi.fn().mockResolvedValue({ status: 'ok', service: 'smartsite-backend' }),
  };
});

vi.mock('./features/auth/auth-session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./features/auth/auth-session')>()),
  useAuth: () => ({
    accessToken: 'test-token',
    isSessionExpired: false,
    dismissSessionExpired: vi.fn(),
  }),
  useRestoreSession: () => ({ isLoading: false }),
  useLogout: () => ({ mutate: vi.fn() }),
  useCurrentUser: () => ({
    data: {
      roleAssignments: accountState.roleAssignments,
      mustChangePassword: accountState.mustChangePassword,
    },
  }),
  SessionExpiredModal: () => null,
}));

vi.mock('./features/auth/ChangePasswordScreen', () => ({
  ChangePasswordScreen: () => <h1>Change your temporary password</h1>,
}));

vi.mock('./components/access/AccessControlView', () => ({
  AccessControlView: () => <h1>Security site access</h1>,
}));

vi.mock('./components/landing/LandingPage', () => ({
  LandingPage: ({ onEnterApp }: { onEnterApp: (tab?: string) => void }) => (
    <div>
      <h1>Landing Page</h1>
      <button onClick={() => onEnterApp('ppe')}>Enter PPE</button>
      <button onClick={() => onEnterApp('incidents')}>Enter Incidents Direct</button>
    </div>
  ),
}));

vi.mock('./components/ppe/PpeMonitoringView', () => ({
  PpeMonitoringView: ({ onNavigate }: { onNavigate?: (tab: string, ctx?: unknown) => void }) => (
    <div>
      <h2>PPE Monitoring</h2>
      <button onClick={() => onNavigate?.('incidents', { alertType: 'PPE_VIOLATION' })}>
        Navigate with PPE context
      </button>
    </div>
  ),
}));

vi.mock('./components/zones/RestrictedZoneView', () => ({
  RestrictedZoneView: () => <div>Restricted Zones</div>,
}));

vi.mock('./components/alerts/SafetyAlertsView', () => ({
  SafetyAlertsView: ({
    initialType,
    initialSiteId,
    initialAlertId,
  }: {
    initialType?: string;
    initialSiteId?: string;
    initialAlertId?: string;
  }) => {
    const [type] = React.useState(initialType ?? 'ALL');
    const [site] = React.useState(initialSiteId ?? '');
    const [alert] = React.useState(initialAlertId ?? '');
    return (
      <div>
        <h2>Safety Alerts Queue</h2>
        <span data-testid="initial-type">{type}</span>
        <span data-testid="initial-site">{site}</span>
        <span data-testid="initial-alert">{alert}</span>
      </div>
    );
  },
}));

vi.mock('./components/layout/AppLayout', () => ({
  AppLayout: ({
    children,
    onSelectTab,
  }: {
    children: React.ReactNode;
    currentTab?: string;
    onSelectTab: (tab: string) => void;
  }) => (
    <div>
      <nav>
        <button onClick={() => onSelectTab('incidents')}>Sidebar Incidents</button>
        <button onClick={() => onSelectTab('ppe')}>Sidebar PPE</button>
      </nav>
      <main>{children}</main>
    </div>
  ),
}));

describe('App Navigation and Context Lifecycle', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    accountState.mustChangePassword = false;
    accountState.roleAssignments = [{ role: 'ADMIN', siteId: null }];
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    });
  });

  it.each(['/access', '/site-setup', '/schedule-setup', '/dashboard'])(
    'opens protected route %s without a forced password-change screen',
    async (path) => {
      accountState.mustChangePassword = true;
      render(
        <MemoryRouter initialEntries={[path]}>
          <QueryClientProvider client={queryClient}>
            <App />
          </QueryClientProvider>
        </MemoryRouter>,
      );
      expect(screen.queryByRole('heading', { name: 'Change your temporary password' })).toBeNull();
      expect(screen.getByRole('button', { name: 'Sidebar Incidents' })).not.toBeNull();
    },
  );

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.restoreAllMocks();
  });

  it('opens a PPE notification URL at its exact Site and alert after reload', () => {
    accountState.roleAssignments = [{ role: 'SAFETY_OFFICER', siteId: 'site-ppe' }];
    render(
      <MemoryRouter initialEntries={['/incidents?siteId=site-ppe&alertId=alert-ppe&tab=alerts']}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('initial-site').textContent).toBe('site-ppe');
    expect(screen.getByTestId('initial-alert').textContent).toBe('alert-ppe');
  });

  it('opens another PPE notification on the same route instead of retaining the first alert', async () => {
    accountState.roleAssignments = [{ role: 'SAFETY_OFFICER', siteId: 'site-ppe' }];
    function NextNotification() {
      const navigate = useNavigate();
      return (
        <button
          onClick={() => navigate('/incidents?siteId=site-ppe&alertId=alert-second&tab=alerts')}
        >
          Next notification
        </button>
      );
    }
    render(
      <MemoryRouter initialEntries={['/incidents?siteId=site-ppe&alertId=alert-first&tab=alerts']}>
        <QueryClientProvider client={queryClient}>
          <App />
          <NextNotification />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('initial-alert').textContent).toBe('alert-first');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Next notification' }));
    expect(screen.getByTestId('initial-alert').textContent).toBe('alert-second');
  });

  it.each([
    'SAFETY_OFFICER',
    'SITE_MANAGER',
    'CONTRACTOR_REPRESENTATIVE',
    'SECURITY_OFFICER',
    'WORKER',
    'ADMIN',
  ] as const)('allows a signed-in %s to choose the password form', (role) => {
    accountState.roleAssignments = [{ role, siteId: role === 'ADMIN' ? null : 'site-alpha' }];
    render(
      <MemoryRouter initialEntries={['/account/password']}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Change your temporary password' })).toBeTruthy();
  });

  it.each(['/login', '/dashboard'])(
    'opens main Safety operations for a Safety-only account entering %s',
    (path) => {
      accountState.roleAssignments = [{ role: 'SAFETY_OFFICER', siteId: 'site-alpha' }];
      render(
        <MemoryRouter initialEntries={[path]}>
          <QueryClientProvider client={queryClient}>
            <App />
          </QueryClientProvider>
        </MemoryRouter>,
      );
      expect(screen.getByRole('heading', { name: 'Safety Alerts Queue' })).toBeTruthy();
    },
  );

  it.each([
    '/login',
    '/dashboard',
    '/accounts',
    '/workforce',
    '/site-setup',
    '/schedule-setup',
    '/incidents',
    '/ppe',
    '/zones',
    '/live-monitoring',
    '/iot',
    '/progress',
  ])('keeps a Security-only account in its gate workspace when opening %s', async (path) => {
    accountState.roleAssignments = [{ role: 'SECURITY_OFFICER', siteId: 'site-alpha' }];
    render(
      <MemoryRouter initialEntries={[path]}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Security site access' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'PPE Monitoring' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Safety Alerts Queue' })).toBeNull();
  });

  it('retains other explicitly assigned roles for a Security/Admin account', () => {
    accountState.roleAssignments = [
      { role: 'SECURITY_OFFICER', siteId: 'site-alpha' },
      { role: 'ADMIN', siteId: null },
    ];
    render(
      <MemoryRouter initialEntries={['/ppe']}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'PPE Monitoring' })).toBeTruthy();
  });

  it('sets initialType when navigated with context, and clears it when navigating via sidebar without context', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    // 1. Enter app at PPE tab
    await user.click(screen.getByRole('button', { name: 'Enter PPE' }));
    expect(screen.getByRole('heading', { name: 'PPE Monitoring' })).not.toBeNull();

    // 2. Navigate to incidents with PPE context
    await user.click(screen.getByRole('button', { name: 'Navigate with PPE context' }));
    expect(screen.getByRole('heading', { name: 'Safety Alerts Queue' })).not.toBeNull();
    expect(screen.getByTestId('initial-type').textContent).toBe('PPE_VIOLATION');

    // 3. Switch back to PPE via sidebar
    await user.click(screen.getByRole('button', { name: 'Sidebar PPE' }));
    expect(screen.getByRole('heading', { name: 'PPE Monitoring' })).not.toBeNull();

    // 4. Click sidebar incidents directly (no context) -> context MUST be cleared, defaulting to ALL
    await user.click(screen.getByRole('button', { name: 'Sidebar Incidents' }));
    expect(screen.getByRole('heading', { name: 'Safety Alerts Queue' })).not.toBeNull();
    expect(screen.getByTestId('initial-type').textContent).toBe('ALL');
  });

  it('clears PPE filter to ALL immediately when clicking Sidebar Incidents from filtered incidents view', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    // 1. Enter app at PPE tab
    await user.click(screen.getByRole('button', { name: 'Enter PPE' }));

    // 2. Navigate from PPE to incidents with PPE context
    await user.click(screen.getByRole('button', { name: 'Navigate with PPE context' }));
    expect(screen.getByRole('heading', { name: 'Safety Alerts Queue' })).not.toBeNull();
    expect(screen.getByTestId('initial-type').textContent).toBe('PPE_VIOLATION');

    // 3. Click sidebar incidents immediately (while already on incidents, without going back to PPE)
    await user.click(screen.getByRole('button', { name: 'Sidebar Incidents' }));
    expect(screen.getByRole('heading', { name: 'Safety Alerts Queue' })).not.toBeNull();
    expect(screen.getByTestId('initial-type').textContent).toBe('ALL');
  });
});
