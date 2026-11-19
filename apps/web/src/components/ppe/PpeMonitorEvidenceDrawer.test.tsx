// @vitest-environment jsdom
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient, type LoginResponse } from '@smartsite/api-client';
import type { CameraResponse } from '@smartsite/contracts/management';
import i18n, { LANGUAGE_STORAGE_KEY } from '../../i18n';
import type { ScopedDecodedPreview } from '../cameras/scopedRealtimePreview';
import type { ScopedPreviewStatus } from '../cameras/useScopedCameraPreview';
import { FocusedCameraMedia } from './FocusedCameraMedia';
import { PpeMonitorWorkspace } from './PpeMonitorWorkspace';

const SITE_ID = '11111111-1111-4111-8111-111111111111';
const CAM_01: CameraResponse = {
  type: 'ZONE',
  gateId: null,
  id: '22222222-2222-4222-8222-222222222221',
  siteId: SITE_ID,
  code: 'CAM-01',
  name: 'North Gate Camera',
  externalId: 'rtsp://operator:topsecret@10.0.0.15:554/live-01',
  status: 'ACTIVE',
  configurationVersion: 4,
  createdAt: '2026-11-01T00:00:00.000Z',
};
const CAM_02: CameraResponse = {
  type: 'ZONE',
  gateId: null,
  id: '22222222-2222-4222-8222-222222222222',
  siteId: SITE_ID,
  code: 'CAM-02',
  name: 'East Crane Camera',
  externalId: 'rtsp-cam-02',
  status: 'ACTIVE',
  configurationVersion: 2,
  createdAt: '2026-11-01T00:00:00.000Z',
};

const mockState = vi.hoisted(() => ({
  byCamera: new Map<
    string,
    {
      preview: ScopedDecodedPreview | null;
      status: ScopedPreviewStatus;
      sourceKind: 'LIVE' | 'REPLAY' | null;
      errorStatus: number | null;
      isLoading: boolean;
    }
  >(),
  rawImage: null as HTMLImageElement | null,
  rawStatus: 'CONNECTING' as 'LIVE' | 'CONNECTING' | 'HALTED',
  rawErrorStatus: null as number | null,
  sites: vi.fn(),
  cameras: vi.fn(),
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
  useScopedCameraPreview: (opts: { cameraId: string }) => {
    const entry = mockState.byCamera.get(opts.cameraId) ?? {
      preview: null,
      status: 'UNAVAILABLE' as const,
      sourceKind: null,
      errorStatus: 503,
      isLoading: false,
    };
    return {
      preview: entry.preview,
      status: entry.status,
      sourceKind: entry.sourceKind,
      capturedAt: entry.preview ? '2026-11-18T04:15:00.000Z' : null,
      error: entry.preview ? null : 'Offline',
      errorStatus: entry.errorStatus,
      isLoading: entry.isLoading,
      isPolling: false,
      cameraExternalId: opts.cameraId,
      siteId: SITE_ID,
      cameraId: opts.cameraId,
      retry: vi.fn(),
    };
  },
}));

