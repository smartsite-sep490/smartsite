// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { RestrictedZoneView } from './RestrictedZoneView';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import type { LoginResponse, SiteResponse, Page } from '@smartsite/api-client';
import {
  loadLocalDraft,
  saveLocalDraft,
  type CameraResponse,
  type RegionResponse,
} from './zonePolygonAdapter';
import type { DecodedPreview } from '../cameras/useRealtimePreview';
import type { VideoTestDetection } from '../cameras/videoTestFixture';
import type { SharedSession } from '../../types/shared-session';
import i18n from '../../i18n';

// Only synthetic preview fixtures are enabled here; no real capture/inference.
// Individual paused-mode controls explicitly override this test environment.
beforeEach(async () => {
  vi.stubEnv('VITE_AI_WORK_PAUSED', 'false');
  await i18n.changeLanguage('en');
});

if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const state = vi.hoisted(() => ({
  preview: null as DecodedPreview | null,
  status: 'DISCONNECTED' as 'DISCONNECTED' | 'CONNECTING' | 'LIVE' | 'REPLAY' | 'UNAVAILABLE',
  error: null as string | null,
  previewOptions: null as { enabled?: boolean } | null,
}));
vi.mock('../cameras/useScopedCameraPreview', () => ({
  useScopedCameraPreview: (options?: { enabled?: boolean }) => {
    state.previewOptions = options ?? null;
    return {
      preview: state.preview,
      status: state.status,
      sourceKind: state.status === 'REPLAY' ? 'REPLAY' : state.status === 'LIVE' ? 'LIVE' : null,
      error: state.error,
      capturedAt: state.preview?.frame.capturedAt ?? null,
      retry: vi.fn(),
    };
  },
}));
vi.mock('../cameras/useRealtimePreview', () => ({
  useRealtimePreview: () => ({ preview: state.preview, connected: true, error: null }),
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

describe('RestrictedZoneView Navigation & Bounded Review Integration', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    });
    state.preview = mockPreview(mockZoneDetection(5));
    state.status = 'LIVE';
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.restoreAllMocks();
    state.preview = null;
    state.status = 'DISCONNECTED';
    state.error = null;
  });

  it('renders "View in Safety Alerts" action and navigates to incidents with RESTRICTED_ZONE_INTRUSION context', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();

    render(
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView onNavigate={onNavigate} />
      </QueryClientProvider>,
    );

    const alertsNavButton = screen.getByRole('button', { name: /View in Safety Alerts/i });
    expect(alertsNavButton).not.toBeNull();

    await user.click(alertsNavButton);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith('incidents', {
      alertType: 'RESTRICTED_ZONE_INTRUSION',
    });
  });

  it('navigates from Zone Incident Review modal to Safety Alerts when user clicks "Review in Safety Alerts"', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();

    render(
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView onNavigate={onNavigate} />
      </QueryClientProvider>,
    );

    // Mở modal review từ detection bằng nút "Review Incident"
    const reviewIncidentBtn = screen.getByRole('button', { name: /Review Incident/i });
    await user.click(reviewIncidentBtn);

    expect(screen.getByRole('heading', { name: 'Review & Action' })).not.toBeNull();

    const reviewInAlertsBtn = screen.getByRole('button', { name: /Review in Safety Alerts/i });
    await user.click(reviewInAlertsBtn);

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith('incidents', {
      alertType: 'RESTRICTED_ZONE_INTRUSION',
    });

    // Modal phải được đóng sau khi điều hướng
    expect(screen.queryByRole('heading', { name: 'Review & Action' })).toBeNull();
  });

  it('preserves selectedSiteId across all Safety Alerts CTAs (Live banner, Replay header, and modal) without leaking alertId', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();

    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
      items: [
        {
          id: 'site-alpha',
          code: 'SITE-A',
          name: 'Công trường Alpha',
          createdAt: '2026-09-30T00:00:00Z',
        },
      ],
      total: 1,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockResolvedValue({
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
      ],
      total: 1,
    });

    const mockSharedSession: SharedSession = {
      accessToken: 'token-admin-zone',
      sessionScope: 'scope-admin-zone',
      user: {
        id: 'admin-1',
        displayName: 'Admin User',
        roleAssignments: [{ role: 'ADMIN', siteId: null }],
      },
    };

    render(
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView sharedSession={mockSharedSession} onNavigate={onNavigate} />
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: /Công trường Alpha/i });

    // 1. Live banner CTA
    const liveCta = screen.getByRole('button', { name: /View in Safety Alerts/i });
    await user.click(liveCta);
    expect(onNavigate).toHaveBeenLastCalledWith('incidents', {
      alertType: 'RESTRICTED_ZONE_INTRUSION',
      siteId: 'site-alpha',
    });
    expect(onNavigate.mock.calls[0]?.[1]?.alertId).toBeUndefined();

    // 2. Modal review CTA
    const reviewIncidentBtn = screen.getByRole('button', { name: /Review Incident/i });
    await user.click(reviewIncidentBtn);
    const modalCta = screen.getByRole('button', { name: /Review in Safety Alerts/i });
    await user.click(modalCta);
    expect(onNavigate).toHaveBeenLastCalledWith('incidents', {
      alertType: 'RESTRICTED_ZONE_INTRUSION',
      siteId: 'site-alpha',
    });
    expect(onNavigate.mock.calls[1]?.[1]?.alertId).toBeUndefined();

    // 3. Replay banner CTA
    state.preview = null;
    state.status = 'UNAVAILABLE';
    cleanup();
    render(
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView sharedSession={mockSharedSession} onNavigate={onNavigate} />
      </QueryClientProvider>,
    );
    await screen.findByRole('option', { name: /Công trường Alpha/i });
    const replayCta = screen.getByRole('button', { name: /View in Safety Alerts/i });
    await user.click(replayCta);
    expect(onNavigate).toHaveBeenLastCalledWith('incidents', {
      alertType: 'RESTRICTED_ZONE_INTRUSION',
      siteId: 'site-alpha',
    });
    expect(onNavigate.mock.calls[2]?.[1]?.alertId).toBeUndefined();
  });

  it('hides replay table and shows concise technical-live status when live streaming is active', () => {
    // state.preview is set to mockPreview, so isLive is true
    render(
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView />
      </QueryClientProvider>,
    );

    // Bảng replay và tiêu đề Zone Replay Observations phải bị ẩn
    expect(screen.queryByText('Zone Replay Observations')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();

    // Thay vào đó hiển thị thông điệp kỹ thuật live
    expect(screen.getByText('Live Zone Observations Active')).not.toBeNull();
    expect(
      screen.getByText(
        /Technical zone-entry detections are rendered directly on the live camera feed/i,
      ),
    ).not.toBeNull();
  });

  it('displays Replay observations footer status and hides replay table during REPLAY stream playback', () => {
    state.preview = mockPreview(mockZoneDetection(5));
    state.status = 'REPLAY';

    render(
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView />
      </QueryClientProvider>,
    );

    expect(screen.queryByText('Zone Replay Observations')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText('Live Zone Observations Active')).toBeNull();
    expect(screen.getByText('Replay Zone Observations Active')).not.toBeNull();
    expect(
      screen.getByText(
        /Technical zone-entry detections are rendered from recorded video replay stream/i,
      ),
    ).not.toBeNull();
  });

  it('displays technical no-person observations without concluding all-clear or no intrusions when detections are empty', () => {
    state.preview = mockPreview(); // mock preview with empty zoneDetections
    state.status = 'REPLAY';

    render(
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView />
      </QueryClientProvider>,
    );

    // Old all-clear claim MUST be absent
    expect(screen.queryByText(/No Restricted Zone Intrusions/i)).toBeNull();

    // Technical no-target description must be present without safety conclusion
    expect(
      screen.getByText(
        /No AI person observations in this snapshot; no conclusion about safety\/authorization/i,
      ),
    ).not.toBeNull();

    // Result description uses recorded video replay wording rather than live streaming
    expect(
      screen.getByText(/Rendering recorded video replay stream from Camera Preview API/i),
    ).not.toBeNull();
    expect(screen.queryByText(/Streaming live snapshot from Camera Preview API/i)).toBeNull();
  });

  it('shows replay table when live streaming is not active', () => {
    state.preview = null;
    state.status = 'UNAVAILABLE'; // isLive is false

    render(
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView />
      </QueryClientProvider>,
    );

    // Replay table và tiêu đề phải hiển thị khi không có luồng trực tiếp
    expect(screen.getByText('Zone Replay Observations')).not.toBeNull();
    expect(screen.getByRole('table')).not.toBeNull();
    expect(screen.queryByText('Live Zone Observations Active')).toBeNull();
  });
});

