// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { SmartSiteManagementClient, ApiError } from '@smartsite/api-client';
import type { Page, SiteResponse } from '@smartsite/api-client';
import type { CameraResponse } from '@smartsite/contracts';
import { PpeMonitoringView } from './PpeMonitoringView';
import { AuthContext } from '../../features/auth/auth-session';

if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const mockSitesList: Page<SiteResponse> = {
  items: [
    {
      id: 'site-alpha',
      code: 'SITE-A',
      name: 'Công trường Alpha',
      createdAt: '2026-09-30T00:00:00Z',
    },
    {
      id: 'site-beta',
      code: 'SITE-B',
      name: 'Công trường Beta',
      createdAt: '2026-09-30T00:00:00Z',
    },
  ],
  total: 2,
};

const mockCamerasList: Page<CameraResponse> = {
  items: [
    {
      id: 'cam-1',
      siteId: 'site-alpha',
      externalId: 'CAM-01',
      code: 'CAM-01',
      name: 'Camera 01',
      status: 'ACTIVE',
      configurationVersion: 1,
      createdAt: '2026-09-30T00:00:00Z',
    },
    {
      id: 'cam-2',
      siteId: 'site-alpha',
      externalId: 'CAM-02',
      code: 'CAM-02',
      name: 'Camera 02',
      status: 'ACTIVE',
      configurationVersion: 1,
      createdAt: '2026-09-30T00:00:00Z',
    },
  ],
  total: 2,
};

