// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { RestrictedZoneView } from './RestrictedZoneView';
import { SmartSiteManagementClient, ApiError } from '@smartsite/api-client';
import type { LoginResponse, SiteResponse, Page } from '@smartsite/api-client';
import type { CameraResponse, RegionResponse } from './zonePolygonAdapter';
import type { DecodedPreview } from '../cameras/useRealtimePreview';
import type { VideoTestDetection } from '../cameras/videoTestFixture';
import { AuthContext } from '../../features/auth/auth-session';

if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const previewState = vi.hoisted(() => ({
  preview: null as DecodedPreview | null,
  status: 'LIVE' as 'DISCONNECTED' | 'CONNECTING' | 'LIVE' | 'REPLAY' | 'UNAVAILABLE',
  error: null as string | null,
  errorStatus: null as number | null,
  sessionScope: null as string | null,
}));

vi.mock('../cameras/useScopedCameraPreview', () => ({
  useScopedCameraPreview: (options: { sessionScope?: string | null }) => ({
    preview: previewState.preview,
    status: previewState.status,
    sourceKind:
      previewState.status === 'REPLAY' ? 'REPLAY' : previewState.status === 'LIVE' ? 'LIVE' : null,
    error: previewState.error,
    errorStatus:
      previewState.sessionScope === null || previewState.sessionScope === options.sessionScope
        ? previewState.errorStatus
        : null,
    capturedAt: previewState.preview?.frame.capturedAt ?? null,
    retry: vi.fn(),
  }),
}));

vi.mock('../cameras/useRealtimePreview', () => ({
  useRealtimePreview: () => ({ preview: previewState.preview, connected: true, error: null }),
}));

function mockZoneDetection(trackId = 5): VideoTestDetection {
  return {
    active: true,
    alertState: 'CONFIRMED',
    boundingBox: { x1: 0.2, y1: 0.2, x2: 0.6, y2: 0.8 },
    confidence: 0.92,
    eventId: '00000000-0000-4000-8000-000000000002',
    label: 'Intrusion Alert',
    ppeStatus: { HARD_HAT: 'PRESENT', SAFETY_VEST: 'PRESENT' },
    timecode: '02:45',
    trackId,
    regionId: 'zone-exclusion-1',
    cameraExternalId: 'CAM-02',
  };
}

function mockPreview(detection?: VideoTestDetection): DecodedPreview {
  return {
    image: {} as HTMLImageElement,
    frame: {
      sessionId: '00000000-0000-4000-8000-000000000002',
      sequenceNumber: '2',
      cameraExternalId: 'CAM-02',
      capturedAt: '2026-09-30T00:00:00Z',
      width: 640,
      height: 480,
      imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      zonePolygons: [],
      detections: [],
      zoneDetections: detection ? [detection] : [],
    },
  };
}

const mockSitesPage: Page<SiteResponse> = {
  items: [
    {
      id: 'site-alpha',
      code: 'SITE-A',
      name: 'Alpha Site',
      createdAt: '2026-09-30T00:00:00Z',
    },
  ],
  total: 1,
};

const mockCamerasPage: Page<CameraResponse> = {
  items: [
    {
      id: 'cam-1',
      siteId: 'site-alpha',
      code: 'CAM-01',
      name: 'Gate Camera',
      externalId: 'CAM-02',
      status: 'ACTIVE',
      configurationVersion: 3,
      createdAt: '2026-09-30T00:00:00Z',
    },
  ],
  total: 1,
};

const mockRegionsCam1Page: Page<RegionResponse> = {
  items: [
    {
      id: 'reg-1',
      cameraId: 'cam-1',
      zoneId: 'zone-exclusion-1',
      polygon: {
        coordinates: [
          [0.1, 0.1],
          [0.8, 0.1],
          [0.8, 0.8],
          [0.1, 0.8],
        ],
      },
      coordinateSpace: 'NORMALIZED_0_1',
      version: 1,
      isActive: true,
      createdAt: '2026-09-30T00:00:00Z',
    },
  ],
  total: 1,
};

const mockAdminLogin: LoginResponse = {
  accessToken: 'standalone-token',
  tokenType: 'Bearer',
  accessTokenExpiresAt: '2026-10-10T12:00:00Z',
  refreshTokenExpiresAt: '2026-10-11T12:00:00Z',
  user: {
    id: 'admin-standalone',
    displayName: 'Standalone Admin',
    username: 'admin',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [{ role: 'ADMIN', siteId: null }],
  },
};

