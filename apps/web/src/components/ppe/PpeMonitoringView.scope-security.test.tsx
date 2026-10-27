// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup, act, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ApiError, SmartSiteManagementClient } from '@smartsite/api-client';
import type { CameraResponse, Page, SiteResponse } from '@smartsite/api-client';
import type { SharedSessionUser } from '../../types/shared-session';
import { PpeMonitoringView } from './PpeMonitoringView';

const fixtureUser: SharedSessionUser = {
  id: 'fixture-officer',
  displayName: 'Fixture Officer',
  roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: 'site-shared-id' }],
};

if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// Hook mocked null as requested by Root specification
vi.mock('../cameras/useScopedCameraPreview', () => ({
  useScopedCameraPreview: () => ({
    preview: null,
    sourceKind: null,
    status: 'UNAVAILABLE',
    error: null,
    isLoading: false,
    isPolling: false,
    cameraExternalId: null,
    capturedAt: null,
    siteId: null,
    cameraId: null,
    retry: vi.fn(),
  }),
}));

vi.mock('../cameras/useRealtimePreview', () => ({
  useRealtimePreview: () => ({
    preview: null,
    connected: false,
    error: null,
  }),
}));

vi.mock('../../features/auth/auth-session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../features/auth/auth-session')>()),
  useAuth: () => ({
    accessToken: null,
    sessionScope: null,
    user: null,
    status: 'idle',
  }),
}));

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
}

