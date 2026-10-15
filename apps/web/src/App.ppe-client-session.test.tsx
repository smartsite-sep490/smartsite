// @vitest-environment jsdom
import { useEffect } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as api from '@smartsite/api-client';
import { AuthProvider, useAuth } from './features/auth/auth-session';
import { App } from './app';

vi.mock('@gsap/react', () => ({ useGSAP: () => undefined }));
vi.mock('gsap', () => ({
  default: {
    registerPlugin: vi.fn(),
    set: vi.fn(),
    to: vi.fn(),
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

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

const siteAlpha: api.SiteResponse = {
  id: 'site-1',
  code: 'S1',
  name: 'Site Alpha',
  createdAt: '2026-10-05T00:00:00Z',
};
const activeCamera: api.CameraResponse = {
  id: 'cam-1',
  siteId: 'site-1',
  externalId: 'CAM-01',
  code: 'CAM-01',
  name: 'Camera 01',
  status: 'ACTIVE',
  configurationVersion: 1,
  createdAt: '2026-10-05T00:00:00Z',
};
const managerUser: api.AccountResponse = {
  id: 'manager-1',
  username: 'manager',
  displayName: 'Site Manager',
  isActive: true,
  mustChangePassword: false,
  roleAssignments: [{ role: 'SITE_MANAGER', siteId: 'site-1' }],
};

function makeLoginResponse(accessToken: string, user: api.AccountResponse): api.LoginResponse {
  return {
    accessToken,
    tokenType: 'Bearer',
    accessTokenExpiresAt: '2026-10-16T10:00:00Z',
    refreshTokenExpiresAt: '2026-10-17T10:00:00Z',
    user,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function mountReadyPpeSessionHarness() {
  const seenSiteAuthHeaders: string[] = [];
  let rejectTokenWith401: string | null = null;
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes('/api/v1/sites')) throw new Error(`Unexpected fetch URL: ${url}`);
      const authHeader = new Headers(init?.headers).get('Authorization') ?? '';
      seenSiteAuthHeaders.push(authHeader);
      if (rejectTokenWith401 && authHeader === `Bearer ${rejectTokenWith401}`) {
        return jsonResponse({ code: 'UNAUTHORIZED', message: 'Access token expired.' }, 401);
      }
      return jsonResponse({ items: [siteAlpha], total: 1 }, 200);
    },
  );
  vi.spyOn(api, 'getBackendHealth').mockResolvedValue({
    status: 'ok',
    service: 'smartsite-backend',
  });
  const refresh = vi
    .spyOn(api.SmartSiteManagementClient.prototype, 'refresh')
    .mockResolvedValue(makeLoginResponse('token-manager-1', managerUser));
  vi.spyOn(api.SmartSiteManagementClient.prototype, 'me').mockResolvedValue(managerUser);
  vi.spyOn(api.SmartSiteManagementClient.prototype, 'listPreviewCameras').mockResolvedValue({
    items: [activeCamera],
    total: 1,
  });
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const authRef: { current: ReturnType<typeof useAuth> | null } = { current: null };
  function AuthObserver() {
    const auth = useAuth();
    useEffect(() => {
      authRef.current = auth;
    }, [auth]);
    return null;
  }
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={['/ppe']}>
        <AuthProvider>
          <AuthObserver />
          <App />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByRole('button', { name: /configure ppe by zone/i }, { timeout: 8000 });
  expect(await screen.findByRole('option', { name: /CAM-01 · Camera 01/i })).not.toBeNull();
  return {
    cache,
    authRef,
    refresh,
    seenSiteAuthHeaders,
    setRejectTokenWith401: (token: string | null) => {
      rejectTokenWith401 = token;
    },
  };
}

beforeEach(() => vi.stubEnv('VITE_AI_WORK_PAUSED', 'true'));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  sessionStorage.clear();
  localStorage.clear();
});

it('retries PPE listSites HTTP 401 via Main session refresh exactly once with the new Bearer token and stays signed in', async () => {
  const { cache, authRef, refresh, seenSiteAuthHeaders, setRejectTokenWith401 } =
    await mountReadyPpeSessionHarness();
  refresh.mockClear();
  seenSiteAuthHeaders.length = 0;
  refresh.mockResolvedValueOnce(makeLoginResponse('token-manager-2', managerUser));
  setRejectTokenWith401('token-manager-1');
  await act(async () => {
    await cache.refetchQueries({ queryKey: ['ppe-monitoring'] });
  });
  await waitFor(() => {
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(seenSiteAuthHeaders[0]).toBe('Bearer token-manager-1');
    expect(seenSiteAuthHeaders).toContain('Bearer token-manager-2');
    expect(seenSiteAuthHeaders.slice(1).every((h) => h === 'Bearer token-manager-2')).toBe(true);
  });
  expect(authRef.current?.accessToken).toBe('token-manager-2');
  expect(authRef.current?.isSessionExpired).toBe(false);
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(screen.queryByRole('button', { name: /^sign in$/i })).toBeNull();
  expect(await screen.findByRole('button', { name: /configure ppe by zone/i })).not.toBeNull();
});

it('clears the private PPE scope and triggers session expiration when PPE listSites 401 refresh also fails with 401', async () => {
  const { cache, authRef, refresh, setRejectTokenWith401 } = await mountReadyPpeSessionHarness();
  const initialScope = authRef.current?.sessionScope ?? '';
  expect(initialScope).not.toBe('');
  const privateScopePrefix = ['ppe-monitoring', 'http://localhost:3000', initialScope] as const;
  const seededMarkerKey = [...privateScopePrefix, 'seeded-private-marker'] as const;
  cache.setQueryData(seededMarkerKey, { marker: 'confidential-ppe-state' });
  expect(cache.getQueryData(seededMarkerKey)).toEqual({ marker: 'confidential-ppe-state' });
  expect(cache.getQueryCache().findAll({ queryKey: privateScopePrefix }).length).toBeGreaterThan(1);
  refresh.mockClear();
  refresh.mockRejectedValueOnce(new api.ApiError('http', 'Refresh session expired.', 401));
  setRejectTokenWith401('token-manager-1');
  await act(async () => {
    await cache.refetchQueries({ queryKey: ['ppe-monitoring'] });
  });
  await waitFor(() => {
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(authRef.current?.accessToken).toBeNull();
  });
  expect(authRef.current?.sessionScope).toBe('');
  expect(authRef.current?.isSessionExpired).toBe(true);
  expect(cache.getQueryData(seededMarkerKey)).toBeUndefined();
  expect(cache.getQueryCache().findAll({ queryKey: privateScopePrefix })).toHaveLength(0);
  expect(await screen.findByRole('alertdialog')).not.toBeNull();
});
