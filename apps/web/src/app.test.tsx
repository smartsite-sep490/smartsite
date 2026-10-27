// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ApiError, getBackendHealth } from '@smartsite/api-client';
import i18n from './i18n';
import { App } from './app';

interface MockRoleAssignment {
  role: string;
  siteId: string | null;
}

interface MockUserAccount {
  id: string;
  displayName: string;
  username: string;
  roleAssignments: MockRoleAssignment[];
  isActive: boolean;
  mustChangePassword?: boolean;
}

function createDefaultUser(mustChangePassword = false): MockUserAccount {
  return {
    id: 'test-user-id',
    displayName: 'Test User',
    username: 'testuser',
    roleAssignments: [
      { role: 'ADMIN', siteId: null },
      { role: 'SITE_MANAGER', siteId: 'site-1' },
      { role: 'CONTRACTOR_REPRESENTATIVE', siteId: 'site-1' },
    ],
    isActive: true,
    mustChangePassword,
  };
}

const routeState = vi.hoisted(() => ({
  accessToken: 'test-token' as string | null,
  sessionScope: 'mock-provider-session-scope',
  isRestoringSession: false,
  pendingPpe: null as Promise<void> | null,
  ppeFailure: null as Error | null,
  logoutMutate: vi.fn(),
  refetchUser: vi.fn(),
}));

const accountState = vi.hoisted(() => ({
  mustChangePassword: false,
  data: {
    id: 'test-user-id',
    displayName: 'Test User',
    username: 'testuser',
    roleAssignments: [] as MockRoleAssignment[],
    isActive: true,
    mustChangePassword: false,
  } as MockUserAccount | undefined,
  isPending: false,
  isFetching: false,
  isError: false,
  error: null as unknown,
}));

vi.mock('@smartsite/api-client', async () => {
  const actual =
    await vi.importActual<typeof import('@smartsite/api-client')>('@smartsite/api-client');
  return {
    ...actual,
    getBackendHealth: vi.fn().mockResolvedValue({ status: 'ok', service: 'smartsite-backend' }),
  };
});

vi.mock('./features/auth/auth-session', () => ({
  useAuth: () => ({
    accessToken: routeState.accessToken,
    sessionScope: routeState.sessionScope,
    isSessionExpired: false,
    dismissSessionExpired: vi.fn(),
  }),
  useRestoreSession: () => ({ isLoading: routeState.isRestoringSession }),
  useCurrentUser: () => ({
    data: accountState.data
      ? {
          ...accountState.data,
          mustChangePassword:
            accountState.mustChangePassword || Boolean(accountState.data.mustChangePassword),
        }
      : undefined,
    isPending: accountState.isPending,
    isFetching: accountState.isFetching,
    isError: accountState.isError,
    error: accountState.error,
    refetch: routeState.refetchUser,
  }),
  useLogout: () => ({ mutate: routeState.logoutMutate }),
  SessionExpiredModal: () => null,
}));

vi.mock('./features/auth/ChangePasswordScreen', () => ({
  ChangePasswordScreen: () => <h1>Change your temporary password</h1>,
}));

vi.mock('./components/landing/LandingPage', () => ({
  LandingPage: ({ onEnterApp }: { onEnterApp: (tab?: string) => void }) => (
    <div>
      <h1>Landing Page</h1>
      <button onClick={() => onEnterApp('ppe')}>Enter PPE</button>
      <button onClick={() => onEnterApp('incidents')}>Enter Incidents Direct</button>
      <button onClick={() => onEnterApp('zones')}>Enter Zones Direct</button>
    </div>
  ),
}));

vi.mock('./components/dashboard/DashboardView', () => ({
  DashboardView: ({ apiUrl }: { apiUrl?: string }) => (
    <div data-testid="route-view" data-route="dashboard" data-api-url={apiUrl ?? ''}>
      <h2>Dashboard View</h2>
    </div>
  ),
}));

vi.mock('./components/workforce/components/WorkforceView', () => ({
  WorkforceView: ({ apiUrl }: { apiUrl: string }) => (
    <div data-testid="route-view" data-route="workforce" data-api-url={apiUrl}>
      <h2>Workforce View</h2>
    </div>
  ),
}));

vi.mock('./components/workforce/components/SiteSetupView', () => ({
  SiteSetupView: ({ apiUrl }: { apiUrl: string }) => (
    <div data-testid="route-view" data-route="site-setup" data-api-url={apiUrl}>
      <h2>Site Setup View</h2>
    </div>
  ),
}));

