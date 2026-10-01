// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { RestrictedZoneView } from './RestrictedZoneView';
import { SmartSiteManagementClient, ApiError } from '@smartsite/api-client';
import type { LoginResponse, SiteResponse, Page } from '@smartsite/api-client';
import {
  getDraftStorageKey,
  loadLocalDraft,
  saveLocalDraft,
  type CameraResponse,
  type RegionResponse,
} from './zonePolygonAdapter';
import type { DecodedPreview } from '../cameras/useRealtimePreview';
import type { VideoTestDetection } from '../cameras/videoTestFixture';

if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const state = vi.hoisted(() => ({ preview: null as DecodedPreview | null }));
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
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.restoreAllMocks();
    state.preview = null;
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

  it('shows replay table when live streaming is not active', () => {
    state.preview = null; // isLive is false

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
    state.preview = null;

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
      .spyOn(SmartSiteManagementClient.prototype, 'listCameras')
      .mockResolvedValue(mockCamerasPage);
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
      expect(comboboxes.length).toBe(3);
      expect((comboboxes[2] as HTMLSelectElement).value).toBe('reg-1');
    });
  }

  it('Admin login loads real-shaped Site/Camera/Region responses and displays server synced state', async () => {
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView />
      </QueryClientProvider>,
    );

    await performAdminLogin(user);

    expect(listSitesSpy).toHaveBeenCalledWith('mock-admin-token', { limit: 100 });
    expect(listCamerasSpy).toHaveBeenCalledWith('mock-admin-token', 'site-alpha', { limit: 100 });
    expect(listRegionsSpy).toHaveBeenCalledWith('mock-admin-token', 'site-alpha', 'cam-1', {
      limit: 100,
    });

    const comboboxes = screen.getAllByRole('combobox');
    expect(comboboxes).toHaveLength(3);
    expect((comboboxes[0] as HTMLSelectElement).value).toBe('site-alpha');
    expect((comboboxes[1] as HTMLSelectElement).value).toBe('cam-1');
    expect((comboboxes[2] as HTMLSelectElement).value).toBe('reg-1');

    expect(screen.getByText(/Server Synced \(v3\)/i)).not.toBeNull();
  });

  it('SAVE TO BACKEND sends selected IDs and expectedConfigurationVersion with exact normalized coordinates', async () => {
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView />
      </QueryClientProvider>,
    );

    await performAdminLogin(user);

    await user.click(screen.getByRole('button', { name: /EDIT ZONE/i }));
    const saveBtn = await screen.findByRole('button', { name: /SAVE TO BACKEND/i });
    await user.click(saveBtn);

    expect(updatePolygonSpy).toHaveBeenCalledTimes(1);
    expect(updatePolygonSpy).toHaveBeenCalledWith(
      'mock-admin-token',
      'site-alpha',
      'cam-1',
      'reg-1',
      {
        expectedConfigurationVersion: 3,
        polygon: {
          coordinates: [
            [0.1, 0.1],
            [0.8, 0.1],
            [0.8, 0.8],
            [0.1, 0.8],
          ],
        },
      },
    );
  });

  it('success uses returned configuration version and clears only the matching draft', async () => {
    const user = userEvent.setup();

    // Pre-seed two distinct local drafts
    saveLocalDraft('site-alpha', 'cam-1', 'reg-1', 3, [
      [0.1, 0.1],
      [0.8, 0.1],
      [0.8, 0.8],
    ]);
    saveLocalDraft('site-alpha', 'cam-2', 'reg-2', 5, [
      [0.2, 0.2],
      [0.7, 0.2],
      [0.7, 0.7],
    ]);

    render(
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView />
      </QueryClientProvider>,
    );

    await performAdminLogin(user);

    await user.click(screen.getByRole('button', { name: /EDIT ZONE/i }));
    await user.click(screen.getByRole('button', { name: /SAVE TO BACKEND/i }));

    await screen.findByText(/Saved polygon to CAM-01 \(version 4\)\./i);

    // Verify raw storage key is null directly before any load cleanup can occur
    expect(localStorage.getItem(getDraftStorageKey('site-alpha', 'cam-1', 'reg-1'))).toBeNull();
    // And loadLocalDraft with the original version 3 confirms absence
    expect(loadLocalDraft('site-alpha', 'cam-1', 'reg-1', 3).status).toBe('none');

    // cam-2 draft on different camera must remain intact in raw storage and valid
    expect(localStorage.getItem(getDraftStorageKey('site-alpha', 'cam-2', 'reg-2'))).not.toBeNull();
    expect(loadLocalDraft('site-alpha', 'cam-2', 'reg-2', 5).status).toBe('valid');
  });

  it('409 reloads server config and displays conflict banner without auto-overwriting', async () => {
    const user = userEvent.setup();

    const updatedCamerasPage: Page<CameraResponse> = {
      items: [
        {
          id: 'cam-1',
          siteId: 'site-alpha',
          externalId: 'CAM-01',
          code: 'CAM-01',
          name: 'Primary Gate Camera',
          status: 'ACTIVE',
          configurationVersion: 4,
          createdAt: '2026-09-30T00:00:00Z',
        },
        mockCamerasPage.items[1]!,
      ],
      total: 2,
    };

    const updatedRegionsCam1Page: Page<RegionResponse> = {
      items: [
        {
          id: 'reg-1',
          cameraId: 'cam-1',
          zoneId: 'zone-1',
          polygon: {
            coordinates: [
              [0.2, 0.2],
              [0.9, 0.2],
              [0.9, 0.9],
              [0.2, 0.9],
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

    updatePolygonSpy.mockRejectedValueOnce(new ApiError('http', 'Configuration conflict', 409));

    render(
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView />
      </QueryClientProvider>,
    );

    await performAdminLogin(user);

    // Initial query call counts
    const initialCameraQueryCalls = listCamerasSpy.mock.calls.length;
    const initialRegionQueryCalls = listRegionsSpy.mock.calls.length;

    // Subsequent refetch returns updated camera configuration and geometry from server
    listCamerasSpy.mockResolvedValue(updatedCamerasPage);
    listRegionsSpy.mockImplementation((_token: string, _siteId: string, cameraId: string) => {
      if (cameraId === 'cam-2') return Promise.resolve(mockRegionsCam2Page);
      return Promise.resolve(updatedRegionsCam1Page);
    });

    await user.click(screen.getByRole('button', { name: /EDIT ZONE/i }));
    await user.click(screen.getByRole('button', { name: /SAVE TO BACKEND/i }));

    const conflictAlert = await screen.findByRole('alert');
    expect(conflictAlert.textContent).toContain('Configuration Version Conflict (HTTP 409)');
    expect(conflictAlert.textContent).toContain(
      'Camera CAM-01 was modified by another operator or process',
    );
    expect(screen.getByRole('button', { name: /Load Server Version/i })).not.toBeNull();

    // 409 invalidates queries: assert listCameras and listRegions were refetched
    await waitFor(() => {
      expect(listCamerasSpy.mock.calls.length).toBeGreaterThan(initialCameraQueryCalls);
      expect(listRegionsSpy.mock.calls.length).toBeGreaterThan(initialRegionQueryCalls);
    });

    // Crucial: updatePolygon was NOT automatically retried / overwritten
    expect(updatePolygonSpy).toHaveBeenCalledTimes(1);

    // Prepare mock for next explicit save
    updatePolygonSpy.mockResolvedValueOnce({
      configurationVersion: 5,
      region: {
        ...updatedRegionsCam1Page.items[0]!,
        version: 3,
      },
    });

    // Click "Load Server Version"
    await user.click(screen.getByRole('button', { name: /Load Server Version/i }));

    // Banner should disappear and public UI should reflect server synced version 4
    expect(screen.queryByRole('alert')).toBeNull();
    await screen.findByText(/Server Synced \(v4\)/i);
    expect(screen.getByText(/Restored authoritative server polygon\./i)).not.toBeNull();

    // Next explicit save sends expectedConfigurationVersion: 4 and new server coordinates
    await user.click(screen.getByRole('button', { name: /EDIT ZONE/i }));
    await user.click(screen.getByRole('button', { name: /SAVE TO BACKEND/i }));

    expect(updatePolygonSpy).toHaveBeenCalledTimes(2);
    expect(updatePolygonSpy).toHaveBeenLastCalledWith(
      'mock-admin-token',
      'site-alpha',
      'cam-1',
      'reg-1',
      {
        expectedConfigurationVersion: 4,
        polygon: {
          coordinates: [
            [0.2, 0.2],
            [0.9, 0.2],
            [0.9, 0.9],
            [0.2, 0.9],
          ],
        },
      },
    );
  });

  it('switching scope during mutation does not apply stale result to new camera', async () => {
    const user = userEvent.setup();

    let resolveMutation!: (value: unknown) => void;
    updatePolygonSpy.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveMutation = resolve;
      }),
    );

    render(
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView />
      </QueryClientProvider>,
    );

    await performAdminLogin(user);

    await user.click(screen.getByRole('button', { name: /EDIT ZONE/i }));
    await user.click(screen.getByRole('button', { name: /SAVE TO BACKEND/i }));

    // User switches to cam-2 before mutation resolves
    const comboboxes = screen.getAllByRole('combobox');
    expect(comboboxes[1]).toBeDefined();
    await user.selectOptions(comboboxes[1]!, 'cam-2');

    // Await selected reg-2 public state and server synced v5 on cam-2
    await waitFor(() => {
      const selects = screen.getAllByRole('combobox');
      expect((selects[1] as HTMLSelectElement).value).toBe('cam-2');
      expect((selects[2] as HTMLSelectElement).value).toBe('reg-2');
    });
    await screen.findByText(/Server Synced \(v5\)/i);

    // Resolve deferred mutation inside awaited act() so stale response is fully consumed
    await act(async () => {
      resolveMutation({
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
            ],
          },
          coordinateSpace: 'NORMALIZED_0_1',
          version: 2,
          isActive: true,
          createdAt: '2026-09-30T00:00:00Z',
        },
      });
    });

    // Assert camera 2 version/region 2 state remains completely unchanged and no CAM-01 success banner appears
    expect(screen.queryByText(/Saved polygon to CAM-01/i)).toBeNull();
    const finalComboboxes = screen.getAllByRole('combobox');
    expect((finalComboboxes[1] as HTMLSelectElement).value).toBe('cam-2');
    expect((finalComboboxes[2] as HTMLSelectElement).value).toBe('reg-2');
    expect(screen.getByText(/Server Synced \(v5\)/i)).not.toBeNull();
  });

  it('preserves camera mismatch guard when live preview does not match selected camera', async () => {
    state.preview = mockPreview(mockZoneDetection(5)); // cameraExternalId: 'CAM-02'
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={queryClient}>
        <RestrictedZoneView />
      </QueryClientProvider>,
    );

    await performAdminLogin(user);

    // Selected camera is CAM-01, preview is CAM-02 -> EDIT ZONE button should be disabled
    const editBtn = screen.getByRole('button', { name: /EDIT ZONE/i });
    expect(editBtn.getAttribute('disabled')).not.toBeNull();
    expect(editBtn.getAttribute('title')).toContain(
      'Select the matching Backend camera before editing this preview',
    );
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
});
