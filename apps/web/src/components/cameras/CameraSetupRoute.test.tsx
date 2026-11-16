// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import {
  ApiError,
  SmartSiteManagementClient,
  type AccountResponse,
  type LoginResponse,
  type SiteResponse,
} from '@smartsite/api-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthContext } from '../../features/auth/auth-session';
import { WebSession } from '../../features/auth/web-session';
import i18n from '../../i18n';
import { CameraSetupRoute } from './CameraSetupRoute';
import { deriveCameraSetupSharedSession, resolveCameraSetupGate } from './camera-setup-session';

const API_URL = 'http://localhost:3000';

const verifiedManagerAccount: AccountResponse = {
  id: 'user-sm-1',
  username: 'sm.alpha',
  displayName: 'Alpha Site Manager',
  roleAssignments: [{ role: 'SITE_MANAGER', siteId: 'site-alpha' }],
  isActive: true,
  mustChangePassword: false,
};

const alphaSite: SiteResponse = {
  id: 'site-alpha',
  code: 'SITE-01',
  name: 'Alpha Site',
  createdAt: '2026-10-01T00:00:00Z',
};

function makeLoginResponse(
  accessToken: string,
  user: AccountResponse = verifiedManagerAccount,
): LoginResponse {
  return {
    accessToken,
    tokenType: 'Bearer',
    accessTokenExpiresAt: '2026-11-03T00:00:00Z',
    refreshTokenExpiresAt: '2026-11-10T00:00:00Z',
    user,
  };
}

function buildAuthState(
  manager: WebSession,
  overrides: Partial<{
    epoch: number;
    accessToken: string | null;
    isSessionExpired: boolean;
    logoutUnconfirmed: boolean;
    passwordChanged: boolean;
    mustChangePassword: boolean;
  }> = {},
) {
  const snapshot = manager.getSnapshot();
  return {
    manager,
    epoch: snapshot.epoch,
    logoutUnconfirmed: snapshot.logoutUnconfirmed,
    passwordChanged: snapshot.passwordChanged,
    accessToken: snapshot.token,
    setAccessToken: (token: string | null) => manager.setAccessToken(token),
    isSessionExpired: snapshot.expired,
    triggerSessionExpired: vi.fn(),
    dismissSessionExpired: () => manager.dismissExpired(),
    ...overrides,
  };
}

