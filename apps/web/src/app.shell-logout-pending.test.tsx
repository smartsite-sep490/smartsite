// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, getBackendHealth } from '@smartsite/api-client';

interface LayoutModuleExports {
  AppLayout: React.ComponentType<{
    children: React.ReactNode;
    onSelectTab?: (tab: string) => void;
  }>;
}

interface MockUserAccount {
  id: string;
  displayName: string;
  username: string;
  roleAssignments: Array<{ role: string; siteId: string | null }>;
  isActive: boolean;
  mustChangePassword?: boolean;
}

const shellLoaderState = vi.hoisted(() => {
  let resolveLayout: ((mod: LayoutModuleExports) => void) | null = null;
  const createPendingPromise = () =>
    new Promise<LayoutModuleExports>((resolve) => {
      resolveLayout = resolve;
    });
  const state = {
    layoutFactoryCalls: 0,
    loginFactoryCalls: 0,
    holdLayoutPending: false,
    pendingPromise: createPendingPromise(),
    resolvePendingLayout: (mod: LayoutModuleExports) => resolveLayout?.(mod),
    resetPendingPromise: () => {
      state.pendingPromise = createPendingPromise();
    },
  };
  return state;
});

const routeState = vi.hoisted(() => ({
  accessToken: 'test-token' as string | null,
  sessionScope: 'session-scope-1' as string | null,
  isRestoringSession: false,
  logoutUnconfirmed: false,
  passwordChanged: false,
  logoutMutate: vi.fn(),
  refetchUser: vi.fn(),
}));

const accountState = vi.hoisted(() => ({
  data: undefined as MockUserAccount | undefined,
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
    ApiError: actual.ApiError,
    getBackendHealth: vi.fn().mockResolvedValue({ status: 'ok', service: 'smartsite-backend' }),
  };
});

vi.mock('./features/auth/auth-session', () => ({
  useAuth: () => ({
    accessToken: routeState.accessToken,
    sessionScope: routeState.sessionScope,
    isSessionExpired: false,
    dismissSessionExpired: vi.fn(),
    logoutUnconfirmed: routeState.logoutUnconfirmed,
    passwordChanged: routeState.passwordChanged,
  }),
  useRestoreSession: () => ({
    isLoading: routeState.isRestoringSession,
    isError: false,
    error: null,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useCurrentUser: () => ({
    data: accountState.data,
    isPending: accountState.isPending,
    isFetching: accountState.isFetching,
    isError: accountState.isError,
    error: accountState.error,
    refetch: routeState.refetchUser,
  }),
  useLogout: () => ({ mutate: routeState.logoutMutate }),
  SessionExpiredModal: () => null,
}));

vi.mock('./features/auth/LoginScreen', () => {
  shellLoaderState.loginFactoryCalls += 1;
  return {
    LoginScreen: ({ notice }: { notice?: string }) => (
      <div data-testid="login-screen">
        <h1>Sign in to SmartSite</h1>
        {notice ? <p>{notice}</p> : null}
      </div>
    ),
  };
});

const MockAppLayout = vi.fn(({ children }: { children: React.ReactNode }) => (
  <div data-testid="protected-app-layout">{children}</div>
));

vi.mock('./components/layout/AppLayout', () => {
  shellLoaderState.layoutFactoryCalls += 1;
  return shellLoaderState.holdLayoutPending
    ? shellLoaderState.pendingPromise
    : { AppLayout: MockAppLayout };
});

vi.mock('./components/dashboard/DashboardView', () => ({
  DashboardView: () => (
    <div data-testid="protected-dashboard-view">
      <h2>Dashboard View</h2>
    </div>
  ),
}));

import { App } from './app';

const countsAfterAppImport = {
  layoutFactoryCalls: shellLoaderState.layoutFactoryCalls,
};

describe('App pending protected shell logout recovery', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    shellLoaderState.holdLayoutPending = false;
    MockAppLayout.mockClear();
    shellLoaderState.resetPendingPromise();
    routeState.accessToken = 'test-token';
    routeState.sessionScope = 'session-scope-1';
    routeState.isRestoringSession = false;
    routeState.logoutUnconfirmed = false;
    routeState.passwordChanged = false;
    accountState.data = {
      id: 'test-user-id',
      displayName: 'Test Admin',
      username: 'admin',
      roleAssignments: [{ role: 'ADMIN', siteId: null }],
      isActive: true,
      mustChangePassword: false,
    };
    accountState.isPending = false;
    accountState.isFetching = false;
    accountState.isError = false;
    accountState.error = null;
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false, gcTime: 0 },
      },
    });
  });

  afterEach(() => {
    queryClient.clear();
    cleanup();
    vi.clearAllMocks();
  });

  it('keeps Sign out usable while AppLayout load is pending and prevents late layout mount after logout to /login', async () => {
    expect(ApiError).toBeTypeOf('function');
    expect(countsAfterAppImport.layoutFactoryCalls).toBe(0);

    shellLoaderState.holdLayoutPending = true;
    const user = userEvent.setup();
    const renderTree = () => (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/dashboard']}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>
    );

    const view = render(renderTree());

    await waitFor(() => expect(shellLoaderState.layoutFactoryCalls).toBe(1));
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByTestId('protected-app-layout')).toBeNull();
    expect(screen.queryByTestId('protected-dashboard-view')).toBeNull();
    expect(getBackendHealth).toHaveBeenCalled();

    const signOutButton = screen.getByRole('button', { name: /sign out/i });
    await user.click(signOutButton);
    expect(routeState.logoutMutate).toHaveBeenCalledTimes(1);

    routeState.accessToken = null;
    routeState.sessionScope = null;
    accountState.data = undefined;
    queryClient.clear();
    view.rerender(renderTree());

    await act(async () => {
      shellLoaderState.resolvePendingLayout({ AppLayout: MockAppLayout });
      await shellLoaderState.pendingPromise;
    });

    const loginHeading = await screen.findByRole('heading', { name: /sign in to smartsite/i });
    expect(loginHeading).toBeTruthy();
    expect(screen.getByTestId('login-screen')).toBeTruthy();
    expect(screen.queryByTestId('protected-app-layout')).toBeNull();
    expect(screen.queryByTestId('protected-dashboard-view')).toBeNull();
    expect(MockAppLayout).not.toHaveBeenCalled();
  });
});
