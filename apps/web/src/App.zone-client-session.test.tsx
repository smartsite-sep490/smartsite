// @vitest-environment jsdom
import { useEffect } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
const zoneAlpha: api.ZoneResponse = {
  id: 'zone-1',
  siteId: 'site-1',
  code: 'Z-NORTH',
  name: 'North Excavation Zone',
  type: 'HAZARDOUS',
  restrictionPolicy: 'NONE',
  requiredPpe: ['HARD_HAT', 'SAFETY_VEST'],
  configurationLocked: false,
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

async function mountReadyZoneDialogHarness() {
  const seenZoneAuthHeaders: string[] = [];
  let rejectTokenWith401: string | null = null;
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes('/api/v1/sites/site-1/zones')) {
        throw new Error(`Unexpected fetch URL: ${url}`);
      }
      const authHeader = new Headers(init?.headers).get('Authorization') ?? '';
      seenZoneAuthHeaders.push(authHeader);
      if (rejectTokenWith401 && authHeader === `Bearer ${rejectTokenWith401}`) {
        return jsonResponse({ code: 'UNAUTHORIZED', message: 'Access token expired.' }, 401);
      }
      return jsonResponse({ items: [zoneAlpha], total: 1 }, 200);
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
  vi.spyOn(api.SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
    items: [siteAlpha],
    total: 1,
  });
  const preview = vi
    .spyOn(api.SmartSiteManagementClient.prototype, 'listPreviewCameras')
    .mockResolvedValue({
      items: [activeCamera],
      total: 1,
    });
  vi.spyOn(api.SmartSiteManagementClient.prototype, 'listCameras').mockResolvedValue({
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
  const setup = await screen.findByRole('button', { name: /camera setup/i }, { timeout: 8000 });
  expect(preview).not.toHaveBeenCalled();
  fireEvent.click(setup);
  const openBtn = await screen.findByRole(
    'button',
    { name: /configure ppe by zone/i },
    { timeout: 8000 },
  );
  fireEvent.click(openBtn);
  expect(await screen.findByRole('dialog', { name: /zone ppe configuration/i })).not.toBeNull();
  expect(await screen.findByRole('button', { name: /rename Z-NORTH/i })).not.toBeNull();
  const zoneNameInput = (await screen.findByLabelText(/zone name/i)) as HTMLInputElement;
  fireEvent.change(zoneNameInput, { target: { value: 'Transient Zone Draft' } });
  expect(zoneNameInput.value).toBe('Transient Zone Draft');

  const initialScope = authRef.current?.sessionScope ?? '';
  expect(initialScope).not.toBe('');
  const zoneQueries = cache.getQueryCache().findAll({
    predicate: (q) =>
      Array.isArray(q.queryKey) &&
      q.queryKey.includes(initialScope) &&
      q.queryKey.includes('site-1') &&
      q.queryKey.includes('zones'),
  });
  expect(zoneQueries).toHaveLength(1);
  const activeZoneQueryKey = zoneQueries[0]!.queryKey;

  return {
    cache,
    authRef,
    refresh,
    initialScope,
    activeZoneQueryKey,
    seenZoneAuthHeaders,
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

it('refreshes the owning session after Zone401 and loads a fresh Zone query after the old credential scope is cancelled', async () => {
  const {
    cache,
    authRef,
    refresh,
    activeZoneQueryKey,
    seenZoneAuthHeaders,
    setRejectTokenWith401,
  } = await mountReadyZoneDialogHarness();
  refresh.mockClear();
  seenZoneAuthHeaders.length = 0;
  refresh.mockResolvedValueOnce(makeLoginResponse('token-manager-2', managerUser));
  setRejectTokenWith401('token-manager-1');
  await act(async () => {
    await cache.refetchQueries({ queryKey: activeZoneQueryKey, exact: true });
  });
  await waitFor(() => {
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(seenZoneAuthHeaders[0]).toBe('Bearer token-manager-1');
    expect(authRef.current?.accessToken).toBe('token-manager-2');
  });
  expect(authRef.current?.accessToken).toBe('token-manager-2');
  expect(authRef.current?.isSessionExpired).toBe(false);
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(screen.queryByRole('button', { name: /^sign in$/i })).toBeNull();
  const open = await screen.findByRole('button', { name: /configure ppe by zone/i });
  // The current credential-scope reset cancels the old observer. Do not require
  // replaying its aborted request; seamless draft continuity remains a separate RED.
  if (!screen.queryByRole('dialog', { name: /zone ppe configuration/i })) fireEvent.click(open);
  expect(await screen.findByRole('button', { name: /rename Z-NORTH/i })).not.toBeNull();
  expect(seenZoneAuthHeaders).toContain('Bearer token-manager-2');
  expect(seenZoneAuthHeaders.slice(1).every((h) => h === 'Bearer token-manager-2')).toBe(true);
});

it('clears the Zone popup scope, open draft, and private cache when listZones 401 refresh also fails with 401', async () => {
  const { cache, authRef, refresh, initialScope, activeZoneQueryKey, setRejectTokenWith401 } =
    await mountReadyZoneDialogHarness();
  const seededZoneMarkerKey = [...activeZoneQueryKey, 'seeded-private-marker'] as const;
  cache.setQueryData(seededZoneMarkerKey, { marker: 'confidential-zone-state' });
  expect(cache.getQueryData(seededZoneMarkerKey)).toEqual({ marker: 'confidential-zone-state' });
  expect(cache.getQueryCache().findAll({ queryKey: activeZoneQueryKey }).length).toBeGreaterThan(1);
  refresh.mockClear();
  refresh.mockRejectedValueOnce(new api.ApiError('http', 'Refresh session expired.', 401));
  setRejectTokenWith401('token-manager-1');
  await act(async () => {
    await cache.refetchQueries({ queryKey: activeZoneQueryKey, exact: true });
  });
  await waitFor(() => {
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(authRef.current?.accessToken).toBeNull();
  });
  expect(authRef.current?.sessionScope).toBe('');
  expect(authRef.current?.isSessionExpired).toBe(true);
  expect(screen.queryByRole('dialog', { name: /zone ppe configuration/i })).toBeNull();
  expect(screen.queryByLabelText(/zone name/i)).toBeNull();
  expect(screen.queryByDisplayValue('Transient Zone Draft')).toBeNull();
  expect(cache.getQueryData(seededZoneMarkerKey)).toBeUndefined();
  expect(cache.getQueryCache().findAll({ queryKey: activeZoneQueryKey })).toHaveLength(0);
  expect(
    cache.getQueryCache().findAll({
      predicate: (q) => Array.isArray(q.queryKey) && q.queryKey.includes(initialScope),
    }),
  ).toHaveLength(0);
  expect(await screen.findByRole('alertdialog')).not.toBeNull();
});
