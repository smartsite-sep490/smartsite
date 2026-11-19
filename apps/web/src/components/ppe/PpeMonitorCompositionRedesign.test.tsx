// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient, type LoginResponse } from '@smartsite/api-client';
import type { CameraResponse } from '@smartsite/contracts/management';
import i18n, { LANGUAGE_STORAGE_KEY } from '../../i18n';
import type { ScopedDecodedPreview } from '../cameras/scopedRealtimePreview';
import type { ScopedPreviewStatus } from '../cameras/useScopedCameraPreview';
import { PpeMonitorWorkspace } from './PpeMonitorWorkspace';

const SITE_ID = '11111111-1111-4111-8111-111111111111';

const CAM_1: CameraResponse = {
  id: '22222222-2222-4222-8222-222222222201',
  siteId: SITE_ID,
  code: 'LAPTOP',
  name: 'Camera laptop demo',
  externalId: 'laptop-demo-01',
  status: 'ACTIVE',
  configurationVersion: 2,
  createdAt: '2026-11-19T00:00:00.000Z',
};

const CAM_2: CameraResponse = {
  id: '22222222-2222-4222-8222-222222222202',
  siteId: SITE_ID,
  code: 'CAM-GATE-02',
  name: 'West Staging Gate Camera',
  externalId: 'cam-gate-02',
  status: 'ACTIVE',
  configurationVersion: 1,
  createdAt: '2026-11-19T00:00:00.000Z',
};

const CAM_3: CameraResponse = {
  id: '22222222-2222-4222-8222-222222222203',
  siteId: SITE_ID,
  code: 'CAM-EXCAV-03',
  name: 'South Excavation Camera',
  externalId: 'cam-excav-03',
  status: 'ACTIVE',
  configurationVersion: 1,
  createdAt: '2026-11-19T00:00:00.000Z',
};

const mockState = vi.hoisted(() => ({
  sites: vi.fn(),
  cameras: vi.fn(),
  preview: null as ScopedDecodedPreview | null,
  status: 'LIVE' as ScopedPreviewStatus,
  sourceKind: 'LIVE' as 'LIVE' | 'REPLAY' | null,
  errorStatus: null as number | null,
}));

const mockClient = {
  listSites: mockState.sites,
  listPreviewCameras: mockState.cameras,
  getCameraObservationZones: vi.fn(),
} as unknown as SmartSiteManagementClient;

vi.mock('../../features/auth/auth-session', () => ({
  useManagementClient: () => mockClient,
}));

vi.mock('../cameras/useScopedCameraPreview', () => ({
  useScopedCameraPreview: (opts: { cameraId: string }) => ({
    preview: mockState.preview,
    status: mockState.status,
    sourceKind: mockState.sourceKind,
    capturedAt: '2026-11-19T06:30:00.000Z',
    error: null,
    errorStatus: mockState.errorStatus,
    isLoading: false,
    isPolling: false,
    cameraExternalId: opts.cameraId,
    siteId: SITE_ID,
    cameraId: opts.cameraId,
    retry: vi.fn(),
  }),
}));

vi.mock('../cameras/useScopedCameraMedia', () => ({
  useScopedCameraMedia: () => ({
    image: null,
    frame: null,
    status: 'CONNECTING',
    errorStatus: null,
    retry: vi.fn(),
  }),
}));

vi.mock('../cameras/useScopedRecordedVideo', () => ({
  useScopedRecordedVideo: () => ({
    videoUrl: null,
    isLoading: false,
    errorStatus: null,
    retry: vi.fn(),
  }),
}));

function makePreviewFixture(): ScopedDecodedPreview {
  return {
    image: new Image(),
    frame: {
      cameraExternalId: 'laptop-demo-01',
      sessionId: '33333333-3333-4333-8333-333333333333',
      sequenceNumber: '12',
      capturedAt: '2026-11-19T06:30:00.000Z',
      width: 1280,
      height: 720,
      imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      zonePolygons: [],
      detections: [
        {
          trackId: 3,
          boundingBox: { x1: 0.2, y1: 0.2, x2: 0.4, y2: 0.8 },
          confidence: 0.92,
          ppeStatus: { HARD_HAT: 'PRESENT', SAFETY_VEST: 'PRESENT' },
          confirmedMissingItems: [],
          alertState: 'COMPLIANT',
          active: true,
          label: 'Compliant',
          timecode: 'LIVE',
          eventId: 'REALTIME-ppe-TRACK-3',
          cameraExternalId: 'laptop-demo-01',
        },
      ],
      zoneDetections: [],
    },
  } as unknown as ScopedDecodedPreview;
}

const officerSession: Pick<LoginResponse, 'accessToken' | 'user'> = {
  accessToken: 'tok-officer',
  user: {
    id: 'officer-redesign-1',
    username: 'safety.officer',
    displayName: 'Safety Officer',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: SITE_ID }],
  },
};