describe('PpeMonitoringView Focused Session 401/403 & Scope Isolation Tests', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue(mockSitesList);
    vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockResolvedValue(
      mockCamerasList,
    );
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.restoreAllMocks();
  });

  it('CURRENT preview 401 safely triggers triggerSessionExpired with active sessionScope', async () => {
    const triggerSessionExpired = vi.fn();
    const activeScope = 'scope-current-401';
    const activeToken = 'token-current-401';

    // Mock getCameraPreview to reject with 401
    vi.spyOn(SmartSiteManagementClient.prototype, 'getCameraPreview').mockRejectedValue(
      new ApiError('http', 'Session token invalid or expired', 401, undefined),
    );

    render(
      <AuthContext.Provider
        value={{
          accessToken: activeToken,
          sessionScope: activeScope,
          isSessionExpired: false,
          triggerSessionExpired,
          dismissSessionExpired: vi.fn(),
          setAccessToken: vi.fn(),
        }}
      >
        <QueryClientProvider client={queryClient}>
          <PpeMonitoringView apiUrl="http://localhost:3000" />
        </QueryClientProvider>
      </AuthContext.Provider>,
    );

    await screen.findByRole('option', { name: /Công trường Alpha/i });

    await waitFor(() => {
      expect(triggerSessionExpired).toHaveBeenCalledTimes(1);
      expect(triggerSessionExpired).toHaveBeenCalledWith(activeScope);
    });
  });

  it('CURRENT preview 403 Forbidden halts preview without triggering logout', async () => {
    const triggerSessionExpired = vi.fn();
    const activeScope = 'scope-current-403';
    const activeToken = 'token-current-403';

    // Mock getCameraPreview to reject with 403 Forbidden
    vi.spyOn(SmartSiteManagementClient.prototype, 'getCameraPreview').mockRejectedValue(
      new ApiError('http', 'Camera permission denied', 403, undefined),
    );

    render(
      <AuthContext.Provider
        value={{
          accessToken: activeToken,
          sessionScope: activeScope,
          isSessionExpired: false,
          triggerSessionExpired,
          dismissSessionExpired: vi.fn(),
          setAccessToken: vi.fn(),
        }}
      >
        <QueryClientProvider client={queryClient}>
          <PpeMonitoringView apiUrl="http://localhost:3000" />
        </QueryClientProvider>
      </AuthContext.Provider>,
    );

    await screen.findByRole('option', { name: /Công trường Alpha/i });

    // Expect preview error UI to show unavailable
    await waitFor(() => {
      expect(screen.getByText(/Camera Snapshot Unavailable/i)).not.toBeNull();
    });

    // Confirm triggerSessionExpired was NEVER called
    expect(triggerSessionExpired).not.toHaveBeenCalled();
  });

  it('Late old 401 after site switch does NOT trigger logout for the new site', async () => {
    const triggerSessionExpired = vi.fn();
    const activeScope = 'scope-switch-site';
    const activeToken = 'token-switch-site';

    // Delay the preview response for site-alpha to simulate late arrival
    let resolveDelayed401: () => void = () => {};
    const delayedPromise = new Promise<Awaited<ReturnType<SmartSiteManagementClient['getCameraPreview']>>>((_, reject) => {
      resolveDelayed401 = () =>
        reject(
          new ApiError('http', 'Delayed 401 from previous site', 401, undefined),
        );
    });
    // Prevent unhandled rejection in node environment if query unmounts
    delayedPromise.catch(() => {});

    const getCameraPreviewMock = vi
      .spyOn(SmartSiteManagementClient.prototype, 'getCameraPreview')
      .mockImplementation((_token, siteId) => {
        if (siteId === 'site-alpha') {
          return delayedPromise;
        }
        return new Promise(() => {}); // hang site-beta query
      });

    render(
      <AuthContext.Provider
        value={{
          accessToken: activeToken,
          sessionScope: activeScope,
          isSessionExpired: false,
          triggerSessionExpired,
          dismissSessionExpired: vi.fn(),
          setAccessToken: vi.fn(),
        }}
      >
        <QueryClientProvider client={queryClient}>
          <PpeMonitoringView apiUrl="http://localhost:3000" />
        </QueryClientProvider>
      </AuthContext.Provider>,
    );

    await screen.findByRole('option', { name: /Công trường Alpha/i });
    await screen.findByRole('option', { name: /Camera 01/i });

    // Wait until getCameraPreview is ACTUALLY reached for site-alpha before switching site
    await waitFor(() => {
      expect(getCameraPreviewMock).toHaveBeenCalledWith(
        activeToken,
        'site-alpha',
        'cam-1',
        expect.anything(),
      );
    });

    // Emulate user selecting site-beta via DOM event
    const siteSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    siteSelect.value = 'site-beta';
    siteSelect.dispatchEvent(new Event('change', { bubbles: true }));

    // Now trigger the delayed 401 for site-alpha
    resolveDelayed401();

    await new Promise((r) => setTimeout(r, 60));
    expect(triggerSessionExpired).not.toHaveBeenCalled();
  });

  it('Late old 401 from a previous sessionScope does NOT trigger logout for a new sessionScope', async () => {
    const triggerSessionExpired = vi.fn();
    const activeToken = 'token-new-scope';
    const currentScope = 'scope-fresh-active';

    render(
      <AuthContext.Provider
        value={{
          accessToken: activeToken,
          sessionScope: currentScope,
          isSessionExpired: false,
          triggerSessionExpired,
          dismissSessionExpired: vi.fn(),
          setAccessToken: vi.fn(),
        }}
      >
        <QueryClientProvider client={queryClient}>
          <PpeMonitoringView apiUrl="http://localhost:3000" />
        </QueryClientProvider>
      </AuthContext.Provider>,
    );

    await screen.findByRole('option', { name: /Công trường Alpha/i });

    // Emulate an old query cache entry belonging to a previous scope 'scope-old-expired'
    const oldQuery = queryClient.getQueryCache().build(queryClient, {
      queryKey: [
        'scoped-camera-preview',
        'http://localhost:3000',
        1,
        'scope-old-expired', // STALE scope
        'site-alpha',
        'cam-1',
        0,
      ],
    });

    oldQuery.setState({
      status: 'error',
      error: new ApiError('http', 'Session expired', 401, undefined),
      errorUpdatedAt: Date.now(),
    });

    queryClient.getQueryCache().notify({
      type: 'updated',
      query: oldQuery,
      action: {
        type: 'error',
        error: new ApiError('http', 'Session expired', 401, undefined),
      },
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(triggerSessionExpired).not.toHaveBeenCalled();
  });

  it('Controlled sharedSession triggers onSignOut when provided upon 401', async () => {
    const onSignOut = vi.fn();
    const triggerSessionExpired = vi.fn();

    vi.spyOn(SmartSiteManagementClient.prototype, 'getCameraPreview').mockRejectedValue(
      new ApiError('http', 'Session token invalid or expired', 401, undefined),
    );

    const controlledSession = {
      accessToken: 'token-controlled',
      sessionScope: 'scope-controlled',
      user: {
        id: 'user-ctrl',
        displayName: 'Controlled User',
        roleAssignments: [],
      },
      onSignOut,
    };

    render(
      <AuthContext.Provider
        value={{
          accessToken: 'token-unused',
          sessionScope: 'scope-unused',
          isSessionExpired: false,
          triggerSessionExpired,
          dismissSessionExpired: vi.fn(),
          setAccessToken: vi.fn(),
        }}
      >
        <QueryClientProvider client={queryClient}>
          <PpeMonitoringView apiUrl="http://localhost:3000" sharedSession={controlledSession} />
        </QueryClientProvider>
      </AuthContext.Provider>,
    );

    await screen.findByRole('option', { name: /Công trường Alpha/i });

    await waitFor(() => {
      expect(onSignOut).toHaveBeenCalledTimes(1);
      expect(triggerSessionExpired).toHaveBeenCalledWith('scope-controlled');
    });
  });
});