describe('RestrictedZoneView Backend Polygon Persistence & Scope Integration', () => {
  let queryClient: QueryClient;
  let updatePolygonSpy: ReturnType<typeof vi.spyOn>;
  let listSitesSpy: ReturnType<typeof vi.spyOn>;
  let listCamerasSpy: ReturnType<typeof vi.spyOn>;
  let listRegionsSpy: ReturnType<typeof vi.spyOn>;

  const mockAdminLogin: LoginResponse = {
    accessToken: 'mock-admin-token',
    tokenType: 'Bearer',
    accessTokenExpiresAt: '2026-10-01T23:59:59Z',
    refreshTokenExpiresAt: '2026-10-02T23:59:59Z',
    user: {
      id: 'admin-user-1',
      username: 'admin',
      displayName: 'Global Administrator',
      roleAssignments: [{ role: 'ADMIN', siteId: null }],
      isActive: true,
      mustChangePassword: false,
    },
  };

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
        externalId: 'CAM-01',
        code: 'CAM-01',
        name: 'Primary Gate Camera',
        status: 'ACTIVE',
        configurationVersion: 3,
        createdAt: '2026-09-30T00:00:00Z',
      },
      {
        id: 'cam-2',
        siteId: 'site-alpha',
        externalId: 'CAM-02',
        code: 'CAM-02',
        name: 'Perimeter Camera',
        status: 'ACTIVE',
        configurationVersion: 5,
        createdAt: '2026-09-30T00:00:00Z',
      },
    ],
    total: 2,
  };

  const mockRegionsCam1Page: Page<RegionResponse> = {
    items: [
      {
        id: 'reg-1',
        cameraId: 'cam-1',
        zoneId: 'zone-1',
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

  const mockRegionsCam2Page: Page<RegionResponse> = {
    items: [
      {
        id: 'reg-2',
        cameraId: 'cam-2',
        zoneId: 'zone-2',
        polygon: {
          coordinates: [
            [0.2, 0.2],
            [0.7, 0.2],
            [0.7, 0.7],
            [0.2, 0.7],
          ],
        },
        coordinateSpace: 'NORMALIZED_0_1',
        version: 2,
        isActive: true,
        createdAt: '2026-09-30T00:00:00Z',
      },
    ],
    total: 1,
  };

  beforeEach(() => {
    localStorage.clear();
    state.preview = mockPreview();
    state.preview.frame.cameraExternalId = 'CAM-01';
    state.status = 'LIVE';
    state.error = null;

    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
        mutations: { retry: false, gcTime: 0 },
      },
    });

    vi.spyOn(SmartSiteManagementClient.prototype, 'logout').mockResolvedValue(undefined as never);
    vi.spyOn(SmartSiteManagementClient.prototype, 'login').mockResolvedValue(mockAdminLogin);
    listSitesSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listSites')
      .mockResolvedValue(mockSitesPage);
    listCamerasSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras')
      .mockResolvedValue(mockCamerasPage);
    vi.spyOn(SmartSiteManagementClient.prototype, 'listCameras').mockResolvedValue(mockCamerasPage);
    listRegionsSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listRegions')
      .mockImplementation((_token, _siteId, cameraId) => {
        if (cameraId === 'cam-2') return Promise.resolve(mockRegionsCam2Page);
        return Promise.resolve(mockRegionsCam1Page);
      });
    updatePolygonSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'updatePolygon')
      .mockResolvedValue({
        configurationVersion: 4,
        region: {
          id: 'reg-1',
          cameraId: 'cam-1',
          zoneId: 'zone-1',
          polygon: {
            coordinates: [
              [0.1, 0.1],
              [0.8, 0.1],
              [0.8, 0.8],
              [0.1, 0.8],
            ],
          },
          coordinateSpace: 'NORMALIZED_0_1',
          version: 2,
          isActive: true,
          createdAt: '2026-09-30T00:00:00Z',
        },
      });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  async function performAdminLogin(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByRole('textbox', { name: /Admin username/i }), 'admin');
    await user.type(screen.getByLabelText(/Password/i), 'secret-password');
    await user.click(screen.getByRole('button', { name: /Sign in as Admin/i }));
    await screen.findByText(/Admin Session Active/i);
    await waitFor(() => {
      const comboboxes = screen.getAllByRole('combobox');
      expect(comboboxes.length).toBe(2);
      expect((comboboxes[1] as HTMLSelectElement).value).toBe('cam-1');
    });
  }

  it('uses the application session and does not log out when leaving zone configuration', async () => {
    const view = render(
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView authenticatedSession={mockAdminLogin} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(listCamerasSpy).toHaveBeenCalled());
    expect(SmartSiteManagementClient.prototype.login).not.toHaveBeenCalled();
    view.unmount();
    expect(SmartSiteManagementClient.prototype.logout).not.toHaveBeenCalled();
  });

  it('Admin login loads monitoring metadata without starting configuration reads or writes', async () => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView />
      </QueryClientProvider>,
    );
    await performAdminLogin(user);
    expect(listSitesSpy).toHaveBeenCalled();
    expect(listCamerasSpy).toHaveBeenCalled();
    expect(listRegionsSpy).not.toHaveBeenCalled();
    expect(updatePolygonSpy).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Edit Zone|Save to Backend/i })).toBeNull();
  });

  it('unauthenticated state hides SAVE TO BACKEND and only allows local draft storage', async () => {
    state.preview = null;
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole('button', { name: /EDIT ZONE/i }));
    expect(screen.queryByRole('button', { name: /SAVE TO BACKEND/i })).toBeNull();

    const saveLocalDraftBtn = screen.getByRole('button', { name: /SAVE LOCAL DRAFT/i });
    expect(saveLocalDraftBtn).not.toBeNull();
    await user.click(saveLocalDraftBtn);

    expect(screen.getByText(/Saved to browser local storage/i)).not.toBeNull();
  });

  describe('RestrictedZoneView Shared Session Integration', () => {
    it('shared-session mounts directly without Admin login panel and does not call client.login', async () => {
      const loginSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'login');

      render(
        <QueryClientProvider client={queryClient}>
          <RestrictedZoneView
            sharedSession={{
              accessToken: 'shared-admin-token',
              user: {
                id: 'admin-1',
                displayName: 'Admin User',
                roleAssignments: [{ role: 'ADMIN', siteId: null }],
              },
              sessionScope: 'scope-admin-zone',
            }}
          />
        </QueryClientProvider>,
      );

      expect(await screen.findByText(/Admin Session Active/i)).toBeDefined();
      expect(screen.queryByText(/SIGN IN AS ADMIN/i)).toBeNull();
      expect(loginSpy).not.toHaveBeenCalled();
    });

    it('unmount in shared session mode cancels and evicts owned queries without calling client.logout', async () => {
      const logoutSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'logout');
      vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue(mockSitesPage);

      const { unmount } = render(
        <QueryClientProvider client={queryClient}>
          <RestrictedZoneView
            sharedSession={{
              accessToken: 'shared-admin-token',
              user: {
                id: 'admin-1',
                displayName: 'Admin User',
                roleAssignments: [{ role: 'ADMIN', siteId: null }],
              },
              sessionScope: 'scope-admin-zone',
            }}
          />
        </QueryClientProvider>,
      );

      await screen.findByText(/Admin Session Active/i);
      expect(
        queryClient.getQueriesData({
          queryKey: ['zone-admin', 'http://localhost:3000', 'scope-admin-zone', 'sites'],
        }),
      ).toHaveLength(1);

      unmount();
      expect(logoutSpy).not.toHaveBeenCalled();
      expect(
        queryClient.getQueriesData({
          queryKey: ['zone-admin', 'http://localhost:3000', 'scope-admin-zone', 'sites'],
        }),
      ).toHaveLength(0);
    });

    it('sharedSession === null renders session pending or expired without standalone login form', async () => {
      const listSitesSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'listSites');

      render(
        <QueryClientProvider client={queryClient}>
          <RestrictedZoneView sharedSession={null} />
        </QueryClientProvider>,
      );

      expect(await screen.findByText(/Session pending or expired/i)).toBeDefined();
      expect(screen.queryByText(/Sign in as Admin/i)).toBeNull();
      expect(screen.queryByPlaceholderText(/Admin username/i)).toBeNull();
      expect(listSitesSpy).not.toHaveBeenCalled();
    });

    it('restricted user (Worker) is denied without firing protected queries or signing out of app', async () => {
      const listSitesSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'listSites');
      const onSignOut = vi.fn();

      render(
        <QueryClientProvider client={queryClient}>
          <RestrictedZoneView
            sharedSession={{
              accessToken: 'worker-token',
              user: {
                id: 'worker-1',
                displayName: 'John Worker',
                roleAssignments: [{ role: 'WORKER', siteId: 'site-alpha' }],
              },
              sessionScope: 'scope-worker-zone',
              onSignOut,
            }}
          />
        </QueryClientProvider>,
      );

      expect(await screen.findByText(/Zone Configuration is restricted/i)).toBeDefined();
      expect(screen.getByText(/A global Admin role.*is required/i)).toBeDefined();
      expect(listSitesSpy).not.toHaveBeenCalled();
      expect(onSignOut).not.toHaveBeenCalled();
    });

    it('explicit sign-out delegates to sharedSession.onSignOut and does not call client.logout', async () => {
      const user = userEvent.setup();
      const onSignOut = vi.fn();
      const logoutSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'logout');

      render(
        <QueryClientProvider client={queryClient}>
          <RestrictedZoneView
            sharedSession={{
              accessToken: 'shared-admin-token',
              user: {
                id: 'admin-1',
                displayName: 'Admin User',
                roleAssignments: [{ role: 'ADMIN', siteId: null }],
              },
              sessionScope: 'scope-admin-zone',
              onSignOut,
            }}
          />
        </QueryClientProvider>,
      );

      await screen.findByText(/Admin Session Active/i);
      const signOutBtn = screen.getByRole('button', { name: /SIGN OUT/i });
      await user.click(signOutBtn);

      expect(onSignOut).toHaveBeenCalledTimes(1);
      expect(logoutSpy).not.toHaveBeenCalled();
    });

    it('admits Site Safety Officer with preview read-only, filters assigned sites, and does not show region mutation controls', async () => {
      vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
        items: [
          {
            id: 'site-alpha',
            code: 'SITE-A',
            name: 'Alpha Site',
            createdAt: '2026-09-30T00:00:00Z',
          },
          { id: 'site-beta', code: 'SITE-B', name: 'Beta Site', createdAt: '2026-09-30T00:00:00Z' },
        ],
        total: 2,
      });
      vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockResolvedValue(
        mockCamerasPage,
      );
      const listRegionsMock = vi
        .spyOn(SmartSiteManagementClient.prototype, 'listRegions')
        .mockResolvedValue(mockRegionsCam1Page);

      render(
        <QueryClientProvider client={queryClient}>
          <RestrictedZoneView
            sharedSession={{
              accessToken: 'safety-token',
              user: {
                id: 'so-1',
                displayName: 'Safety Officer Dave',
                roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: 'site-alpha' }],
              },
              sessionScope: 'scope-so-zone',
            }}
          />
        </QueryClientProvider>,
      );

      // Verify Safety Officer Session is admitted
      expect(await screen.findByText(/Safety Officer Session Active \(Read-Only\)/i)).toBeDefined();
      expect(screen.getAllByText(/Restricted Zone \(Read-Only\)/i).length).toBeGreaterThan(0);

      // Only assigned site (site-alpha) should be in the dropdown
      const siteSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
      await waitFor(() => {
        expect(siteSelect.options.length).toBe(1);
        expect(siteSelect.value).toBe('site-alpha');
      });

      // Edit zone button and region mutations should NOT be available
      expect(screen.queryByRole('button', { name: /EDIT ZONE/i })).toBeNull();
      expect(screen.queryByRole('button', { name: /SAVE TO BACKEND/i })).toBeNull();

      // listRegions should NOT be called for Safety Officer
      expect(listRegionsMock).not.toHaveBeenCalled();
    });

    it('when camera preview is unavailable, shows snapshot unavailable notice and never renders silent fixture video', async () => {
      state.preview = null;
      state.status = 'UNAVAILABLE';
      state.error = 'Snapshot feed disconnected';

      render(
        <QueryClientProvider client={queryClient}>
          <RestrictedZoneView
            sharedSession={{
              accessToken: 'shared-admin-token',
              user: {
                id: 'admin-1',
                displayName: 'Admin User',
                roleAssignments: [{ role: 'ADMIN', siteId: null }],
              },
              sessionScope: 'scope-admin-zone',
            }}
          />
        </QueryClientProvider>,
      );

      // Verify Snapshot Unavailable notice is shown
      expect(await screen.findByText(/Camera Snapshot Unavailable/i)).toBeDefined();
      expect(screen.getAllByText(/Snapshot feed disconnected/i).length).toBeGreaterThan(0);

      // Verify NO video fixture element is rendered
      expect(screen.queryByLabelText(/Restricted-zone test video/i)).toBeNull();
      // Verify badge displays UNAVAILABLE
      expect(screen.getByText(/MF06 SNAPSHOT UNAVAILABLE/i)).toBeDefined();
    });
  });

  describe('Single-Runtime i18n Language Switching', () => {
    const adminSession: SharedSession = {
      accessToken: 'token-admin-zone-i18n',
      sessionScope: 'scope-admin-zone-i18n',
      user: {
        id: 'admin-zone-i18n-1',
        username: 'admin.i18n',
        displayName: 'Admin Zone i18n',
        roleAssignments: [{ role: 'ADMIN', siteId: null }],
      },
    };

    const i18nSites: Page<SiteResponse> = {
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

    const i18nCameras: Page<CameraResponse> = {
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
          id: 'cam-beta-1',
          siteId: 'site-beta',
          externalId: 'CAM-02',
          code: 'CAM-02',
          name: 'Camera Beta 02',
          status: 'ACTIVE',
          configurationVersion: 2,
          createdAt: '2026-09-30T00:00:00Z',
        },
      ],
      total: 2,
    };

    const i18nRegionsBeta: Page<RegionResponse> = {
      items: [
        {
          id: 'region-beta-1',
          cameraId: 'cam-beta-1',
          zoneId: 'zone-beta-1',
          polygon: {
            coordinates: [
              [0.2, 0.2],
              [0.8, 0.2],
              [0.8, 0.8],
              [0.2, 0.8],
            ],
          },
          coordinateSpace: 'NORMALIZED_0_1',
          version: 1,
          isActive: true,
          createdAt: '2026-09-30T00:00:00Z',
        },
        {
          id: 'region-beta-2',
          cameraId: 'cam-beta-1',
          zoneId: 'zone-beta-2',
          polygon: {
            coordinates: [
              [0.25, 0.25],
              [0.75, 0.25],
              [0.75, 0.75],
              [0.25, 0.75],
            ],
          },
          coordinateSpace: 'NORMALIZED_0_1',
          version: 2,
          isActive: true,
          createdAt: '2026-09-30T00:00:00Z',
        },
      ],
      total: 2,
    };

    beforeEach(async () => {
      await i18n.changeLanguage('en');
      window.localStorage.clear();
      state.preview = mockPreview(mockZoneDetection(5));
      state.status = 'LIVE';
      state.error = null;
      state.previewOptions = null;

      vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue(i18nSites);
      vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockImplementation(
        async (_token, siteId) => ({
          items: i18nCameras.items.filter((c) => c.siteId === siteId),
          total: i18nCameras.items.filter((c) => c.siteId === siteId).length,
        }),
      );
      vi.spyOn(SmartSiteManagementClient.prototype, 'listRegions').mockImplementation(
        async (_token, siteId) =>
          siteId === 'site-beta'
            ? i18nRegionsBeta
            : {
                items: [
                  {
                    id: 'region-alpha-1',
                    cameraId: 'cam-1',
                    zoneId: 'zone-alpha-1',
                    polygon: {
                      coordinates: [
                        [0.1, 0.1],
                        [0.9, 0.1],
                        [0.9, 0.9],
                        [0.1, 0.9],
                      ],
                    },
                    coordinateSpace: 'NORMALIZED_0_1',
                    version: 1,
                    isActive: true,
                    createdAt: '2026-09-30T00:00:00Z',
                  },
                ],
                total: 1,
              },
      );
    });

    afterEach(async () => {
      await i18n.changeLanguage('en');
      window.localStorage.clear();
      vi.unstubAllEnvs();
      state.previewOptions = null;
    });

    it('switching language preserves monitoring scope, historical browser draft and Safety navigation', async () => {
      const user = userEvent.setup();
      const onNavigate = vi.fn();
      saveLocalDraft('site-beta', 'cam-beta-1', 'region-beta-2', 2, [
        [0.15, 0.2],
        [0.85, 0.2],
        [0.85, 0.85],
        [0.15, 0.85],
      ]);
      const savedDraft = loadLocalDraft('site-beta', 'cam-beta-1', 'region-beta-2', 2);
      render(
        <QueryClientProvider client={queryClient}>
          <RestrictedZoneView sharedSession={adminSession} onNavigate={onNavigate} />
        </QueryClientProvider>,
      );
      await screen.findByRole('option', { name: /Công trường Beta/i });
      await user.selectOptions(document.getElementById('zone-site-select')!, 'site-beta');
      await screen.findByRole('option', { name: /Camera Beta 02/i });
      for (const language of ['vi', 'en']) {
        await act(async () => {
          await i18n.changeLanguage(language);
        });
        expect((document.getElementById('zone-site-select') as HTMLSelectElement).value).toBe(
          'site-beta',
        );
        expect((document.getElementById('zone-camera-select') as HTMLSelectElement).value).toBe(
          'cam-beta-1',
        );
        expect(document.getElementById('zone-region-geometry-select')).toBeNull();
        expect(loadLocalDraft('site-beta', 'cam-beta-1', 'region-beta-2', 2)).toEqual(savedDraft);
      }
      await user.click(screen.getByRole('button', { name: /View in Safety Alerts/i }));
      expect(onNavigate).toHaveBeenCalledWith('incidents', {
        alertType: 'RESTRICTED_ZONE_INTRUSION',
        siteId: 'site-beta',
      });
      expect(updatePolygonSpy).not.toHaveBeenCalled();
    });

    it('paused mode (VITE_AI_WORK_PAUSED=true) across language switches retranslates paused banner and viewport while keeping preview polling disabled and preventing geometry editing', async () => {
      vi.stubEnv('VITE_AI_WORK_PAUSED', 'true');

      const { container } = render(
        <QueryClientProvider client={queryClient}>
          <RestrictedZoneView sharedSession={adminSession} />
        </QueryClientProvider>,
      );

      await screen.findByRole('option', { name: /Công trường Alpha/i });

      // In English: paused banner and viewport are shown, preview polling is disabled, EDIT ZONE is disabled
      const banner = await screen.findByTestId('ai-work-paused-banner');
      expect(banner.textContent).toContain('AI Work Paused by Human Operator');
      expect(screen.getByText('Camera preview paused')).toBeDefined();
      expect(screen.getByText('AI Work Paused')).toBeDefined();
      expect(screen.getByText('AI monitoring & streaming paused')).toBeDefined();
      expect(screen.queryByText('ppe.header.paused')).toBeNull();
      expect(screen.queryByText('ppe.controls.paused')).toBeNull();
      expect(state.previewOptions?.enabled).toBe(false);

      expect(screen.queryByRole('button', { name: /EDIT ZONE/i })).toBeNull();
      expect(container.querySelectorAll('circle').length).toBe(0);

      // Switch to Vietnamese
      await act(async () => {
        await i18n.changeLanguage('vi');
      });

      expect(screen.getByTestId('ai-work-paused-banner').textContent).toContain(
        'Tác vụ AI đang tạm dừng theo lệnh vận hành',
      );
      expect(screen.getByText('Đã tạm dừng xem trước camera')).toBeDefined();
      expect(screen.getByText('Tạm dừng xử lý AI')).toBeDefined();

      // Paused guards remain strictly enforced after language switch
      expect(state.previewOptions?.enabled).toBe(false);
      expect(screen.queryByRole('button', { name: /SỬA KHU VỰC/i })).toBeNull();
      expect(container.querySelectorAll('circle').length).toBe(0);
    });
  });
});