vi.mock('./components/workforce/components/ScheduleSetupView', () => ({
  ScheduleSetupView: ({ apiUrl }: { apiUrl: string }) => (
    <div data-testid="route-view" data-route="schedule-setup" data-api-url={apiUrl}>
      <h2>Schedule Setup View</h2>
    </div>
  ),
}));

vi.mock('./components/workforce/components/WorkerOnboardingView', () => ({
  WorkerOnboardingView: ({ apiUrl }: { apiUrl: string }) => (
    <div data-testid="route-view" data-route="worker-onboarding" data-api-url={apiUrl}>
      <h2>Worker Onboarding View</h2>
    </div>
  ),
}));

vi.mock('./components/access/AccessControlView', () => ({
  AccessControlView: ({ apiUrl }: { apiUrl: string }) => (
    <div data-testid="route-view" data-route="access" data-api-url={apiUrl}>
      <h2>Security site access</h2>
    </div>
  ),
}));

vi.mock('./components/access/visitor/VisitorRegistrationView', () => ({
  VisitorRegistrationView: ({ apiUrl, onBack }: { apiUrl: string; onBack: () => void }) => (
    <div data-testid="route-view" data-route="visitor-registration" data-api-url={apiUrl}>
      <h1>Visitor Registration</h1>
      <button onClick={onBack}>Back to sign in</button>
    </div>
  ),
}));

vi.mock('./components/live/LiveMonitoringView', () => ({
  LiveMonitoringView: () => (
    <div data-testid="route-view" data-route="live-monitoring">
      <h2>Live Monitoring View</h2>
    </div>
  ),
}));

vi.mock('./components/ppe/PpeMonitoringView', () => ({
  PpeMonitoringView: ({
    onNavigate,
    sharedSession,
  }: {
    onNavigate?: (tab: string, ctx?: unknown) => void;
    sharedSession?: { accessToken: string; sessionScope: string } | null;
  }) => {
    if (routeState.ppeFailure) throw routeState.ppeFailure;
    if (routeState.pendingPpe) throw routeState.pendingPpe;
    return (
      <div data-testid="route-view" data-route="ppe">
        <h2>PPE Monitoring</h2>
        <span data-testid="ppe-shared-session">{sharedSession ? 'PRESENT' : 'ABSENT'}</span>
        <button onClick={() => onNavigate?.('incidents', { alertType: 'PPE_VIOLATION' })}>
          Navigate with PPE context
        </button>
        <button
          onClick={() =>
            onNavigate?.('incidents', { siteId: 'site-aurora', alertType: 'PPE_VIOLATION' })
          }
        >
          Navigate with site and PPE context
        </button>
      </div>
    );
  },
}));

vi.mock('./features/auth/LoginScreen', () => ({
  LoginScreen: ({
    onNavigateToRegister,
    onBack,
  }: {
    onNavigateToRegister: () => void;
    onBack?: () => void;
  }) => (
    <div>
      <h1>Sign in</h1>
      <button onClick={onNavigateToRegister}>Get an account</button>
      {onBack && <button onClick={onBack}>Back to site</button>}
    </div>
  ),
}));

vi.mock('./components/zones/RestrictedZoneView', () => ({
  RestrictedZoneView: ({
    sharedSession,
    initialSelection,
  }: {
    sharedSession?: unknown;
    initialSelection?: { siteId?: string; cameraId?: string };
  }) => (
    <div data-testid="route-view" data-route="zones">
      <div>Restricted Zones</div>
      <span data-testid="zone-shared-session">{sharedSession ? 'PRESENT' : 'ABSENT'}</span>
      <span data-testid="zone-initial-site-id">{initialSelection?.siteId ?? ''}</span>
      <span data-testid="zone-initial-camera-id">{initialSelection?.cameraId ?? ''}</span>
    </div>
  ),
}));