describe('PPE Monitor operational composition redesign (1-camera stage, adaptive grid, sticky mode, decluttered chrome)', () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    window.localStorage.clear();
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    await i18n.changeLanguage('en');
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    mockState.preview = makePreviewFixture();
    mockState.status = 'LIVE';
    mockState.sourceKind = 'LIVE';
    mockState.errorStatus = null;
    mockState.sites.mockReset().mockResolvedValue({
      items: [{ id: SITE_ID, code: 'SITE-DEMO', name: 'Demo Site' }],
      total: 1,
    });
    mockState.cameras.mockReset().mockResolvedValue({
      items: [CAM_1],
      total: 1,
    });
    vi.mocked(mockClient.getCameraObservationZones).mockResolvedValue({
      siteId: SITE_ID,
      cameraId: CAM_1.id,
      configurationVersion: 2,
      items: [{ id: '44444444-4444-4444-8444-444444444444', code: 'Z-DEMO', name: 'Demo Zone' }],
      total: 1,
      unresolvedRegionCount: 0,
    });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.restoreAllMocks();
  });

  it('opens a large single-camera Focus stage by default when 1 camera is available and keeps explicit Grid choice sticky across refetches without unassigned placeholder cards', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/ppe']}>
          <PpeMonitorWorkspace
            apiUrl="http://127.0.0.1:3000"
            session={officerSession}
            enableFrameInboxLink
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // 1-camera default opens large FocusedCameraMedia stage, NOT 4-slot wall
    expect(await screen.findByTestId('focused-camera-stage')).toBeTruthy();
    expect(screen.getByTestId('monitor-focus-btn').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('monitor-grid-btn').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('monitor-grid-btn').textContent).toBe('Camera grid (1)');
    expect(screen.queryByTestId('four-source-wall-grid')).toBeNull();
    expect(document.querySelectorAll('[data-testid^="wall-unassigned-slot-"]')).toHaveLength(0);

    // Unobtrusive single help entry (no duplicate inline tour invitation banner)
    expect(screen.getByTestId('safety-task-tour-trigger')).toBeTruthy();
    expect(screen.queryByTestId('safety-task-tour-invitation')).toBeNull();

    // Live video corner is unobstructed by floating frame-observation dropdown while sr-only list remains
    expect(screen.queryByLabelText('Frame observation details')).toBeNull();
    expect(screen.getByRole('list', { name: 'Current frame observations' })).toBeTruthy();

    // Operator explicitly chooses Camera grid: stays in Grid across background metadata refetches
    fireEvent.click(screen.getByTestId('monitor-grid-btn'));
    expect(await screen.findByTestId('four-source-wall-grid')).toBeTruthy();
    expect(screen.getByTestId('monitor-grid-btn').getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelectorAll('[data-testid^="wall-unassigned-slot-"]')).toHaveLength(0);

    await act(async () => {
      await queryClient.invalidateQueries();
    });
    expect(screen.getByTestId('monitor-grid-btn').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('four-source-wall-grid')).toBeTruthy();
  });

  it.each(['Live source video', 'Recorded source video'])(
    'keeps the explicitly selected %s open when a camera catalog refresh adds sources',
    async (transportName) => {
      render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/ppe']}>
            <PpeMonitorWorkspace apiUrl="http://127.0.0.1:3000" session={officerSession} />
          </MemoryRouter>
        </QueryClientProvider>,
      );
      await screen.findByTestId('focused-camera-stage');
      fireEvent.click(screen.getByRole('button', { name: transportName }));
      mockState.cameras.mockResolvedValue({ items: [CAM_1, CAM_2, CAM_3], total: 3 });
      await act(async () => {
        await queryClient.invalidateQueries();
      });
      await waitFor(() =>
        expect(screen.getByTestId('monitor-grid-btn').textContent).toBe('Camera grid (3)'),
      );
      expect(screen.getByTestId('focused-camera-stage')).toBeTruthy();
      expect(screen.getByRole('button', { name: transportName }).getAttribute('aria-pressed')).toBe(
        'true',
      );
      expect(screen.queryByTestId('four-source-wall-grid')).toBeNull();
    },
  );

  it('opens an adaptive multi-camera grid by default when 3 cameras are available with zero empty dummy slots and preserves Escape return from Focus', async () => {
    mockState.cameras.mockResolvedValue({
      items: [CAM_1, CAM_2, CAM_3],
      total: 3,
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/ppe']}>
          <PpeMonitorWorkspace apiUrl="http://127.0.0.1:3000" session={officerSession} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const grid = await screen.findByTestId('four-source-wall-grid');
    expect(grid).toBeTruthy();
    expect(screen.getByTestId('monitor-grid-btn').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('monitor-grid-btn').textContent).toBe('Camera grid (3)');
    expect(screen.getByTestId(`wall-tile-${CAM_1.id}`)).toBeTruthy();
    expect(screen.getByTestId(`wall-tile-${CAM_2.id}`)).toBeTruthy();
    expect(screen.getByTestId(`wall-tile-${CAM_3.id}`)).toBeTruthy();
    expect(document.querySelectorAll('[data-testid^="wall-unassigned-slot-"]')).toHaveLength(0);

    // Enlarge CAM_2 -> Focus stage -> Escape returns to adaptive 3-camera grid with focus restored
    fireEvent.click(screen.getByTestId(`enlarge-camera-btn-${CAM_2.id}`));
    expect(await screen.findByTestId('focused-camera-stage')).toBeTruthy();
    expect(screen.getByTestId('focused-camera-metadata').textContent).toContain(
      'West Staging Gate Camera',
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('focused-camera-stage')).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId(`enlarge-camera-btn-${CAM_2.id}`)),
    );
  });

  it('exposes configured region context with human labels and progressive disclosure directly in default 1-camera Focus without switching to Grid', async () => {
    vi.mocked(mockClient.getCameraObservationZones).mockResolvedValue({
      siteId: SITE_ID,
      cameraId: CAM_1.id,
      configurationVersion: 2,
      items: [
        {
          id: '44444444-4444-4444-8444-444444444401',
          code: 'ZONE-5F8A3B12-9012-4A67-8CDE-1234567890AB',
          name: 'North Crane Restricted Lifting Zone',
        },
        {
          id: '44444444-4444-4444-8444-444444444402',
          code: 'Z-WALK-02',
          name: 'East Perimeter Pedestrian Walkway',
        },
        {
          id: '44444444-4444-4444-8444-444444444403',
          code: 'Z-REBAR-03',
          name: 'Rebar Fabrication Yard',
        },
        {
          id: '44444444-4444-4444-8444-444444444404',
          code: 'Z-PIT-04',
          name: 'Deep Excavation Pit B',
        },
        {
          id: '44444444-4444-4444-8444-444444444405',
          code: 'Z-HOIST-05',
          name: 'Tower Hoist Landing',
        },
        {
          id: '44444444-4444-4444-8444-444444444406',
          code: 'Z-CHEM-06',
          name: 'Chemical Storage Cage',
        },
      ],
      total: 6,
      unresolvedRegionCount: 0,
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/ppe']}>
          <PpeMonitorWorkspace apiUrl="http://127.0.0.1:3000" session={officerSession} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId('focused-camera-stage')).toBeTruthy();
    expect(screen.queryByTestId('four-source-wall-grid')).toBeNull();

    const focusZones = await screen.findByTestId('focused-zone-context');
    await waitFor(() => {
      expect(focusZones.textContent).toContain('North Crane Restricted Lifting Zone');
      expect(focusZones.textContent).toContain('East Perimeter Pedestrian Walkway');
    });
    // UUID-derived zone code must not clutter the visible human label
    expect(focusZones.textContent).not.toContain('5F8A3B12');

    // Remaining 4 regions are progressively disclosed via <details> without switching to Grid
    const overflowDetails = screen.getByTestId(
      `zones-overflow-disclosure-${CAM_1.id}`,
    ) as HTMLDetailsElement;
    expect(overflowDetails.open).toBe(false);
    expect(overflowDetails.querySelector('summary')?.textContent).toBe('+4 zone(s)');

    fireEvent.click(overflowDetails.querySelector('summary')!);
    expect(overflowDetails.open).toBe(true);
    expect(overflowDetails.textContent).toContain('Chemical Storage Cage');
  });

  it('uses 40px 14px layout selector buttons and wraps long unavailable/error statuses safely without nowrap or ellipsis clipping', async () => {
    mockState.preview = null;
    mockState.status = 'UNAVAILABLE';
    mockState.sourceKind = null;
    mockState.errorStatus = 503;

    await i18n.changeLanguage('vi');

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/ppe']}>
          <PpeMonitorWorkspace apiUrl="http://127.0.0.1:3000" session={officerSession} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await screen.findByTestId('focused-camera-stage');

    const gridBtn = screen.getByTestId('monitor-grid-btn');
    const focusBtn = screen.getByTestId('monitor-focus-btn');
    expect(gridBtn.className).toContain('min-h-10');
    expect(gridBtn.className).toContain('text-sm');
    expect(gridBtn.className).not.toContain('min-h-8');
    expect(focusBtn.className).toContain('min-h-10');
    expect(focusBtn.className).toContain('text-sm');
    expect(focusBtn.className).not.toContain('min-h-8');

    const focusedPeopleState = screen.getByTestId('focused-people-state');
    expect(focusedPeopleState.textContent).toContain(
      'Số người không khả dụng (chưa có frame AI hiện hành)',
    );
    expect(focusedPeopleState.className).toContain('min-w-0');
    expect(focusedPeopleState.className).toContain('break-words');
    expect(focusedPeopleState.className).not.toContain('truncate');
    expect(focusedPeopleState.className).not.toContain('whitespace-nowrap');

    const focusedSourceState = screen.getByTestId('focused-source-state');
    expect(focusedSourceState.textContent).toContain('Nguồn camera không khả dụng');
    expect(focusedSourceState.className).not.toContain('truncate');
    expect(focusedSourceState.className).not.toContain('whitespace-nowrap');

    const catalogStatus = screen.getByTestId('monitor-catalog-status');
    expect(catalogStatus.className).not.toContain('whitespace-nowrap');
    expect(catalogStatus.className).not.toContain('truncate');
  });
});
