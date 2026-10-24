// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, getBackendHealth } from '@smartsite/api-client';

const shellModuleState = vi.hoisted(() => ({
  loginScreenFactoryCalls: 0,
  appLayoutFactoryCalls: 0,
}));

const routeState = vi.hoisted(() => ({
  accessToken: null as string | null,
  sessionScope: null as string | null,
  isRestoringSession: false,
  logoutUnconfirmed: false,
  passwordChanged: false,
  logoutMutate: vi.fn(),
  refetchUser: vi.fn(),
}));

const accountState = vi.hoisted(() => ({
  data: undefined as
    | {
        id: string;
        displayName: string;
        username: string;
        roleAssignments: Array<{ role: string; siteId: string | null }>;
        isActive: boolean;
        mustChangePassword?: boolean;
      }
    | undefined,
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
  shellModuleState.loginScreenFactoryCalls += 1;
  return {
    LoginScreen: ({ notice }: { notice?: string }) => (
      <div data-testid="login-screen">
        <h1>Sign in to SmartSite</h1>
        {notice ? <p>{notice}</p> : null}
      </div>
    ),
  };
});

vi.mock('./components/layout/AppLayout', () => {
  shellModuleState.appLayoutFactoryCalls += 1;
  return {
    AppLayout: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="protected-app-layout">{children}</div>
    ),
  };
});

import { App } from './app';

const countsAfterAppImport = {
  loginScreenFactoryCalls: shellModuleState.loginScreenFactoryCalls,
  appLayoutFactoryCalls: shellModuleState.appLayoutFactoryCalls,
};

describe('App shell module deferral', () => {
  beforeEach(() => {
    routeState.accessToken = null;
    routeState.sessionScope = null;
    routeState.isRestoringSession = false;
    routeState.logoutUnconfirmed = false;
    routeState.passwordChanged = false;
    accountState.data = undefined;
    accountState.isPending = false;
    accountState.isFetching = false;
    accountState.isError = false;
    accountState.error = null;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('does not eagerly initialize LoginScreen or AppLayout on App import and loads only LoginScreen on unauthenticated /login', async () => {
    const countsBeforeRender = {
      loginScreenFactoryCalls: shellModuleState.loginScreenFactoryCalls,
      appLayoutFactoryCalls: shellModuleState.appLayoutFactoryCalls,
    };

    expect(ApiError).toBeTypeOf('function');
    expect(countsAfterAppImport).toEqual({
      loginScreenFactoryCalls: 0,
      appLayoutFactoryCalls: 0,
    });
    expect(countsBeforeRender).toEqual({
      loginScreenFactoryCalls: 0,
      appLayoutFactoryCalls: 0,
    });

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/login']}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const loginHeading = await screen.findByRole('heading', {
      name: /sign in to smartsite/i,
    });
    expect(loginHeading).toBeTruthy();
    expect(screen.getByTestId('login-screen')).toBeTruthy();
    expect(getBackendHealth).toHaveBeenCalled();

    expect(shellModuleState.loginScreenFactoryCalls).toBe(1);
    expect(shellModuleState.appLayoutFactoryCalls).toBe(0);
    expect(screen.queryByTestId('protected-app-layout')).toBeNull();
    queryClient.clear();
  });
});
