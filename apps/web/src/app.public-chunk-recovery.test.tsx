// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, getBackendHealth } from '@smartsite/api-client';

const shellModuleState = vi.hoisted(() => ({
  loginScreenFactoryCalls: 0,
  registerScreenFactoryCalls: 0,
  landingFactoryCalls: 0,
  visitorFactoryCalls: 0,
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
  return Promise.reject(new Error('ChunkLoadError: secret-login-chunk-token-999'));
});

vi.mock('./features/auth/RegisterScreen', () => {
  shellModuleState.registerScreenFactoryCalls += 1;
  return {
    RegisterScreen: () => (
      <div data-testid="register-screen">
        <h1>Create SmartSite Account</h1>
      </div>
    ),
  };
});

vi.mock('./components/landing/LandingPage', () => {
  shellModuleState.landingFactoryCalls += 1;
  return Promise.reject(new Error('ChunkLoadError: secret-login-chunk-token-999'));
});

vi.mock('./components/access/visitor/VisitorRegistrationView', () => {
  shellModuleState.visitorFactoryCalls += 1;
  return {
    VisitorRegistrationView: () => (
      <div data-testid="register-screen">
        <h1>Create SmartSite Account</h1>
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

function ExternalRouteControl({ destination }: { destination: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" data-testid="navigate-to-register" onClick={() => navigate(destination)}>
      Go to Register
    </button>
  );
}

describe('App public route chunk error boundary recovery', () => {
  let queryClient: QueryClient;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

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

    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false, gcTime: 0 },
      },
    });
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    queryClient.clear();
    cleanup();
    vi.clearAllMocks();
  });

  it.each([
    ['/login', '/register', 'loginScreenFactoryCalls', 'registerScreenFactoryCalls'],
    ['/', '/visits/register', 'landingFactoryCalls', 'visitorFactoryCalls'],
  ] as const)(
    'recovers after failed %s when navigating to %s without mounting protected layout',
    async (initial, destination, failedFactory, healthyFactory) => {
      expect(ApiError).toBeTypeOf('function');
      const user = userEvent.setup();

      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={[initial]}>
            <ExternalRouteControl destination={destination} />
            <App />
          </MemoryRouter>
        </QueryClientProvider>,
      );

      const alert = await screen.findByRole('alert');
      expect(alert).toBeTruthy();
      expect(screen.getByRole('heading', { name: /unable to load page/i })).toBeTruthy();
      expect(screen.queryByText(/secret-login-chunk-token-999/i)).toBeNull();
      expect(getBackendHealth).toHaveBeenCalled();
      expect(shellModuleState[failedFactory]).toBe(1);
      expect(shellModuleState.appLayoutFactoryCalls).toBe(0);
      expect(screen.queryByTestId('protected-app-layout')).toBeNull();

      await user.click(screen.getByTestId('navigate-to-register'));

      const registerHeading = await screen.findByRole('heading', {
        name: /create smartsite account/i,
      });
      expect(registerHeading).toBeTruthy();
      expect(screen.getByTestId('register-screen')).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(shellModuleState[healthyFactory]).toBe(1);
      expect(shellModuleState.appLayoutFactoryCalls).toBe(0);
      expect(screen.queryByTestId('protected-app-layout')).toBeNull();
    },
  );
});