vi.mock('./components/alerts/SafetyAlertsView', () => ({
  SafetyAlertsView: ({
    initialType,
    initialSiteId,
    initialAlertId,
    initialIncidentId,
    initialActionId,
    sharedSession,
  }: {
    initialType?: string;
    initialSiteId?: string;
    initialAlertId?: string;
    initialIncidentId?: string;
    initialActionId?: string;
    sharedSession?: { accessToken: string; sessionScope: string; user: { displayName: string } };
  }) => {
    const [type] = React.useState(initialType ?? 'ALL');
    const [capturedSiteId] = React.useState(initialSiteId ?? '');
    const [alert] = React.useState(initialAlertId ?? '');
    return (
      <div data-testid="route-view" data-route="incidents">
        <h2>Safety Alerts Queue</h2>
        <span data-testid="initial-type">{type}</span>
        <span data-testid="initial-site-id">{initialSiteId ?? ''}</span>
        <span data-testid="captured-site-id">{capturedSiteId}</span>
        <span data-testid="initial-site">{capturedSiteId}</span>
        <span data-testid="initial-alert">{alert}</span>
        <span data-testid="initial-incident-id">{initialIncidentId ?? ''}</span>
        <span data-testid="initial-action-id">{initialActionId ?? ''}</span>
        <span data-testid="alert-shared-session">{sharedSession ? 'PRESENT' : 'ABSENT'}</span>
        {sharedSession && (
          <span data-testid="alert-session-scope">{sharedSession.sessionScope}</span>
        )}
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
        <button onClick={() => onSelectTab('zones')}>Sidebar Zones</button>
      </nav>
      <main>{children}</main>
    </div>
  ),
}));

function resetTestFixtures() {
  void i18n.changeLanguage('en');
  routeState.accessToken = 'test-token';
  routeState.sessionScope = 'mock-provider-session-scope';
  routeState.isRestoringSession = false;
  routeState.pendingPpe = null;
  routeState.ppeFailure = null;
  routeState.logoutMutate.mockReset();
  routeState.refetchUser.mockReset();
  accountState.mustChangePassword = false;
  accountState.data = createDefaultUser(false);
  accountState.isPending = false;
  accountState.isFetching = false;
  accountState.isError = false;
  accountState.error = null;
}

describe('App Navigation and Context Lifecycle', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    resetTestFixtures();
    vi.mocked(getBackendHealth).mockClear();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    resetTestFixtures();
    vi.restoreAllMocks();
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
      expect(await screen.findByRole('button', { name: 'Sidebar Incidents' })).not.toBeNull();
      expect(await screen.findByTestId('route-view')).not.toBeNull();
    },
  );

  it('routes unauthenticated account access to guidance and back to sign in or the homepage', async () => {
    routeState.accessToken = null;
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/login']}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    await user.click(await screen.findByRole('button', { name: 'Get an account' }));
    expect(await screen.findByRole('heading', { name: 'Need an account?' })).toBeDefined();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Get an account' }));
    await screen.findByRole('heading', { name: 'Need an account?' });
    await user.click(screen.getByRole('button', { name: /back to site/i }));
    expect(await screen.findByRole('heading', { name: 'Landing Page' })).toBeDefined();
  });

  it('renders public /visits/register route while unauthenticated and navigates back to /login', async () => {
    routeState.accessToken = null;
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/visits/register']}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Visitor Registration' })).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeDefined();
  });

  it('keeps protected navigation available during page loading and removes that page on logout before loading finishes', async () => {
    let finishLoading!: () => void;
    routeState.pendingPpe = new Promise<void>((resolve) => {
      finishLoading = resolve;
    });
    const app = (
      <MemoryRouter initialEntries={['/ppe']}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>
    );
    const result = render(app);
    expect((await screen.findByRole('status')).textContent).toMatch(/Loading/i);
    expect(screen.getByRole('button', { name: 'Sidebar Zones' })).toBeDefined();
    routeState.accessToken = null;
    result.rerender(
      <MemoryRouter initialEntries={['/ppe']}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeDefined();
    await act(async () => {
      routeState.pendingPpe = null;
      finishLoading();
    });
    expect(screen.queryByRole('heading', { name: 'PPE Monitoring' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sidebar Zones' })).toBeNull();
  });

  it('offers safe recovery for a page load failure and can navigate to a different protected page', async () => {
    const user = userEvent.setup();
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    routeState.ppeFailure = new Error('chunk fetch failed: secret-fixture-token');
    render(
      <MemoryRouter initialEntries={['/ppe']}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    const failure = await screen.findByRole('alert');
    expect(failure.textContent).not.toContain('secret-fixture-token');
    expect(screen.getByRole('button', { name: 'Reload Page' })).toBeDefined();
    await user.click(await screen.findByRole('button', { name: 'Sidebar Zones' }));
    expect(await screen.findByText('Restricted Zones')).toBeDefined();
    expect(screen.queryByRole('alert')).toBeNull();
    errorLog.mockRestore();
  });

  it('fails closed when currentUser is pending or errored even with cached profile data, disables Retry on 401/403, and invokes logout', async () => {
    const user = userEvent.setup();
    accountState.data = undefined;
    accountState.isPending = true;
    const result = render(
      <MemoryRouter initialEntries={['/ppe']}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole('status')).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'PPE Monitoring' })).toBeNull();

    // Cached profile remains present while isError becomes true with HTTP 403
    accountState.data = createDefaultUser(false);
    accountState.isPending = false;
    accountState.isError = true;
    accountState.error = new ApiError('http', 'Forbidden', 403);
    result.rerender(
      <MemoryRouter initialEntries={['/ppe']}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Could not load user profile');
    expect(screen.queryByRole('heading', { name: 'PPE Monitoring' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Retry' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(routeState.logoutMutate).toHaveBeenCalledTimes(1);

    // Transient network error enables Retry and invokes refetchUser
    accountState.error = new ApiError('network', 'Network down');
    result.rerender(
      <MemoryRouter initialEntries={['/ppe']}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    const retryButton = screen.getByRole('button', { name: 'Retry' }) as HTMLButtonElement;
    expect(retryButton.disabled).toBe(false);
    await user.click(retryButton);
    expect(routeState.refetchUser).toHaveBeenCalledTimes(1);
  });

  it('keeps Main role destinations and Contractor onboarding while preserving Safety deep-link context', async () => {
    accountState.data = {
      ...createDefaultUser(false),
      roleAssignments: [{ role: 'WORKER', siteId: 'site-1' }],
    };
    const workerRender = render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Workforce View' })).toBeDefined();
    workerRender.unmount();

    accountState.data = {
      ...createDefaultUser(false),
      roleAssignments: [{ role: 'SITE_MANAGER', siteId: 'site-1' }],
    };
    const managerAccessRender = render(
      <MemoryRouter initialEntries={['/access']}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Security site access' })).toBeDefined();
    managerAccessRender.unmount();

    const managerWorkforceRender = render(
      <MemoryRouter initialEntries={['/workforce']}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Workforce View' })).toBeDefined();
    managerWorkforceRender.unmount();

    accountState.data = {
      ...createDefaultUser(false),
      roleAssignments: [{ role: 'CONTRACTOR_REPRESENTATIVE', siteId: 'site-1' }],
    };
    const onboardingRender = render(
      <MemoryRouter initialEntries={['/worker-onboarding']}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Worker Onboarding View' })).toBeDefined();
    onboardingRender.unmount();
    accountState.data = {
      ...createDefaultUser(false),
      roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: 'site-9' }],
    };
    const deepLinkRender = render(
      <MemoryRouter initialEntries={['/incidents?siteId=site-9&incidentId=inc-42&actionId=act-7']}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Safety Alerts Queue' })).toBeDefined();
    expect(screen.getByTestId('initial-site-id').textContent).toBe('site-9');
    expect(screen.getByTestId('initial-incident-id').textContent).toBe('inc-42');
    expect(screen.getByTestId('initial-action-id').textContent).toBe('act-7');
    deepLinkRender.unmount();
  });

  it('opens a PPE notification URL at its exact Site and alert after reload', () => {
    accountState.data = {
      ...createDefaultUser(false),
      roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: 'site-ppe' }],
    };
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
    accountState.data = {
      ...createDefaultUser(false),
      roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: 'site-ppe' }],
    };
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
  ] as const)('allows a signed-in %s to choose the password form', async (role) => {
    accountState.data!.roleAssignments = [{ role, siteId: role === 'ADMIN' ? null : 'site-alpha' }];
    render(
      <MemoryRouter initialEntries={['/account/password']}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole('heading', { name: 'Change your temporary password' }),
    ).toBeTruthy();
  });

  it.each(['/login', '/dashboard'])(
    'opens main Safety operations for a Safety-only account entering %s',
    async (path) => {
      accountState.data!.roleAssignments = [{ role: 'SAFETY_OFFICER', siteId: 'site-alpha' }];
      render(
        <MemoryRouter initialEntries={[path]}>
          <QueryClientProvider client={queryClient}>
            <App />
          </QueryClientProvider>
        </MemoryRouter>,
      );
      expect(await screen.findByRole('heading', { name: 'Safety Alerts Queue' })).toBeTruthy();
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
    accountState.data!.roleAssignments = [{ role: 'SECURITY_OFFICER', siteId: 'site-alpha' }];
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

  it('retains other explicitly assigned roles for a Security/Admin account', async () => {
    accountState.data!.roleAssignments = [
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
    expect(await screen.findByRole('heading', { name: 'PPE Monitoring' })).toBeTruthy();
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
    await user.click(await screen.findByRole('button', { name: 'Enter PPE' }));
    expect(await screen.findByRole('heading', { name: 'PPE Monitoring' })).not.toBeNull();

    // 2. Navigate to incidents with PPE context
    await user.click(await screen.findByRole('button', { name: 'Navigate with PPE context' }));
    expect(await screen.findByRole('heading', { name: 'Safety Alerts Queue' })).not.toBeNull();
    expect(screen.getByTestId('initial-type').textContent).toBe('PPE_VIOLATION');

    // 3. Switch back to PPE via sidebar
    await user.click(await screen.findByRole('button', { name: 'Sidebar PPE' }));
    expect(await screen.findByRole('heading', { name: 'PPE Monitoring' })).not.toBeNull();

    // 4. Click sidebar incidents directly (no context) -> context MUST be cleared, defaulting to ALL
    await user.click(await screen.findByRole('button', { name: 'Sidebar Incidents' }));
    expect(await screen.findByRole('heading', { name: 'Safety Alerts Queue' })).not.toBeNull();
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
    await user.click(await screen.findByRole('button', { name: 'Enter PPE' }));

    // 2. Navigate from PPE to incidents with PPE context
    await user.click(await screen.findByRole('button', { name: 'Navigate with PPE context' }));
    expect(await screen.findByRole('heading', { name: 'Safety Alerts Queue' })).not.toBeNull();
    expect(screen.getByTestId('initial-type').textContent).toBe('PPE_VIOLATION');

    // 3. Click sidebar incidents immediately (while already on incidents, without going back to PPE)
    await user.click(await screen.findByRole('button', { name: 'Sidebar Incidents' }));
    expect(await screen.findByRole('heading', { name: 'Safety Alerts Queue' })).not.toBeNull();
    expect(screen.getByTestId('initial-type').textContent).toBe('ALL');
  });

  it('passes sharedSession down to SafetyAlertsView and RestrictedZoneView on protected routes', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    // 1. Enter Incidents directly
    await user.click(await screen.findByRole('button', { name: 'Enter Incidents Direct' }));
    expect(await screen.findByRole('heading', { name: 'Safety Alerts Queue' })).not.toBeNull();
    expect(screen.getByTestId('alert-shared-session').textContent).toBe('PRESENT');
    expect(screen.getByTestId('alert-session-scope').textContent?.length).toBeGreaterThan(10);

    // 2. Switch to Zones via sidebar
    await user.click(await screen.findByRole('button', { name: 'Sidebar Zones' }));
    expect(await screen.findByText('Restricted Zones')).not.toBeNull();
    expect(screen.getByTestId('zone-shared-session').textContent).toBe('PRESENT');
  });

  it('hides protected navigation, protected page, and login redirect while restoring session until restoration finishes', async () => {
    routeState.accessToken = null;
    routeState.isRestoringSession = true;

    const restoredRender = render(
      <MemoryRouter initialEntries={['/ppe']}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(screen.getByRole('status')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Sidebar Incidents' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sidebar PPE' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'PPE Monitoring' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Sign in' })).toBeNull();

    // Restoration finishes with an active session token -> protected navigation and page render
    routeState.accessToken = 'restored-token';
    routeState.isRestoringSession = false;
    restoredRender.rerender(
      <MemoryRouter initialEntries={['/ppe']}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'PPE Monitoring' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Sidebar Incidents' })).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'Sign in' })).toBeNull();
    restoredRender.unmount();

    // Restoration starts with no token and finishes unauthenticated -> redirects to /login only after restoration completes
    routeState.accessToken = null;
    routeState.isRestoringSession = true;
    const unauthRender = render(
      <MemoryRouter initialEntries={['/ppe']}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(screen.getByRole('status')).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'Sign in' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sidebar Incidents' })).toBeNull();

    routeState.isRestoringSession = false;
    unauthRender.rerender(
      <MemoryRouter initialEntries={['/ppe']}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Sidebar Incidents' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'PPE Monitoring' })).toBeNull();
    unauthRender.unmount();
  });

  it('redirects /login to the role-appropriate default route when accessToken and profile update without an onLoginSuccess callback', async () => {
    // 1. Admin / non-worker login -> /dashboard via PublicOnlyRoute
    routeState.accessToken = null;
    accountState.data = undefined;
    accountState.isPending = true;

    const adminLoginRender = render(
      <MemoryRouter initialEntries={['/login']}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeDefined();
    expect(screen.queryByTestId('route-view')).toBeNull();

    routeState.accessToken = 'admin-session-token';
    accountState.isPending = false;
    accountState.data = {
      ...createDefaultUser(false),
      roleAssignments: [{ role: 'ADMIN', siteId: null }],
    };
    adminLoginRender.rerender(
      <MemoryRouter initialEntries={['/login']}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Dashboard View' })).toBeDefined();
    expect(screen.getByTestId('route-view').getAttribute('data-route')).toBe('dashboard');
    expect(screen.queryByRole('heading', { name: 'Sign in' })).toBeNull();
    adminLoginRender.unmount();

    // 2. Worker-only login -> token arrives while profile is pending, then profile resolves to WORKER -> /workforce
    routeState.accessToken = null;
    accountState.data = undefined;
    accountState.isPending = true;

    const workerLoginRender = render(
      <MemoryRouter initialEntries={['/login']}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeDefined();

    routeState.accessToken = 'worker-session-token';
    workerLoginRender.rerender(
      <MemoryRouter initialEntries={['/login']}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(screen.getByRole('status')).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'Sign in' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Dashboard View' })).toBeNull();

    accountState.isPending = false;
    accountState.data = {
      ...createDefaultUser(false),
      roleAssignments: [{ role: 'WORKER', siteId: 'site-1' }],
    };
    workerLoginRender.rerender(
      <MemoryRouter initialEntries={['/login']}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Workforce View' })).toBeDefined();
    expect(screen.getByTestId('route-view').getAttribute('data-route')).toBe('workforce');
    expect(screen.queryByRole('heading', { name: 'Dashboard View' })).toBeNull();
    workerLoginRender.unmount();
  });

  it('switches language while a protected route is pending or currentUser is errored with cached profile data without exposing the protected page or triggering network refetches', async () => {
    let finishLoading!: () => void;
    routeState.pendingPpe = new Promise<void>((resolve) => {
      finishLoading = resolve;
    });

    const result = render(
      <MemoryRouter initialEntries={['/ppe']}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect((await screen.findByRole('status')).textContent).toContain('Loading…');
    expect(screen.queryByRole('heading', { name: 'PPE Monitoring' })).toBeNull();
    const healthCallsBeforeSwitch = vi.mocked(getBackendHealth).mock.calls.length;

    await act(async () => {
      await i18n.changeLanguage('vi');
    });

    expect(screen.getByRole('status').textContent).toContain('Đang tải…');
    expect(screen.queryByRole('heading', { name: 'PPE Monitoring' })).toBeNull();
    expect(vi.mocked(getBackendHealth).mock.calls.length).toBe(healthCallsBeforeSwitch);
    expect(routeState.refetchUser).not.toHaveBeenCalled();

    // Cached profile remains present while currentUser enters HTTP 403 error state
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    accountState.data = createDefaultUser(false);
    accountState.isPending = false;
    accountState.isError = true;
    accountState.error = new ApiError('http', 'Forbidden', 403);
    result.rerender(
      <MemoryRouter initialEntries={['/ppe']}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(screen.getByRole('alert').textContent).toContain('Could not load user profile');
    expect(screen.queryByRole('heading', { name: 'PPE Monitoring' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Retry' }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    // Switching language to Vietnamese updates the error boundary in-place without reopening the protected route
    await act(async () => {
      await i18n.changeLanguage('vi');
    });

    expect(screen.getByRole('alert').textContent).toContain('Không thể tải hồ sơ người dùng');
    expect(screen.queryByRole('heading', { name: 'PPE Monitoring' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Thử lại' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByRole('button', { name: 'Đăng xuất' })).toBeDefined();
    expect(vi.mocked(getBackendHealth).mock.calls.length).toBe(healthCallsBeforeSwitch);

    await act(async () => {
      routeState.pendingPpe = null;
      finishLoading();
    });
  });

  it('preserves captured siteId, alertType, deep-link incident/action params, and sharedSession scope on /incidents across live language switches', async () => {
    const user = userEvent.setup();

    const navRender = render(
      <MemoryRouter initialEntries={['/ppe']}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await user.click(
      await screen.findByRole('button', { name: 'Navigate with site and PPE context' }),
    );
    expect(await screen.findByRole('heading', { name: 'Safety Alerts Queue' })).toBeDefined();
    expect(screen.getByTestId('initial-site-id').textContent).toBe('site-aurora');
    expect(screen.getByTestId('captured-site-id').textContent).toBe('site-aurora');
    expect(screen.getByTestId('initial-type').textContent).toBe('PPE_VIOLATION');
    expect(screen.getByTestId('alert-shared-session').textContent).toBe('PRESENT');
    expect(screen.getByTestId('alert-session-scope').textContent).toBe(
      'mock-provider-session-scope',
    );

    await act(async () => {
      await i18n.changeLanguage('vi');
    });

    expect(screen.getByTestId('initial-site-id').textContent).toBe('site-aurora');
    expect(screen.getByTestId('captured-site-id').textContent).toBe('site-aurora');
    expect(screen.getByTestId('initial-type').textContent).toBe('PPE_VIOLATION');
    expect(screen.getByTestId('alert-shared-session').textContent).toBe('PRESENT');
    expect(screen.getByTestId('alert-session-scope').textContent).toBe(
      'mock-provider-session-scope',
    );

    await act(async () => {
      await i18n.changeLanguage('en');
    });

    expect(screen.getByTestId('initial-site-id').textContent).toBe('site-aurora');
    expect(screen.getByTestId('captured-site-id').textContent).toBe('site-aurora');
    expect(screen.getByTestId('initial-type').textContent).toBe('PPE_VIOLATION');
    navRender.unmount();

    const deepLinkRender = render(
      <MemoryRouter initialEntries={['/incidents?siteId=site-9&incidentId=inc-42&actionId=act-7']}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Safety Alerts Queue' })).toBeDefined();
    await act(async () => {
      await i18n.changeLanguage('vi');
    });
    expect(screen.getByTestId('initial-site-id').textContent).toBe('site-9');
    expect(screen.getByTestId('initial-incident-id').textContent).toBe('inc-42');
    expect(screen.getByTestId('initial-action-id').textContent).toBe('act-7');
    expect(screen.getByTestId('alert-shared-session').textContent).toBe('PRESENT');
    deepLinkRender.unmount();

    const zoneLinkRender = render(
      <MemoryRouter initialEntries={['/zones?siteId=site-9&cameraId=cam-42']}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Restricted Zones')).toBeDefined();
    expect(screen.getByTestId('zone-initial-site-id').textContent).toBe('site-9');
    expect(screen.getByTestId('zone-initial-camera-id').textContent).toBe('cam-42');
    expect(screen.getByTestId('zone-shared-session').textContent).toBe('PRESENT');
    zoneLinkRender.unmount();
  });

  it('opens a PPE notification URL at its exact Site and alert after reload', async () => {
    accountState.data!.roleAssignments = [{ role: 'SAFETY_OFFICER', siteId: 'site-ppe' }];
    render(
      <MemoryRouter initialEntries={['/incidents?siteId=site-ppe&alertId=alert-ppe&tab=alerts']}>
        <QueryClientProvider client={queryClient}>
          <App />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Safety Alerts Queue' })).toBeDefined();
    expect(screen.getByTestId('initial-site').textContent).toBe('site-ppe');
    expect(screen.getByTestId('initial-alert').textContent).toBe('alert-ppe');
  });

  it('opens another PPE notification on the same route instead of retaining the first alert', async () => {
    accountState.data!.roleAssignments = [{ role: 'SAFETY_OFFICER', siteId: 'site-ppe' }];
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
    expect(await screen.findByRole('heading', { name: 'Safety Alerts Queue' })).toBeDefined();
    expect(screen.getByTestId('initial-alert').textContent).toBe('alert-first');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Next notification' }));
    expect(await screen.findByRole('heading', { name: 'Safety Alerts Queue' })).toBeDefined();
    expect(screen.getByTestId('initial-alert').textContent).toBe('alert-second');
  });
});