describe('PpeMonitoringView Scope & Metadata Security', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('shares pending listSites metadata between two simultaneous identical PPE viewers, and unmounting the first does NOT abort/cancel the query or restart the request', async () => {
    const queryClient = createTestQueryClient();
    let resolveSites!: (value: Page<SiteResponse>) => void;
    const sitesPromise = new Promise<Page<SiteResponse>>((resolve) => {
      resolveSites = resolve;
    });

    let capturedSignal: AbortSignal | undefined;
    const listSitesSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listSites')
      .mockImplementation((_token, _options, requestOptions) => {
        capturedSignal = requestOptions?.signal;
        return sitesPromise;
      });

    vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockResolvedValue({
      items: [],
      total: 0,
    });

    const sharedSession = {
      accessToken: 'token-identical-viewers-test',
      sessionScope: 'scope-identical-viewers-test',
      user: fixtureUser,
    };

    // Render first viewer
    const view1 = render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={sharedSession} />
      </QueryClientProvider>,
    );

    // Render second viewer with identical scope simultaneously
    const view2 = render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={sharedSession} />
      </QueryClientProvider>,
    );

    // 1. Both identical viewers must share the single pending listSites query
    expect(listSitesSpy).toHaveBeenCalledTimes(1);
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);

    // Verify query exists in pending state in QueryClient cache
    const pendingQueriesBefore = queryClient.getQueryCache().findAll();
    const siteQueryBefore = pendingQueriesBefore.find(
      (q) => Array.isArray(q.queryKey) && q.queryKey.includes('sites'),
    );
    expect(siteQueryBefore).toBeDefined();
    expect(siteQueryBefore?.state.status).toBe('pending');

    // 2. Unmount the first viewer
    view1.unmount();

    // 3. First viewer unmounting must NOT abort the signal, must NOT remove query from cache, and must NOT restart request
    expect(capturedSignal?.aborted).toBe(false);
    expect(listSitesSpy).toHaveBeenCalledTimes(1);

    const queriesAfterUnmount1 = queryClient.getQueryCache().findAll();
    const siteQueryAfter = queriesAfterUnmount1.find(
      (q) => Array.isArray(q.queryKey) && q.queryKey.includes('sites'),
    );
    expect(siteQueryAfter).toBeDefined();
    expect(siteQueryAfter?.state.status).toBe('pending');

    // 4. Resolve pending sites request
    await act(async () => {
      resolveSites({
        items: [
          {
            id: 'site-shared-01',
            code: 'SITE-SH01',
            name: 'Công trường Giám sát Chung',
            createdAt: '2026-10-01T00:00:00Z',
          },
        ],
        total: 1,
      });
    });

    // 5. Remaining second viewer successfully renders the resolved site metadata
    expect(
      await screen.findByRole('option', { name: /Công trường Giám sát Chung/ }),
    ).not.toBeNull();
    expect(screen.getAllByText(/Công trường Giám sát Chung/).length).toBeGreaterThanOrEqual(1);

    view2.unmount();
  });

  it('aborts pending Site metadata request via consumed TanStack signal when the last observer unmounts', async () => {
    const queryClient = createTestQueryClient();
    let capturedSignal: AbortSignal | undefined;

    const listSitesSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listSites')
      .mockImplementation((_token, _options, requestOptions) => {
        capturedSignal = requestOptions?.signal;
        return new Promise<Page<SiteResponse>>(() => {}); // Intentionally pending indefinitely
      });

    vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockResolvedValue({
      items: [],
      total: 0,
    });

    const sharedSession = {
      accessToken: 'token-last-observer-test',
      sessionScope: 'scope-last-observer-test',
      user: fixtureUser,
    };

    const view = render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={sharedSession} />
      </QueryClientProvider>,
    );

    // listSites must be triggered and must consume TanStack signal
    expect(listSitesSpy).toHaveBeenCalledTimes(1);
    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);

    // Unmount the sole (last) observer
    view.unmount();

    // Consumed signal MUST be aborted by TanStack Query upon last observer unmount
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('does not display stale Site labels when token rotates at unchanged sessionScope while new metadata is pending, and ensures query keys contain no raw token', async () => {
    const queryClient = createTestQueryClient();
    const oldRawToken = 'RAW_SECRET_TOKEN_ALPHA_12345';
    const newRawToken = 'RAW_SECRET_TOKEN_BETA_67890';
    const unchangedSessionScope = 'session-scope-constant-alpha';

    let resolveNewSites!: (value: Page<SiteResponse>) => void;
    const newSitesPromise = new Promise<Page<SiteResponse>>((resolve) => {
      resolveNewSites = resolve;
    });

    const listSitesSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listSites')
      .mockImplementation((token) => {
        if (token === oldRawToken) {
          return Promise.resolve({
            items: [
              {
                id: 'site-old-id',
                code: 'OLD-SITE',
                name: 'Công trường Cũ Vùng A',
                createdAt: '2026-09-01T00:00:00Z',
              },
            ],
            total: 1,
          });
        }
        if (token === newRawToken) {
          return newSitesPromise;
        }
        return Promise.reject(new Error(`Unexpected token: ${token}`));
      });

    vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockResolvedValue({
      items: [],
      total: 0,
    });

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView
          sharedSession={{
            accessToken: oldRawToken,
            sessionScope: unchangedSessionScope,
            user: fixtureUser,
          }}
        />
      </QueryClientProvider>,
    );

    // 1. Wait for old site label to appear
    expect(await screen.findByRole('option', { name: /Công trường Cũ Vùng A/ })).not.toBeNull();
    expect(screen.getAllByText(/Công trường Cũ Vùng A/).length).toBeGreaterThanOrEqual(1);

    // 2. Verify all Query Keys in cache DO NOT contain the raw token
    const initialQueries = queryClient.getQueryCache().getAll();
    expect(initialQueries.length).toBeGreaterThan(0);
    for (const query of initialQueries) {
      const keyJson = JSON.stringify(query.queryKey);
      expect(keyJson).not.toContain(oldRawToken);
    }

    // 3. Rotate token while keeping sessionScope unchanged
    rerender(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView
          sharedSession={{
            accessToken: newRawToken,
            sessionScope: unchangedSessionScope,
            user: fixtureUser,
          }}
        />
      </QueryClientProvider>,
    );

    // 4. While new metadata is pending, old site labels MUST NOT be shown
    expect(screen.queryByText(/Công trường Cũ Vùng A/)).toBeNull();

    // Verify listSites was called with new token (third arg is requestOptions)
    expect(listSitesSpy).toHaveBeenCalledWith(
      newRawToken,
      { offset: 0, limit: 20 },
      expect.anything(),
    );

    // 5. Verify all Query Keys in cache DO NOT contain newRawToken or oldRawToken
    const updatedQueries = queryClient.getQueryCache().getAll();
    for (const query of updatedQueries) {
      const keyJson = JSON.stringify(query.queryKey);
      expect(keyJson).not.toContain(newRawToken);
      expect(keyJson).not.toContain(oldRawToken);
    }

    // 6. Resolve new sites metadata
    await act(async () => {
      resolveNewSites({
        items: [
          {
            id: 'site-new-id',
            code: 'NEW-SITE',
            name: 'Công trường Mới Vùng B',
            createdAt: '2026-10-01T00:00:00Z',
          },
        ],
        total: 1,
      });
    });

    // 7. New site label is now rendered
    expect(await screen.findByRole('option', { name: /Công trường Mới Vùng B/ })).not.toBeNull();
    expect(screen.getAllByText(/Công trường Mới Vùng B/).length).toBeGreaterThanOrEqual(1);
  });

  it('closes Evidence dialog and clears protected camera detail/actions when camera metadata fails with 403 while preserving permitted site controls', async () => {
    const queryClient = createTestQueryClient();
    const onNavigate = vi.fn();

    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
      items: [
        {
          id: 'site-shared-id',
          code: 'SITE-SH01',
          name: 'Công trường Giám sát Chung',
          createdAt: '2026-10-01T00:00:00Z',
        },
      ],
      total: 1,
    });

    let rejectCamerasWith403 = false;
    vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockImplementation(() => {
      if (rejectCamerasWith403) {
        return Promise.reject(new ApiError('http', 'Forbidden', 403));
      }
      return Promise.resolve({
        items: [
          {
            id: 'cam-shared-01',
            siteId: 'site-shared-id',
            externalId: 'ext-cam-01',
            code: 'CAM-SH01',
            name: 'Camera Cổng Chính',
            status: 'ACTIVE',
            configurationVersion: 1,
            createdAt: '2026-10-01T00:00:00Z',
          } satisfies CameraResponse,
        ],
        total: 1,
      });
    });

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView
          sharedSession={{
            accessToken: 'token-evidence-403-test',
            sessionScope: 'scope-evidence-403-test',
            user: fixtureUser,
          }}
          onNavigate={onNavigate}
        />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole('option', { name: /CAM-SH01 · Camera Cổng Chính/ }),
    ).not.toBeNull();

    fireEvent.click(screen.getByTestId('open-evidence-details-btn'));
    const panel = screen.getByTestId('ai-detection-panel');
    expect(within(panel).getByText(/CAM-SH01 · Camera Cổng Chính/)).not.toBeNull();
    expect(screen.getByTestId('evidence-view-safety-alerts-btn')).not.toBeNull();

    rejectCamerasWith403 = true;
    await act(async () => {
      await queryClient.invalidateQueries({ predicate: (q) => q.queryKey.includes('cameras') });
    });

    expect(await screen.findByRole('alert', { hidden: true })).not.toBeNull();
    expect(screen.queryByTestId('ai-detection-panel')).toBeNull();
    expect(screen.queryByText(/Camera Cổng Chính/)).toBeNull();
    expect(screen.queryByTestId('evidence-view-safety-alerts-btn')).toBeNull();
    expect(screen.getByRole('alert')).not.toBeNull();
    expect(
      screen.getByRole('option', { name: /SITE-SH01 · Công trường Giám sát Chung/ }),
    ).not.toBeNull();
  });

  it('closes Evidence dialog and clears protected camera detail/actions upon same-session camera-view role revocation while preserving permitted site controls', async () => {
    const queryClient = createTestQueryClient();
    const onNavigate = vi.fn();

    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
      items: [
        {
          id: 'site-shared-id',
          code: 'SITE-SH01',
          name: 'Công trường Giám sát Chung',
          createdAt: '2026-10-01T00:00:00Z',
        },
      ],
      total: 1,
    });

    vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockResolvedValue({
      items: [
        {
          id: 'cam-shared-01',
          siteId: 'site-shared-id',
          externalId: 'ext-cam-01',
          code: 'CAM-SH01',
          name: 'Camera Cổng Chính',
          status: 'ACTIVE',
          configurationVersion: 1,
          createdAt: '2026-10-01T00:00:00Z',
        } satisfies CameraResponse,
      ],
      total: 1,
    });

    const sessionBase = {
      accessToken: 'token-evidence-role-revoke-test',
      sessionScope: 'scope-evidence-role-revoke-test',
    };

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView
          sharedSession={{ ...sessionBase, user: fixtureUser }}
          onNavigate={onNavigate}
        />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole('option', { name: /CAM-SH01 · Camera Cổng Chính/ }),
    ).not.toBeNull();

    fireEvent.click(screen.getByTestId('open-evidence-details-btn'));
    const panel = screen.getByTestId('ai-detection-panel');
    expect(within(panel).getByText(/CAM-SH01 · Camera Cổng Chính/)).not.toBeNull();
    expect(screen.getByTestId('evidence-view-safety-alerts-btn')).not.toBeNull();

    rerender(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView
          sharedSession={{
            ...sessionBase,
            user: {
              ...fixtureUser,
              roleAssignments: [{ role: 'WORKER', siteId: 'site-shared-id' }],
            },
          }}
          onNavigate={onNavigate}
        />
      </QueryClientProvider>,
    );

    expect(
      (
        await screen.findAllByText(
          /không có quyền giám sát camera|does not have camera monitoring access/i,
        )
      ).length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.queryByTestId('ai-detection-panel')).toBeNull();
    expect(screen.queryByText(/Camera Cổng Chính/)).toBeNull();
    expect(screen.queryByTestId('evidence-view-safety-alerts-btn')).toBeNull();
    expect(
      screen.getByRole('option', { name: /SITE-SH01 · Công trường Giám sát Chung/ }),
    ).not.toBeNull();
  });
});
