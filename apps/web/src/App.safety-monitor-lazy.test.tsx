// @vitest-environment jsdom
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import * as api from '@smartsite/api-client';
import { AuthContext } from './features/auth/auth-session';
import { App } from './app';

const lazyState = vi.hoisted(() => ({
  liveLoads: 0,
  ppeLoads: 0,
  failPpe: false,
  resolveLive: null as ((module: { LiveMonitoringView: () => React.JSX.Element }) => void) | null,
}));

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
  AppLayout: ({
    children,
    onSelectTab,
  }: {
    children: React.ReactNode;
    onSelectTab: (tab: 'live-monitoring' | 'ppe' | 'zones' | 'incidents') => void;
  }) => (
    <div>
      <nav aria-label="Shell navigation">
        <button type="button" onClick={() => onSelectTab('live-monitoring')}>
          Nav Live
        </button>
        <button type="button" onClick={() => onSelectTab('ppe')}>
          Nav PPE
        </button>
        <button type="button" onClick={() => onSelectTab('zones')}>
          Nav Zones
        </button>
      </nav>
      <main>{children}</main>
    </div>
  ),
}));
vi.mock('./components/live/LiveMonitoringView', () => {
  lazyState.liveLoads += 1;
  return new Promise<{ LiveMonitoringView: () => React.JSX.Element }>((resolve) => {
    lazyState.resolveLive = resolve;
  });
});
vi.mock('./components/ppe/PpeMonitorWorkspace', () => {
  lazyState.ppeLoads += 1;
  return {
    PpeMonitorWorkspace: ({ observationMode }: { observationMode?: 'ppe' | 'zone' }) => {
      if (lazyState.failPpe && observationMode !== 'zone') {
        throw new Error('ppe chunk render failure');
      }
      return (
        <div>{observationMode === 'zone' ? 'Zone Workspace Ready' : 'PPE Workspace Ready'}</div>
      );
    },
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  lazyState.failPpe = false;
  lazyState.resolveLive = null;
});

function createUser() {
  return {
    id: 'officer-1',
    username: 'officer',
    displayName: 'Safety Officer',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [{ role: 'SAFETY_OFFICER' as const, siteId: 'site-1' }],
  };
}

function setupMocks() {
  const user = createUser();
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  cache.setQueryData(['auth', 'session'], { accessToken: 'test-token', user });
  vi.spyOn(api, 'getBackendHealth').mockResolvedValue({
    status: 'ok',
    service: 'smartsite-backend',
  });
  vi.spyOn(api.SmartSiteManagementClient.prototype, 'me').mockResolvedValue(user);
  vi.spyOn(api.SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
    items: [{ id: 'site-1', code: 'S1', name: 'Site 1', createdAt: '2026-10-05T00:00:00Z' }],
    total: 1,
  });
  vi.spyOn(api.SmartSiteManagementClient.prototype, 'listSafetyAlerts').mockResolvedValue({
    items: [],
    total: 0,
  });
  vi.spyOn(api.SmartSiteManagementClient.prototype, 'listIncidents').mockResolvedValue({
    items: [],
    total: 0,
  });
  return { cache };
}

it('defers monitor chunks on unrelated screens and never reveals a pending monitor workspace after logout', async () => {
  const { cache } = setupMocks();
  function SessionHarness() {
    const [accessToken, setAccessToken] = useState<string | null>('test-token');
    return (
      <AuthContext.Provider
        value={{
          accessToken,
          setAccessToken,
          isSessionExpired: false,
          triggerSessionExpired: vi.fn(),
          dismissSessionExpired: vi.fn(),
        }}
      >
        <button type="button" onClick={() => setAccessToken(null)}>
          Clear Session
        </button>
        <App />
      </AuthContext.Provider>
    );
  }
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={['/incidents']}>
        <SessionHarness />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByRole('button', { name: 'Sign out Safety Officer' })).toBeTruthy();
  expect(lazyState.liveLoads).toBe(0);
  expect(lazyState.ppeLoads).toBe(0);

  fireEvent.click(screen.getByRole('button', { name: 'Nav Live' }));
  await waitFor(() => {
    expect(lazyState.liveLoads).toBe(1);
    expect(lazyState.resolveLive).not.toBeNull();
  });
  expect(screen.getByRole('navigation', { name: 'Shell navigation' })).toBeTruthy();
  expect(screen.getByRole('status')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'Clear Session' }));
  expect(await screen.findByRole('button', { name: 'Sign In' })).toBeTruthy();

  await act(async () => {
    lazyState.resolveLive?.({
      LiveMonitoringView: () => <div>Resolved Live Monitoring Workspace</div>,
    });
  });
  expect(screen.queryByText('Resolved Live Monitoring Workspace')).toBeNull();
  expect(screen.getByRole('button', { name: 'Sign In' })).toBeTruthy();
});

it('contains a failed /ppe route inside the shell and resets error state when navigating to /zones', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  lazyState.failPpe = true;
  const { cache } = setupMocks();
  render(
    <QueryClientProvider client={cache}>
      <MemoryRouter initialEntries={['/ppe']}>
        <AuthContext.Provider
          value={{
            accessToken: 'test-token',
            setAccessToken: vi.fn(),
            isSessionExpired: false,
            triggerSessionExpired: vi.fn(),
            dismissSessionExpired: vi.fn(),
          }}
        >
          <App />
        </AuthContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByRole('navigation', { name: 'Shell navigation' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Nav Zones' }));
  expect(await screen.findByText('Zone Workspace Ready')).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});