describe('CameraSetupRoute Main-auth adapter', () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    await i18n.changeLanguage('en');
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

  it('hides CameraSetupView across unauthenticated, pending profile, errored profile without cached fallback, and mustChangePassword gates', async () => {
    const manager = new WebSession(API_URL);
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
      items: [],
      total: 0,
    });
    let resolveMe!: (account: AccountResponse) => void;
    const meSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'me').mockImplementation(
      () =>
        new Promise<AccountResponse>((resolve) => {
          resolveMe = resolve;
        }),
    );

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={buildAuthState(manager)}>
          <MemoryRouter initialEntries={['/cameras']}>
            <CameraSetupRoute apiUrl={API_URL} />
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    );

    // 1. Unauthenticated gate
    expect(screen.getByRole('status').textContent).toBe('Sign in to manage configuration.');
    expect(screen.queryByRole('heading', { name: 'Camera setup' })).toBeNull();

    // 2. Authenticated with pending currentUser profile
    manager.accept(makeLoginResponse('token-pending-1', verifiedManagerAccount));
    rerender(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={buildAuthState(manager)}>
          <MemoryRouter initialEntries={['/cameras']}>
            <CameraSetupRoute apiUrl={API_URL} />
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    );

    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Camera setup' })).toBeNull();

    // Seed verified profile then force an errored refetch to verify no cached profile fallback on error
    await act(async () => {
      resolveMe(verifiedManagerAccount);
    });
    await waitFor(() => {
      expect(queryClient.getQueryState(['auth', 'me', API_URL])?.status).toBe('success');
    });
    meSpy.mockRejectedValue(new ApiError('http', 'Profile check failed', 503));
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['auth', 'me', API_URL] });
    });

    // 3. Profile error gate (even when cached data existed previously)
    expect(await screen.findByText(i18n.t('auth.loadAccountError'))).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Camera setup' })).toBeNull();

    // 4. Password-change-required gate via retry button refetch
    const passwordGateUser: AccountResponse = {
      ...verifiedManagerAccount,
      mustChangePassword: true,
    };
    meSpy.mockResolvedValue(passwordGateUser);
    fireEvent.click(screen.getByRole('button'));
    expect(await screen.findByText('You do not have setup access.')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Camera setup' })).toBeNull();
  });

  it('maps a verified account into SharedSession for CameraSetupView, rejects mismatched user identity, and never fabricates setup roles', async () => {
    const manager = new WebSession(API_URL);
    manager.accept(makeLoginResponse('token-verified-sm', verifiedManagerAccount));

    const meSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'me')
      .mockResolvedValue(verifiedManagerAccount);
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
      items: [alphaSite],
      total: 1,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listCameras').mockResolvedValue({
      items: [],
      total: 0,
    });

    const authValue = buildAuthState(manager);

    const derived = deriveCameraSetupSharedSession({
      apiUrl: API_URL,
      auth: authValue,
      currentUser: { data: verifiedManagerAccount, isPending: false, isError: false },
    });
    expect(derived).not.toBeNull();
    expect(derived?.user).toEqual({
      id: 'user-sm-1',
      username: 'sm.alpha',
      displayName: 'Alpha Site Manager',
      mustChangePassword: false,
      roleAssignments: [{ role: 'SITE_MANAGER', siteId: 'site-alpha' }],
    });

    // Regression: if currentUser.data.id disagrees with manager.getSnapshot().response.user.id, fail closed
    expect(
      resolveCameraSetupGate({
        apiUrl: API_URL,
        auth: authValue,
        currentUser: {
          data: { ...verifiedManagerAccount, id: 'user-different-99' },
          isPending: false,
          isError: false,
        },
      }),
    ).toBe('unauthenticated');
    expect(
      deriveCameraSetupSharedSession({
        apiUrl: API_URL,
        auth: authValue,
        currentUser: {
          data: { ...verifiedManagerAccount, id: 'user-different-99' },
          isPending: false,
          isError: false,
        },
      }),
    ).toBeNull();

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={authValue}>
          <MemoryRouter initialEntries={['/cameras']}>
            <CameraSetupRoute apiUrl={API_URL} />
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Camera setup' })).toBeTruthy();
    expect(await screen.findByRole('option', { name: 'SITE-01 · Alpha Site' })).toBeTruthy();

    // Verify a worker account is mapped without fabricating ADMIN or SITE_MANAGER grants
    const workerAccount: AccountResponse = {
      ...verifiedManagerAccount,
      id: 'user-worker-1',
      roleAssignments: [{ role: 'WORKER', siteId: 'site-alpha' }],
    };
    manager.accept(makeLoginResponse('token-verified-worker', workerAccount));
    meSpy.mockResolvedValue(workerAccount);
    await queryClient.invalidateQueries({ queryKey: ['auth', 'me', API_URL] });
    rerender(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={buildAuthState(manager)}>
          <MemoryRouter initialEntries={['/cameras']}>
            <CameraSetupRoute apiUrl={API_URL} />
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText('You do not have setup access.')).toBeTruthy();
  });

  it('keeps sessionScope stable on token rotation, updates scope and remounts on epoch/user/manager changes, and never exposes raw tokens', async () => {
    const managerA = new WebSession(API_URL);
    const managerB = new WebSession(API_URL);
    const secretTokenOne = 'raw-secret-jwt-token-alpha-999';
    const secretTokenTwo = 'raw-secret-jwt-token-beta-888';
    const secondManagerAccount: AccountResponse = {
      ...verifiedManagerAccount,
      id: 'user-sm-2',
    };

    const meSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'me')
      .mockResolvedValue(verifiedManagerAccount);
    const listSitesSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listSites')
      .mockResolvedValue({ items: [alphaSite], total: 1 });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listCameras').mockResolvedValue({
      items: [],
      total: 0,
    });

    managerA.accept(makeLoginResponse(secretTokenOne, verifiedManagerAccount));
    const scopeInitial = deriveCameraSetupSharedSession({
      apiUrl: API_URL,
      auth: buildAuthState(managerA),
      currentUser: { data: verifiedManagerAccount, isPending: false, isError: false },
    })?.sessionScope;

    // In-place token rotation at same epoch (0) on managerA
    managerA.accept(makeLoginResponse(secretTokenTwo, verifiedManagerAccount));
    const scopeRotatedToken = deriveCameraSetupSharedSession({
      apiUrl: API_URL,
      auth: buildAuthState(managerA),
      currentUser: { data: verifiedManagerAccount, isPending: false, isError: false },
    })?.sessionScope;

    // Advance epoch on managerA (0 -> 1)
    managerA.clear(false);
    managerA.accept(makeLoginResponse(secretTokenTwo, verifiedManagerAccount));
    const scopeNextEpoch = deriveCameraSetupSharedSession({
      apiUrl: API_URL,
      auth: buildAuthState(managerA),
      currentUser: { data: verifiedManagerAccount, isPending: false, isError: false },
    })?.sessionScope;

    // Change user on managerA at epoch 1
    managerA.accept(makeLoginResponse(secretTokenTwo, secondManagerAccount));
    const scopeNextUser = deriveCameraSetupSharedSession({
      apiUrl: API_URL,
      auth: buildAuthState(managerA),
      currentUser: { data: secondManagerAccount, isPending: false, isError: false },
    })?.sessionScope;

    // Switch to managerB at epoch 1
    managerB.clear(false);
    managerB.accept(makeLoginResponse(secretTokenTwo, secondManagerAccount));
    const scopeNextManager = deriveCameraSetupSharedSession({
      apiUrl: API_URL,
      auth: buildAuthState(managerB),
      currentUser: { data: secondManagerAccount, isPending: false, isError: false },
    })?.sessionScope;

    expect(scopeInitial).toBeTruthy();
    expect(scopeRotatedToken).toBe(scopeInitial);
    expect(scopeNextEpoch).not.toBe(scopeInitial);
    expect(scopeNextUser).not.toBe(scopeNextEpoch);
    expect(scopeNextManager).not.toBe(scopeNextUser);
    expect(scopeInitial).not.toContain(secretTokenOne);
    expect(scopeRotatedToken).not.toContain(secretTokenTwo);

    // Reset managerA for component mount with secretTokenOne
    const liveManagerA = new WebSession(API_URL);
    liveManagerA.accept(makeLoginResponse(secretTokenOne, verifiedManagerAccount));

    const { container, rerender } = render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={buildAuthState(liveManagerA)}>
          <MemoryRouter initialEntries={['/cameras']}>
            <CameraSetupRoute apiUrl={API_URL} />
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Camera setup' })).toBeTruthy();
    await waitFor(() => expect(listSitesSpy).toHaveBeenCalledTimes(1));

    // Change manager + epoch + user and rotate token
    meSpy.mockResolvedValue(secondManagerAccount);
    await queryClient.invalidateQueries({ queryKey: ['auth', 'me', API_URL] });

    rerender(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={buildAuthState(managerB)}>
          <MemoryRouter initialEntries={['/cameras']}>
            <CameraSetupRoute apiUrl={API_URL} />
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(listSitesSpy).toHaveBeenCalledTimes(2));

    const serializedQueryKeys = JSON.stringify(
      queryClient
        .getQueryCache()
        .getAll()
        .map((q) => q.queryKey),
    );
    expect(serializedQueryKeys).not.toContain(secretTokenOne);
    expect(serializedQueryKeys).not.toContain(secretTokenTwo);
    expect(container.innerHTML).not.toContain(secretTokenOne);
    expect(container.innerHTML).not.toContain(secretTokenTwo);
  });

  it('hides CameraSetupView immediately when the session transitions to expired', async () => {
    const manager = new WebSession(API_URL);
    manager.accept(makeLoginResponse('token-active', verifiedManagerAccount));

    vi.spyOn(SmartSiteManagementClient.prototype, 'me').mockResolvedValue(verifiedManagerAccount);
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
      items: [alphaSite],
      total: 1,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listCameras').mockResolvedValue({
      items: [],
      total: 0,
    });

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={buildAuthState(manager)}>
          <MemoryRouter initialEntries={['/cameras']}>
            <CameraSetupRoute apiUrl={API_URL} />
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Camera setup' })).toBeTruthy();

    manager.adapter(manager.getSnapshot().epoch).onUnauthorized('token-active');

    rerender(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={buildAuthState(manager)}>
          <MemoryRouter initialEntries={['/cameras']}>
            <CameraSetupRoute apiUrl={API_URL} />
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    );

    expect(screen.queryByRole('heading', { name: 'Camera setup' })).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Sign in to manage configuration.');
  });

  it('triggers existing Main useLogout once via onSignOut when CameraSetupView receives 401', async () => {
    const manager = new WebSession(API_URL);
    manager.accept(makeLoginResponse('token-401-check', verifiedManagerAccount));

    const logoutSpy = vi.spyOn(manager, 'logout').mockResolvedValue(undefined);
    vi.spyOn(SmartSiteManagementClient.prototype, 'me').mockResolvedValue(verifiedManagerAccount);
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockRejectedValue(
      new ApiError('http', 'Unauthorized', 401),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={buildAuthState(manager)}>
          <MemoryRouter initialEntries={['/cameras']}>
            <CameraSetupRoute apiUrl={API_URL} />
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(logoutSpy).toHaveBeenCalledTimes(1);
    });
  });

  it('fails closed when Main WebSession manager is absent or when auth epoch, accessToken, or user id disagrees with manager snapshot', async () => {
    const manager = new WebSession(API_URL);
    manager.accept(makeLoginResponse('consistent-token-777', verifiedManagerAccount));

    vi.spyOn(SmartSiteManagementClient.prototype, 'me').mockResolvedValue(verifiedManagerAccount);
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
      items: [alphaSite],
      total: 1,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listCameras').mockResolvedValue({
      items: [],
      total: 0,
    });

    const verifiedCurrentUser = {
      data: verifiedManagerAccount,
      isPending: false,
      isError: false,
    };

    // 1. Missing manager fails closed by default
    expect(
      deriveCameraSetupSharedSession({
        apiUrl: API_URL,
        auth: {
          accessToken: 'consistent-token-777',
          isSessionExpired: false,
        },
        currentUser: verifiedCurrentUser,
      }),
    ).toBeNull();

    // 2. Regression: auth.epoch differing from manager.getSnapshot().epoch must fail closed
    expect(
      deriveCameraSetupSharedSession({
        apiUrl: API_URL,
        auth: buildAuthState(manager, { epoch: manager.getSnapshot().epoch + 1 }),
        currentUser: verifiedCurrentUser,
      }),
    ).toBeNull();

    // 3. Regression: auth.accessToken differing from manager.getSnapshot().token must fail closed
    expect(
      deriveCameraSetupSharedSession({
        apiUrl: API_URL,
        auth: buildAuthState(manager, { accessToken: 'mismatched-token-999' }),
        currentUser: verifiedCurrentUser,
      }),
    ).toBeNull();

    // 4. Regression: verified currentUser.id differing from manager.getSnapshot().response.user.id must fail closed
    expect(
      deriveCameraSetupSharedSession({
        apiUrl: API_URL,
        auth: buildAuthState(manager),
        currentUser: {
          data: { ...verifiedManagerAccount, id: 'mismatched-user-id' },
          isPending: false,
          isError: false,
        },
      }),
    ).toBeNull();

    // Component-level check: mismatched epoch hides CameraSetupView, consistent state renders it
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider
          value={buildAuthState(manager, { epoch: manager.getSnapshot().epoch + 5 })}
        >
          <MemoryRouter initialEntries={['/cameras']}>
            <CameraSetupRoute apiUrl={API_URL} />
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    );

    expect(screen.queryByRole('heading', { name: 'Camera setup' })).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Sign in to manage configuration.');

    rerender(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={buildAuthState(manager)}>
          <MemoryRouter initialEntries={['/cameras']}>
            <CameraSetupRoute apiUrl={API_URL} />
          </MemoryRouter>
        </AuthContext.Provider>
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('heading', { name: 'Camera setup' })).toBeTruthy();
  });
});
