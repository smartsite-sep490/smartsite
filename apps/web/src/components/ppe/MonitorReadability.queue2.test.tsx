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
import { FourSourceWallTile } from './FourSourceWall';
import { PpeMonitorWorkspace } from './PpeMonitorWorkspace';

const mockState = vi.hoisted(() => ({
  preview: null as ScopedDecodedPreview | null,
  status: 'UNAVAILABLE' as ScopedPreviewStatus,
  sourceKind: null as 'LIVE' | 'REPLAY' | null,
  errorStatus: null as number | null,
  isLoading: false,
  rawImage: null as HTMLImageElement | null,
  rawStatus: 'LIVE' as 'LIVE' | 'CONNECTING' | 'HALTED',
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
  useScopedCameraPreview: () => ({
    preview: mockState.preview,
    status: mockState.status,
    sourceKind: mockState.sourceKind,
    capturedAt: mockState.preview ? '2026-11-16T03:00:00.000Z' : null,
    error: mockState.preview ? null : 'Offline',
    errorStatus: mockState.errorStatus,
    isLoading: mockState.isLoading,
    isPolling: false,
    cameraExternalId: 'rtsp-cam-01',
    siteId: SITE_ID,
    cameraId: CAM_01.id,
    retry: vi.fn(),
  }),
}));