describe('RestrictedZoneView HTTP 401 Session Expiry Integration', () => {
  let queryClient: QueryClient;
  let triggerSessionExpired: Mock<(expiredScope?: string) => void>;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    });
    previewState.preview = mockPreview(mockZoneDetection(5));
    previewState.status = 'LIVE';
    previewState.error = null;
    previewState.errorStatus = null;
    previewState.sessionScope = null;
    triggerSessionExpired = vi.fn<(expiredScope?: string) => void>();
    vi.spyOn(SmartSiteManagementClient.prototype, 'logout').mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.restoreAllMocks();
  });

  it.each([
    {
      target: 'sites',
      setupMock: () => {
        vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockRejectedValue(
          new ApiError('http', 'Unauthorized sites', 401),
        );
        vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockResolvedValue(
          mockCamerasPage,
        );
        vi.spyOn(SmartSiteManagementClient.prototype, 'listRegions').mockResolvedValue(
          mockRegionsCam1Page,
        );
      },
    },
    {
      target: 'cameras',
      setupMock: () => {
        vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue(mockSitesPage);
        vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockRejectedValue(
          new ApiError('http', 'Unauthorized cameras', 401),
        );
        vi.spyOn(SmartSiteManagementClient.prototype, 'listRegions').mockResolvedValue(
          mockRegionsCam1Page,
        );
      },
    },
  ])(
    'triggers session expiry and onSignOut when metadata query ($target) returns HTTP 401 in sharedSession',
    async ({ setupMock }) => {
      setupMock();
      const onSignOut = vi.fn();
      const sessionScope = 'scope-shared-admin-401';

      render(
        <AuthContext.Provider
          value={{
            accessToken: 'test-token',
            sessionScope,
            setAccessToken: vi.fn(),
            isSessionExpired: false,
            triggerSessionExpired,
            dismissSessionExpired: vi.fn(),
          }}
        >
          <QueryClientProvider client={queryClient}>
            <RestrictedZoneView
              sharedSession={{
                accessToken: 'test-token',
                user: {
                  id: 'admin-1',
                  displayName: 'Admin User',
                  roleAssignments: [{ role: 'ADMIN', siteId: null }],
                },
                sessionScope,
                onSignOut,
              }}
            />
          </QueryClientProvider>
        </AuthContext.Provider>,
      );

      await waitFor(() => {
        expect(triggerSessionExpired).toHaveBeenCalledTimes(1);
        expect(triggerSessionExpired).toHaveBeenCalledWith(sessionScope);
        expect(onSignOut).toHaveBeenCalledTimes(1);
      });
      expect(screen.queryByText(/Admin Session Active/i)).toBeNull();
      expect(screen.getByText(/Session pending or expired/i)).toBeDefined();
    },
  );

  it('triggers session expiry and onSignOut when scopedPreview encounters HTTP 401', async () => {
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue(mockSitesPage);
    vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockResolvedValue(
      mockCamerasPage,
    );
    vi.spyOn(SmartSiteManagementClient.prototype, 'listRegions').mockResolvedValue(
      mockRegionsCam1Page,
    );

    const onSignOut = vi.fn();
    const sessionScope = 'scope-preview-401';
    previewState.errorStatus = 401;
    previewState.error = 'Phiên làm việc hết hạn hoặc không có quyền xem camera này.';
    previewState.sessionScope = sessionScope;

    render(
      <AuthContext.Provider
        value={{
          accessToken: 'test-token',
          sessionScope,
          setAccessToken: vi.fn(),
          isSessionExpired: false,
          triggerSessionExpired,
          dismissSessionExpired: vi.fn(),
        }}
      >
        <QueryClientProvider client={queryClient}>
          <RestrictedZoneView
            sharedSession={{
              accessToken: 'test-token',
              user: {
                id: 'admin-1',
                displayName: 'Admin User',
                roleAssignments: [{ role: 'ADMIN', siteId: null }],
              },
              sessionScope,
              onSignOut,
            }}
          />
        </QueryClientProvider>
      </AuthContext.Provider>,
    );

    await waitFor(() => {
      expect(triggerSessionExpired).toHaveBeenCalledTimes(1);
      expect(triggerSessionExpired).toHaveBeenCalledWith(sessionScope);
      expect(onSignOut).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText(/Admin Session Active/i)).toBeNull();
    expect(screen.getByText(/Session pending or expired/i)).toBeDefined();
  });

  it.each([
    { scenario: 'changed sessionScope', oldScope: 'old', newScope: 'new' },
    { scenario: 'reused scope', oldScope: 'same', newScope: 'same' },
  ])(
    'late401 from old metadata cannot expire a new credential ($scenario)',
    async ({ oldScope, newScope }) => {
      let rejectOld!: (error: unknown) => void;
      const pending = new Promise<Page<SiteResponse>>((_, reject) => {
        rejectOld = reject;
      });
      vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockImplementation((token) =>
        token === 'old-token' ? pending : Promise.resolve(mockSitesPage),
      );
      vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockResolvedValue(
        mockCamerasPage,
      );
      const onSignOut = vi.fn();
      const ui = (token: string, scope: string) => (
        <AuthContext.Provider
          value={{
            accessToken: token,
            sessionScope: scope,
            setAccessToken: vi.fn(),
            isSessionExpired: false,
            triggerSessionExpired,
            dismissSessionExpired: vi.fn(),
          }}
        >
          <QueryClientProvider client={queryClient}>
            <RestrictedZoneView
              sharedSession={{
                accessToken: token,
                sessionScope: scope,
                onSignOut,
                user: {
                  id: 'admin-1',
                  displayName: 'Admin User',
                  roleAssignments: [{ role: 'ADMIN', siteId: null }],
                },
              }}
            />
          </QueryClientProvider>
        </AuthContext.Provider>
      );
      const view = render(ui('old-token', oldScope));
      await waitFor(() =>
        expect(SmartSiteManagementClient.prototype.listSites).toHaveBeenCalledWith(
          'old-token',
          expect.any(Object),
          expect.any(Object),
        ),
      );
      view.rerender(ui('new-token', newScope));
      await screen.findByRole('option', { name: /CAM-01/ });
      await act(async () => {
        rejectOld(new ApiError('http', 'Old session expired', 401));
      });
      expect(onSignOut).not.toHaveBeenCalled();
      expect(triggerSessionExpired).not.toHaveBeenCalled();
      expect(screen.getByText(/Admin Session Active/i)).toBeDefined();
    },
  );

  it('standalone mode clears session and displays session expired alert upon HTTP 401', async () => {
    const listSitesMock = vi.spyOn(SmartSiteManagementClient.prototype, 'listSites');
    listSitesMock.mockResolvedValueOnce(mockSitesPage);
    vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockResolvedValue(
      mockCamerasPage,
    );
    vi.spyOn(SmartSiteManagementClient.prototype, 'listRegions').mockResolvedValue(
      mockRegionsCam1Page,
    );
    vi.spyOn(SmartSiteManagementClient.prototype, 'login').mockResolvedValue(mockAdminLogin);

    const user = userEvent.setup();

    render(
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView />
      </QueryClientProvider>,
    );

    // Sign in standalone
    const usernameInput = screen.getByPlaceholderText(/Admin username/i);
    const passwordInput = screen.getByPlaceholderText(/Password/i);
    await user.type(usernameInput, 'admin');
    await user.type(passwordInput, 'admin-pass');
    await user.click(screen.getByRole('button', { name: /Sign in as Admin/i }));

    await screen.findByText(/Admin Session Active/i);

    // Now trigger 401 by making listSites fail with 401 on next fetch/refetch
    listSitesMock.mockRejectedValue(new ApiError('http', 'Session expired', 401));

    // Refetch sites to simulate token expiration
    await act(async () => {
      await queryClient.refetchQueries({
        queryKey: ['zone-admin', 'http://localhost:3000', 'admin-standalone', 'sites'],
      });
    });

    // Standalone session should be cleared and session expired message displayed
    await waitFor(() => {
      expect(screen.queryByText(/Admin Session Active/i)).toBeNull();
      expect(screen.getByPlaceholderText(/Admin username/i)).toBeDefined();
    });
    expect(screen.getByText(/Your session is no longer valid. Sign in again./i)).toBeDefined();
  });

  it.each([
    {
      action: 'metadata query',
      trigger: () => {
        vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockRejectedValue(
          new ApiError('http', 'Forbidden site access', 403),
        );
        vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockResolvedValue(
          mockCamerasPage,
        );
        vi.spyOn(SmartSiteManagementClient.prototype, 'listRegions').mockResolvedValue(
          mockRegionsCam1Page,
        );
      },
    },
    {
      action: 'preview error',
      trigger: () => {
        vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue(mockSitesPage);
        vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockResolvedValue(
          mockCamerasPage,
        );
        vi.spyOn(SmartSiteManagementClient.prototype, 'listRegions').mockResolvedValue(
          mockRegionsCam1Page,
        );
        previewState.errorStatus = 403;
        previewState.error = 'Forbidden camera stream';
        previewState.sessionScope = 'scope-forbidden-test';
      },
    },
  ])(
    'HTTP 403 Forbidden on $action does NOT trigger session expiry or onSignOut (distinguishing permission denial from expired session)',
    async ({ trigger }) => {
      trigger();
      const onSignOut = vi.fn();
      const sessionScope = 'scope-forbidden-test';

      render(
        <AuthContext.Provider
          value={{
            accessToken: 'test-token',
            sessionScope,
            setAccessToken: vi.fn(),
            isSessionExpired: false,
            triggerSessionExpired,
            dismissSessionExpired: vi.fn(),
          }}
        >
          <QueryClientProvider client={queryClient}>
            <RestrictedZoneView
              sharedSession={{
                accessToken: 'test-token',
                user: {
                  id: 'admin-1',
                  displayName: 'Admin User',
                  roleAssignments: [{ role: 'ADMIN', siteId: null }],
                },
                sessionScope,
                onSignOut,
              }}
            />
          </QueryClientProvider>
        </AuthContext.Provider>,
      );

      // Cho một khoảng thời gian ngắn để đảm bảo không có lệnh logout nào bị kích hoạt nhầm
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      expect(triggerSessionExpired).not.toHaveBeenCalled();
      expect(onSignOut).not.toHaveBeenCalled();
    },
  );
});