vi.mock('../cameras/useScopedCameraMedia', () => ({
  useScopedCameraMedia: () => ({
    image: mockState.rawImage,
    frame: mockState.rawImage ? { capturedAt: '2026-11-18T04:15:00.000Z' } : null,
    status: mockState.rawStatus,
    errorStatus: mockState.rawErrorStatus,
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

vi.mock('../cameras/ScopedRealtimePreviewCanvas', () => ({
  ScopedRealtimePreviewCanvas: () => <div data-testid="mock-ai-canvas" />,
}));

vi.mock('../cameras/RawCameraMediaCanvas', () => ({
  RawCameraMediaCanvas: () => <div data-testid="mock-raw-canvas" />,
}));

function makeDecodedPreview(): ScopedDecodedPreview {
  return {
    image: new Image(),
    frame: {
      cameraExternalId: 'rtsp-cam-01',
      sessionId: '33333333-3333-4333-8333-333333333333',
      sequenceNumber: '42',
      capturedAt: '2026-11-18T04:15:00.000Z',
      width: 1280,
      height: 720,
      imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      zonePolygons: [],
      detections: [
        {
          trackId: 7,
          boundingBox: { x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.6 },
          confidence: 0.91,
          ppeStatus: { HARD_HAT: 'MISSING', SAFETY_VEST: 'PRESENT' },
          confirmedMissingItems: ['HARD_HAT'],
          alertState: 'ALERT',
          active: true,
          label: 'Missing Hard Hat',
          timecode: '00:05',
          eventId: '00000000-0000-4000-8000-000000000007',
          cameraExternalId: 'rtsp-cam-01',
        },
      ],
      zoneDetections: [],
    },
  } as unknown as ScopedDecodedPreview;
}

const officerSession: Pick<LoginResponse, 'accessToken' | 'user'> = {
  accessToken: 'tok-officer',
  user: {
    id: '00000000-0000-4000-8000-000000000088',
    username: 'safety.officer',
    displayName: 'Safety Officer',
    isActive: true,
    mustChangePassword: false,
    roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: SITE_ID }],
  },
};

describe('Monitor optional Evidence Drawer, Focus Escape/double-click, and raw-vs-AI truthfulness', () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    await i18n.changeLanguage('en');
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mockState.byCamera.clear();
    mockState.byCamera.set(CAM_01.id, {
      preview: makeDecodedPreview(),
      status: 'LIVE',
      sourceKind: 'LIVE',
      errorStatus: null,
      isLoading: false,
    });
    mockState.byCamera.set(CAM_02.id, {
      preview: null,
      status: 'UNAVAILABLE',
      sourceKind: null,
      errorStatus: 503,
      isLoading: false,
    });
    mockState.rawImage = null;
    mockState.rawStatus = 'CONNECTING';
    mockState.rawErrorStatus = null;
    mockState.sites.mockReset().mockResolvedValue({
      items: [{ id: SITE_ID, code: 'SITE-01', name: 'Alpha Yard' }],
      total: 1,
    });
    mockState.cameras.mockReset().mockResolvedValue({
      items: [CAM_01, CAM_02],
      total: 2,
    });
    vi.mocked(mockClient.getCameraObservationZones).mockResolvedValue({
      siteId: SITE_ID,
      cameraId: CAM_01.id,
      configurationVersion: 4,
      items: [],
      total: 0,
      unresolvedRegionCount: 0,
    });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.restoreAllMocks();
  });

  it('opens optional Evidence Drawer on demand without duplicating canvas, redacts RTSP credentials in details, purges 403 snapshots, and restores focus on Escape', async () => {
    const { rerender, container } = render(
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

    const evidenceBtn1 = await screen.findByTestId(`tile-evidence-btn-${CAM_01.id}`);
    expect(screen.queryByTestId('monitor-evidence-drawer')).toBeNull();
    expect(screen.getAllByTestId('mock-ai-canvas')).toHaveLength(1);

    evidenceBtn1.focus();
    fireEvent.click(evidenceBtn1);

    const drawer = await screen.findByTestId('monitor-evidence-drawer');
    expect(drawer.getAttribute('role')).toBe('dialog');
    // Viewport canvas is NOT duplicated inside the evidence drawer
    expect(screen.getAllByTestId('mock-ai-canvas')).toHaveLength(1);
    expect(drawer.textContent).toContain('CAM-01');
    expect(drawer.textContent).toContain('North Gate Camera');
    expect(drawer.textContent).toMatch(/Identity: Unknown/i);

    // Scoped Frame Inbox & Safety Records links carry both siteId and cameraId
    const inboxLink = within(drawer).getByTestId('monitor-drawer-frame-inbox-link');
    expect(inboxLink.getAttribute('href')).toBe(
      `/incidents?tab=ppe-frames&siteId=${encodeURIComponent(SITE_ID)}&cameraId=${encodeURIComponent(CAM_01.id)}`,
    );
    const episodesLink = within(drawer).getByTestId('monitor-drawer-episodes-link');
    expect(episodesLink.getAttribute('href')).toBe(
      `/incidents?tab=episodes&siteId=${encodeURIComponent(SITE_ID)}&cameraId=${encodeURIComponent(CAM_01.id)}`,
    );

    // Collapsible technical details contain camera UUID & config version, NEVER RTSP credentials
    const techDetails = within(drawer).getByTestId(
      'monitor-drawer-technical-details',
    ) as HTMLDetailsElement;
    expect(techDetails.open).toBe(false);
    fireEvent.click(techDetails.querySelector('summary')!);
    expect(techDetails.open).toBe(true);
    expect(techDetails.textContent).toContain(CAM_01.id);
    expect(container.innerHTML).not.toContain('topsecret');
    expect(container.innerHTML).not.toContain('rtsp://');

    // Escape closes the drawer and restores focus to the tile's Evidence button
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('monitor-evidence-drawer')).toBeNull());
    expect(document.activeElement).toBe(evidenceBtn1);

    // When camera becomes restricted (403), opening drawer purges/hides previous detections
    mockState.byCamera.set(CAM_01.id, {
      preview: null,
      status: 'UNAVAILABLE',
      sourceKind: null,
      errorStatus: 403,
      isLoading: false,
    });
    rerender(
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
    fireEvent.click(screen.getByTestId(`tile-evidence-btn-${CAM_01.id}`));
    const restrictedDrawer = await screen.findByTestId('monitor-evidence-drawer');
    expect(restrictedDrawer.textContent).toContain('Camera access restricted');
    expect(restrictedDrawer.textContent).not.toContain('Missing Hard Hat');
  });

  it('enlarges on double-click of tile viewport and exits Focus (1) back to Grid (4) on Escape', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/ppe']}>
          <PpeMonitorWorkspace apiUrl="http://127.0.0.1:3000" session={officerSession} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const viewport2 = await screen.findByTestId(`wall-video-viewport-${CAM_02.id}`);
    fireEvent.doubleClick(viewport2);

    expect(await screen.findByTestId('focused-exit-to-grid')).toBeTruthy();
    expect(screen.getByTestId('focused-camera-metadata').textContent).toContain(
      'East Crane Camera',
    );
    expect(screen.getByTestId('focused-evidence-btn')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('focused-exit-to-grid')).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId(`enlarge-camera-btn-${CAM_02.id}`)),
    );
  });

  it('never labels raw live/recorded camera transport as AI frame connecting or AI detections, even while connecting or offline', () => {
    const { container } = render(
      <FocusedCameraMedia
        apiUrl="http://127.0.0.1:3000"
        client={mockClient}
        token="tok"
        sessionScope="scope-1"
        siteId={SITE_ID}
        siteCode="SITE-01"
        siteName="Alpha Yard"
        camera={CAM_01}
        aiPaused={false}
      />,
    );

    // Switch to Live source video while raw media is still CONNECTING
    fireEvent.click(screen.getByRole('button', { name: 'Live source video' }));
    expect(screen.getByTestId('focused-people-state').textContent).toBe(
      'Person count unavailable on raw source video',
    );
    expect(screen.getByTestId('focused-people-state').textContent).not.toMatch(/AI frame/i);
    expect(screen.getByTestId('focused-raw-source-notice').textContent).toContain('no AI overlays');
    expect(container.innerHTML).not.toContain('topsecret');
    expect(container.innerHTML).not.toContain('rtsp://');
  });
});
