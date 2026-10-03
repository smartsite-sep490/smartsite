// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { App } from './app';

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
    accessToken: 'test-token',
    sessionScope: 'mock-provider-session-scope',
    isSessionExpired: false,
    dismissSessionExpired: vi.fn(),
  }),
  useRestoreSession: () => ({ isLoading: false }),
  useCurrentUser: () => ({
    data: {
      id: 'test-user-id',
      displayName: 'Test User',
      username: 'testuser',
      roleAssignments: [],
      isActive: true,
    },
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useLogout: () => ({ mutate: vi.fn() }),
  SessionExpiredModal: () => null,
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
  RestrictedZoneView: ({ sharedSession }: { sharedSession?: unknown }) => (
    <div>
      <div>Restricted Zones</div>
      <span data-testid="zone-shared-session">{sharedSession ? 'PRESENT' : 'ABSENT'}</span>
    </div>
  ),
}));

vi.mock('./components/alerts/SafetyAlertsView', () => ({
  SafetyAlertsView: ({
    initialType,
    sharedSession,
  }: {
    initialType?: string;
    sharedSession?: { accessToken: string; sessionScope: string; user: { displayName: string } };
  }) => {
    const [type] = React.useState(initialType ?? 'ALL');
    return (
      <div>
        <h2>Safety Alerts Queue</h2>
        <span data-testid="initial-type">{type}</span>
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

describe('App Navigation and Context Lifecycle', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.restoreAllMocks();
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
    await user.click(screen.getByRole('button', { name: 'Enter Incidents Direct' }));
    expect(screen.getByRole('heading', { name: 'Safety Alerts Queue' })).not.toBeNull();
    expect(screen.getByTestId('alert-shared-session').textContent).toBe('PRESENT');
    expect(screen.getByTestId('alert-session-scope').textContent?.length).toBeGreaterThan(10);

    // 2. Switch to Zones via sidebar
    await user.click(screen.getByRole('button', { name: 'Sidebar Zones' }));
    expect(screen.getByText('Restricted Zones')).not.toBeNull();
    expect(screen.getByTestId('zone-shared-session').textContent).toBe('PRESENT');
  });
});