vi.mock('../cameras/useScopedCameraMedia', () => ({
  useScopedCameraMedia: () => ({
    image: mockState.rawImage,
    frame: mockState.rawImage ? { capturedAt: '2026-11-16T03:00:00.000Z' } : null,
    status: mockState.rawStatus,
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

vi.mock('../cameras/ScopedRealtimePreviewCanvas', () => ({
  ScopedRealtimePreviewCanvas: () => <div data-testid="mock-ai-canvas" />,
}));

vi.mock('../cameras/RawCameraMediaCanvas', () => ({
  RawCameraMediaCanvas: () => <div data-testid="mock-raw-canvas" />,
}));

const SITE_ID = '11111111-1111-4111-8111-111111111111';
const CAM_01: CameraResponse = {
  type: 'ZONE' as const,
  gateId: null,
  id: '22222222-2222-4222-8222-222222222222',
  siteId: SITE_ID,
  code: 'CAM-01',
  name: 'North Gate Camera',
  externalId: 'rtsp-cam-01',
  status: 'ACTIVE',
  configurationVersion: 2,
  createdAt: '2026-11-01T00:00:00.000Z',
};

function makeDecodedPreview(detectionCount: number): ScopedDecodedPreview {
  return {
    image: new Image(),
    frame: {
      cameraExternalId: 'rtsp-cam-01',
      sessionId: '33333333-3333-4333-8333-333333333333',
      sequenceNumber: '1',
      capturedAt: '2026-11-16T03:00:00.000Z',
      width: 640,
      height: 360,
      imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      zonePolygons: [],
      detections: Array.from({ length: detectionCount }, (_, idx) => ({
        trackId: idx + 1,
        boundingBox: { x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.6 },
        confidence: 0.9,
        ppeStatus: { HARD_HAT: 'PRESENT' },
        confirmedMissingItems: [],
        alertState: 'CLEAR',
        active: true,
        label: 'Clear',
        timecode: '00:01',
        eventId: `00000000-0000-4000-8000-00000000000${idx + 1}`,
        cameraExternalId: 'rtsp-cam-01',
      })),
      zoneDetections: [],
    },
  } as unknown as ScopedDecodedPreview;
}

function makeSession(
  role: 'ADMIN' | 'SAFETY_OFFICER',
  siteId: string | null = role === 'ADMIN' ? null : SITE_ID,
): Pick<LoginResponse, 'accessToken' | 'user'> {
  return {
    accessToken: `tok-${role}`,
    user: {
      id: `user-${role}`,
      username: role.toLowerCase(),
      displayName: role,
      isActive: true,
      mustChangePassword: false,
      roleAssignments: [{ role, siteId }],
    },
  };
}

describe('Camera Monitor Queue 2 readability, state distinction, and layout controls', () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
    await i18n.changeLanguage('en');
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mockState.preview = null;
    mockState.status = 'UNAVAILABLE';
    mockState.sourceKind = null;
    mockState.errorStatus = null;
    mockState.isLoading = false;
    mockState.rawImage = null;
    mockState.rawStatus = 'LIVE';
    mockState.sites.mockReset().mockResolvedValue({
      items: [{ id: SITE_ID, code: 'SITE-01', name: 'Alpha Yard' }],
      total: 1,
    });
    mockState.cameras.mockReset().mockResolvedValue({ items: [CAM_01], total: 1 });
    vi.mocked(mockClient.getCameraObservationZones).mockResolvedValue({
      siteId: SITE_ID,
      cameraId: CAM_01.id,
      configurationVersion: 2,
      items: [{ id: '44444444-4444-4444-8444-444444444444', code: 'Z-NORTH', name: 'North Bay' }],
      total: 1,
      unresolvedRegionCount: 0,
    });
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.restoreAllMocks();
  });

  it('keeps metadata outside video on wall tiles and distinguishes camera unavailable, AI unavailable, and 0 people', async () => {
    mockState.errorStatus = 503;
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <FourSourceWallTile
          apiUrl="http://127.0.0.1:3000"
          client={mockClient}
          token="tok"
          sessionScope="scope-1"
          credentialId={1}
          siteId={SITE_ID}
          siteCode="SITE-01"
          siteName="Alpha Yard"
          camera={CAM_01}
          isSelected={true}
          onSelect={vi.fn()}
          enabled={true}
          showModelObjects={false}
        />
      </QueryClientProvider>,
    );

    expect((await screen.findByTestId(`wall-zone-chip-${CAM_01.id}`)).textContent).toBe('Z-NORTH');
    expect(screen.getByTestId(`wall-failure-kind-${CAM_01.id}`).textContent).toBe(
      'Camera source unavailable',
    );
    expect(screen.getByTestId(`wall-people-state-${CAM_01.id}`).textContent).toBe(
      'Person count unavailable (no active AI frame)',
    );

    // Gateway 502 / 504 upstream source failures also classify as Camera source unavailable (F9)
    mockState.errorStatus = 502;
    rerender(
      <QueryClientProvider client={queryClient}>
        <FourSourceWallTile
          apiUrl="http://127.0.0.1:3000"
          client={mockClient}
          token="tok"
          sessionScope="scope-1"
          credentialId={1}
          siteId={SITE_ID}
          camera={CAM_01}
          isSelected={true}
          onSelect={vi.fn()}
          enabled={true}
          showModelObjects={false}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId(`wall-failure-kind-${CAM_01.id}`).textContent).toBe(
      'Camera source unavailable',
    );

    // AI / snapshot expired (no HTTP 503): shows AI snapshot unavailable, still never 0 people
    mockState.errorStatus = null;
    rerender(
      <QueryClientProvider client={queryClient}>
        <FourSourceWallTile
          apiUrl="http://127.0.0.1:3000"
          client={mockClient}
          token="tok"
          sessionScope="scope-1"
          credentialId={1}
          siteId={SITE_ID}
          camera={CAM_01}
          isSelected={true}
          onSelect={vi.fn()}
          enabled={true}
          showModelObjects={false}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId(`wall-failure-kind-${CAM_01.id}`).textContent).toBe(
      'AI snapshot unavailable',
    );
    expect(screen.getByTestId(`wall-people-state-${CAM_01.id}`).textContent).toContain(
      'Person count unavailable',
    );

    // Active frame with 0 detections: renders disclaimer in metadata bar OUTSIDE video viewport
    mockState.preview = makeDecodedPreview(0);
    mockState.status = 'LIVE';
    mockState.sourceKind = 'LIVE';
    rerender(
      <QueryClientProvider client={queryClient}>
        <FourSourceWallTile
          apiUrl="http://127.0.0.1:3000"
          client={mockClient}
          token="tok"
          sessionScope="scope-1"
          credentialId={1}
          siteId={SITE_ID}
          camera={CAM_01}
          isSelected={true}
          onSelect={vi.fn()}
          enabled={true}
          showModelObjects={false}
        />
      </QueryClientProvider>,
    );

    const viewport = screen.getByTestId(`wall-video-viewport-${CAM_01.id}`);
    const metadataBar = screen.getByTestId(`wall-metadata-bar-${CAM_01.id}`);
    expect(viewport.textContent).not.toMatch(/No Person detections/i);
    expect(within(metadataBar).getByTestId(`wall-people-state-${CAM_01.id}`).textContent).toMatch(
      /No Person detections/i,
    );
  });

  it('renders compact outside-video telemetry and raw-vs-AI distinction in FocusedCameraMedia (EN & VI)', async () => {
    const onExitFocus = vi.fn();
    mockState.preview = makeDecodedPreview(2);
    mockState.status = 'LIVE';
    mockState.sourceKind = 'LIVE';
    mockState.rawImage = new Image();

    render(
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
        onExitFocus={onExitFocus}
      />,
    );

    expect(screen.getByTestId('focused-source-state').textContent).toBe('LIVE');
    expect(screen.getByTestId('focused-people-state').textContent).toBe('2 Person detection(s)');
    expect(screen.getByTestId('focused-technical-details').textContent).toContain('rtsp-cam-01');

    fireEvent.click(screen.getByRole('button', { name: 'Live source video' }));
    expect(screen.getByTestId('focused-source-state').textContent).toBe(
      'Raw source only (AI overlay off)',
    );
    expect(screen.getByTestId('focused-people-state').textContent).toBe(
      'Person count unavailable on raw source video',
    );

    await i18n.changeLanguage('vi');
    await waitFor(() => {
      expect(screen.getByTestId('focused-people-state').textContent).toContain(
        'Số người không khả dụng',
      );
    });

    fireEvent.click(screen.getByTestId('focused-exit-to-grid'));
    expect(onExitFocus).toHaveBeenCalledTimes(1);
  });

  it('supports Grid(4)/Focus(1) controls, fullscreen fallback to Focus, linked-camera recovery, and role-aware empty states', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[`/ppe?siteId=${SITE_ID}&cameraId=missing-cam`]}>
          <PpeMonitorWorkspace
            apiUrl="http://127.0.0.1:3000"
            session={makeSession('SAFETY_OFFICER')}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // Linked camera unavailable offers recovery to available site cameras
    const linkedEmpty = await screen.findByTestId('monitor-linked-camera-empty');
    expect(linkedEmpty.textContent).toContain('The linked camera is unavailable.');
    fireEvent.click(screen.getByTestId('monitor-clear-linked-camera'));

    // Grid(4) active by default; fullscreen error offers Switch to Focus (1) fallback
    expect(await screen.findByTestId('monitor-grid-btn')).toBeTruthy();
    expect(screen.getByTestId('monitor-grid-btn').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('monitor-focus-btn').getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(screen.getByTestId('monitor-fullscreen-btn'));
    const focusFallback = await screen.findByTestId('monitor-fullscreen-focus-fallback');
    fireEvent.click(focusFallback);
    expect(screen.getByTestId('monitor-focus-btn').getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.body);
      expect(document.activeElement).toBe(screen.getByTestId('focused-exit-to-grid'));
    });

    // F5: Back to 4-camera grid and tile Enlarge preserve keyboard focus instead of dropping to body
    fireEvent.click(screen.getByTestId('focused-exit-to-grid'));
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId(`enlarge-camera-btn-${CAM_01.id}`));
    });
    fireEvent.click(screen.getByTestId(`enlarge-camera-btn-${CAM_01.id}`));
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId('focused-exit-to-grid'));
    });

    // F1: Real browser fullscreen keeps Exit fullscreen + 4/1 controls and activeElement inside fullscreenElement
    let activeFsEl: Element | null = null;
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      get: () => activeFsEl,
    });
    const origReqFs = HTMLElement.prototype.requestFullscreen;
    const origExitFs = document.exitFullscreen;
    HTMLElement.prototype.requestFullscreen = vi.fn(() => {
      activeFsEl = document.querySelector('[tabindex="-1"]');
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    });
    document.exitFullscreen = vi.fn(() => {
      activeFsEl = null;
      document.dispatchEvent(new Event('fullscreenchange'));
      return Promise.resolve();
    });

    try {
      const fsTrigger = screen.getByTestId('monitor-fullscreen-btn');
      fireEvent.click(fsTrigger);
      const inFsExit = await screen.findByTestId('monitor-fullscreen-exit-btn');
      expect(document.fullscreenElement?.contains(inFsExit)).toBe(true);
      expect(
        document.fullscreenElement?.contains(
          screen.getByTestId('monitor-fullscreen-layout-controls'),
        ),
      ).toBe(true);
      await waitFor(() => {
        expect(document.activeElement).toBe(inFsExit);
      });

      fireEvent.click(inFsExit);
      await waitFor(() => {
        expect(document.activeElement).toBe(fsTrigger);
      });
    } finally {
      HTMLElement.prototype.requestFullscreen = origReqFs;
      document.exitFullscreen = origExitFs;
      Reflect.deleteProperty(document, 'fullscreenElement');
    }

    // Empty active cameras: ADMIN sees Inspect Camera Setup link; SAFETY_OFFICER does not
    cleanup();
    mockState.cameras.mockResolvedValue({
      items: [{ ...CAM_01, status: 'INACTIVE' }],
      total: 1,
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/ppe']}>
          <PpeMonitorWorkspace apiUrl="http://127.0.0.1:3000" session={makeSession('ADMIN')} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const adminEmpty = await screen.findByTestId('monitor-no-active-cameras');
    expect(adminEmpty.textContent).toContain('1 camera(s) in loaded pages are saved as Disabled');
    expect(screen.getByTestId('monitor-inspect-camera-setup').getAttribute('href')).toBe(
      `/camera-setup?siteId=${SITE_ID}`,
    );
  });
});
