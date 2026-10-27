// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import type { Page, SiteResponse } from '@smartsite/api-client';
import type { CameraResponse } from '@smartsite/contracts';
import type { ScopedPreviewStatus } from '../cameras/useScopedCameraPreview';
import { PpeMonitoringView } from './PpeMonitoringView';
import type { DecodedPreview } from '../cameras/useRealtimePreview';
import type { VideoTestDetection } from '../cameras/videoTestFixture';
import type { SharedSession } from '../../types/shared-session';
import i18n from '../../i18n';

if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

interface MockTilePreviewConfig {
  preview: DecodedPreview | null;
  status: ScopedPreviewStatus;
  sourceKind: 'LIVE' | 'REPLAY' | null;
  error?: string | null;
  errorStatus?: number | null;
}

const previewStore = vi.hoisted(() => ({
  byCameraId: {} as Record<string, MockTilePreviewConfig>,
  calls: [] as Array<{ cameraId?: string | null; enabled?: boolean }>,
  retry: vi.fn(),
}));

const unavailableHook = { error: null, errorStatus: null, retry: vi.fn() };

vi.mock('../cameras/useScopedRecordedVideo', () => ({
  useScopedRecordedVideo: () => ({
    ...unavailableHook,
    videoUrl: null,
    status: 'UNAVAILABLE',
    isLoading: false,
  }),
}));

vi.mock('../cameras/useScopedCameraMedia', () => ({
  useScopedCameraMedia: () => ({
    ...unavailableHook,
    image: null,
    frame: null,
    status: 'UNAVAILABLE',
    isStreaming: false,
  }),
}));

vi.mock('../cameras/useScopedCameraPreview', () => ({
  useScopedCameraPreview: (options?: {
    cameraId?: string | null;
    siteId?: string | null;
    enabled?: boolean;
  }) => {
    previewStore.calls.push({ cameraId: options?.cameraId, enabled: options?.enabled });
    const camId = options?.cameraId ?? '';
    const entry = options?.enabled === false ? undefined : previewStore.byCameraId[camId];
    return {
      preview: entry?.preview ?? null,
      status: (entry?.status ?? 'UNAVAILABLE') as ScopedPreviewStatus,
      sourceKind: entry?.sourceKind ?? null,
      error: entry?.error ?? null,
      errorStatus: entry?.errorStatus ?? null,
      isError: Boolean(entry?.error || entry?.errorStatus),
      isLoading: entry?.status === 'CONNECTING',
      isPolling: Boolean(entry?.preview),
      retry: previewStore.retry,
      cameraExternalId: entry?.preview?.frame.cameraExternalId ?? null,
      capturedAt: entry?.preview?.frame.capturedAt ?? null,
      siteId: entry ? (options?.siteId ?? null) : null,
      cameraId: entry ? camId || null : null,
    };
  },
}));

const baseSite: SiteResponse = {
  id: 'site-alpha',
  code: 'SITE-A',
  name: 'Alpha Construction Site',
  createdAt: '2026-09-30T00:00:00Z',
};

const mockSitesList: Page<SiteResponse> = {
  items: [baseSite],
  total: 1,
};

const baseCamera: CameraResponse = {
  id: 'cam-1',
  siteId: 'site-alpha',
  externalId: 'CAM-01',
  code: 'CAM-01',
  name: 'Camera 01',
  status: 'ACTIVE',
  configurationVersion: 1,
  createdAt: '2026-09-30T00:00:00Z',
};

const secondCamera: CameraResponse = {
  ...baseCamera,
  id: 'cam-2',
  externalId: 'CAM-02',
  code: 'CAM-02',
  name: 'Camera 02',
};

const mockCamerasList: Page<CameraResponse> = {
  items: [baseCamera, secondCamera],
  total: 2,
};

const officerSessionAlpha: SharedSession = {
  accessToken: 'token-wall-alpha',
  sessionScope: 'scope-wall-alpha',
  user: {
    id: 'officer-wall-1',
    displayName: 'Safety Officer Alpha',
    roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: 'site-alpha' }],
  },
};

function makeDetection(overrides: Partial<VideoTestDetection> = {}): VideoTestDetection {
  return {
    active: true,
    alertState: 'CONFIRMED',
    confirmedMissingItems: ['HARD_HAT'],
    boundingBox: { x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.9 },
    confidence: 0.88,
    eventId: '00000000-0000-4000-8000-000000000001',
    label: 'Missing Hard Hat',
    ppeStatus: { HARD_HAT: 'MISSING', SAFETY_VEST: 'PRESENT' },
    timecode: '01:23',
    trackId: 7,
    cameraExternalId: 'CAM-01',
    ...overrides,
  };
}

function makePreview(cameraExternalId: string, detections: VideoTestDetection[]): DecodedPreview {
  return {
    image: {} as HTMLImageElement,
    frame: {
      sessionId: '00000000-0000-4000-8000-000000000099',
      sequenceNumber: '1',
      cameraExternalId,
      capturedAt: '2026-10-19T08:30:00.000Z',
      width: 640,
      height: 480,
      imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      zonePolygons: [],
      detections,
      zoneDetections: [],
    },
  };
}

describe('PpeMonitoringView 4-Source Wall Active Snapshot Binding (Audit Issue 1)', () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    vi.stubEnv('VITE_AI_WORK_PAUSED', 'false');
    await i18n.changeLanguage('en');
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    previewStore.byCameraId = {};
    previewStore.calls = [];
    previewStore.retry.mockClear();

    const noop = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      new Proxy(
        {},
        { get: (_t, prop) => (prop === 'measureText' ? () => ({ width: 42 }) : noop) },
      ) as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue(mockSitesList);
    vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockResolvedValue(
      mockCamerasList,
    );
    vi.spyOn(SmartSiteManagementClient.prototype, 'getCameraObservationZones').mockImplementation(
      async (_token, siteId, cameraId) => ({
        siteId,
        cameraId,
        configurationVersion: 1,
        items: [],
        total: 0,
        unresolvedRegionCount: 0,
      }),
    );
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('binds valid LIVE wall tile snapshot to header status pill, right AI Detection card, and preserves UNKNOWN vs confirmed episode warning', async () => {
    const user = userEvent.setup();
    previewStore.byCameraId['cam-1'] = {
      preview: makePreview('CAM-01', [
        makeDetection({
          ppeStatus: { HARD_HAT: 'UNKNOWN', SAFETY_VEST: 'PRESENT' },
          confirmedMissingItems: ['HARD_HAT'],
        }),
      ]),
      status: 'LIVE',
      sourceKind: 'LIVE',
    };
    previewStore.byCameraId['cam-2'] = {
      preview: makePreview('CAM-02', []),
      status: 'LIVE',
      sourceKind: 'LIVE',
    };

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={officerSessionAlpha} />
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: /Camera 01/i });
    await user.click(screen.getByTestId('toggle-view-wall'));
    await screen.findByTestId('four-source-wall-grid');

    expect(screen.getByText('Live Monitored')).not.toBeNull();
    expect(screen.queryByText('Feed Standby')).toBeNull();
    expect(screen.getByText('Live AI Observations Active')).not.toBeNull();

    await user.click(screen.getByTestId('open-evidence-details-btn'));
    const rightCard = within(screen.getByTestId('ai-detection-panel'));
    expect(rightCard.getByTestId('ai-evidence-badge').textContent).toBe(
      '00000000-0000-4000-8000-000000000001',
    );
    expect(rightCard.queryByTestId('ai-snapshot-unavailable-msg')).toBeNull();
    expect(rightCard.getByText('Unknown — not identified')).not.toBeNull();
    expect(rightCard.getAllByText('Track #7').length).toBeGreaterThan(0);
    expect(rightCard.getByText('88%')).not.toBeNull();
    expect(rightCard.getByText('Helmet · Unknown')).not.toBeNull();
    expect(rightCard.queryByText('Helmet · Missing · confirmed')).toBeNull();

    const episodeWarning = rightCard.getByTestId('confirmed-episode-warning-7-HARD_HAT');
    expect(episodeWarning.textContent).toContain('Active confirmed episode: Missing · confirmed');
    expect(episodeWarning.textContent).toContain('Current snapshot: Unknown');
    expect(rightCard.getByText('MISSING PPE DETECTED')).not.toBeNull();
    expect(rightCard.getByText('Missing PPE observed in snapshot.')).not.toBeNull();
    expect(
      (rightCard.getByRole('button', { name: 'Review Alert' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('binds valid REPLAY wall tile snapshot and sourceKind to header pill, right card RESULT, and bottom Replay observations banner when focusing tile', async () => {
    const user = userEvent.setup();
    previewStore.byCameraId['cam-1'] = {
      preview: makePreview('CAM-01', []),
      status: 'LIVE',
      sourceKind: 'LIVE',
    };
    previewStore.byCameraId['cam-2'] = {
      preview: makePreview('CAM-02', [
        makeDetection({
          trackId: 12,
          active: false,
          alertState: 'PENDING_CONFIRMATION',
          confirmedMissingItems: [],
          confidence: 0.91,
          eventId: '00000000-0000-4000-8000-000000000002',
          ppeStatus: { HARD_HAT: 'UNKNOWN', SAFETY_VEST: 'PRESENT' },
          cameraExternalId: 'CAM-02',
        }),
      ]),
      status: 'REPLAY',
      sourceKind: 'REPLAY',
    };

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={officerSessionAlpha} />
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: /Camera 02/i });
    await user.click(screen.getByTestId('toggle-view-wall'));
    await screen.findByTestId('four-source-wall-grid');
    await user.click(screen.getByTestId('focus-btn-cam-2'));

    await waitFor(() => {
      expect(screen.getByText('Replay Mode')).not.toBeNull();
    });
    expect(screen.queryByText('Feed Standby')).toBeNull();
    expect(screen.getByText('Replay AI Observations Active')).not.toBeNull();
    expect(screen.queryByText('Live AI Observations Active')).toBeNull();
    expect(
      screen.getByText(/Technical PPE detections are rendered from recorded video replay stream/i),
    ).not.toBeNull();

    await user.click(screen.getByTestId('open-evidence-details-btn'));
    const rightCard = within(screen.getByTestId('ai-detection-panel'));
    expect(rightCard.getByTestId('ai-evidence-badge').textContent).toBe(
      '00000000-0000-4000-8000-000000000002',
    );
    expect(rightCard.getAllByText('Track #12').length).toBeGreaterThan(0);
    expect(rightCard.getByText('91%')).not.toBeNull();
    expect(rightCard.getByText('SCANNING SNAPSHOT')).not.toBeNull();
    expect(
      rightCard.getByText('Rendering recorded video replay stream from Camera Preview API.'),
    ).not.toBeNull();
  });

  it('fails closed on unavailable wall tile or invalidated session/site scope without leaking prior wall snapshot', async () => {
    const user = userEvent.setup();
    previewStore.byCameraId['cam-1'] = {
      preview: makePreview('CAM-01', [makeDetection({ trackId: 7 })]),
      status: 'LIVE',
      sourceKind: 'LIVE',
    };
    previewStore.byCameraId['cam-2'] = {
      preview: null,
      status: 'UNAVAILABLE',
      sourceKind: null,
    };

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={officerSessionAlpha} />
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: /Camera 01/i });
    await user.click(screen.getByTestId('toggle-view-wall'));
    await screen.findByTestId('four-source-wall-grid');

    expect(screen.getByText('Live Monitored')).not.toBeNull();
    await user.click(screen.getByTestId('open-evidence-details-btn'));
    expect(
      within(screen.getByTestId('ai-detection-panel')).getAllByText('Track #7').length,
    ).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(screen.queryByTestId('ai-detection-panel')).toBeNull();

    await user.click(screen.getByTestId('focus-btn-cam-2'));
    await waitFor(() => {
      expect(screen.getByText('Feed Standby')).not.toBeNull();
    });

    await user.click(screen.getByTestId('open-evidence-details-btn'));
    const unavailableCard = within(screen.getByTestId('ai-detection-panel'));
    expect(unavailableCard.getByTestId('ai-evidence-badge').textContent).toBe(
      'AI EVIDENCE UNAVAILABLE',
    );
    expect(unavailableCard.getByText('AI snapshot unavailable')).not.toBeNull();
    expect(unavailableCard.getByTestId('ai-snapshot-unavailable-msg')).not.toBeNull();
    expect(unavailableCard.queryByText('Track #7')).toBeNull();
    expect(
      (unavailableCard.getByRole('button', { name: 'Review Alert' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Close dialog' }));
    await user.click(screen.getByTestId('focus-btn-cam-1'));
    await waitFor(() => {
      expect(screen.getByText('Live Monitored')).not.toBeNull();
    });
    await user.click(screen.getByTestId('open-evidence-details-btn'));
    expect(
      within(screen.getByTestId('ai-detection-panel')).getAllByText('Track #7').length,
    ).toBeGreaterThan(0);

    vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockImplementation(
      () => new Promise(() => {}),
    );
    rerender(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView
          sharedSession={{
            ...officerSessionAlpha,
            accessToken: 'token-wall-rotated',
            sessionScope: 'scope-wall-rotated',
          }}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText('Feed Standby')).not.toBeNull();
    expect(screen.queryByTestId('ai-detection-panel')).toBeNull();
    expect(screen.queryByText('Track #7')).toBeNull();

    await user.click(screen.getByTestId('open-evidence-details-btn'));
    const rotatedCard = within(screen.getByTestId('ai-detection-panel'));
    expect(rotatedCard.getByTestId('ai-evidence-badge').textContent).toBe(
      'AI EVIDENCE UNAVAILABLE',
    );
    expect(rotatedCard.queryByText('Track #7')).toBeNull();
    expect(
      (rotatedCard.getByRole('button', { name: 'Review Alert' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('fails closed in 4-Source Wall mode when VITE_AI_WORK_PAUSED=true', async () => {
    const user = userEvent.setup();
    vi.stubEnv('VITE_AI_WORK_PAUSED', 'true');
    previewStore.byCameraId['cam-1'] = {
      preview: makePreview('CAM-01', [makeDetection({ trackId: 7 })]),
      status: 'LIVE',
      sourceKind: 'LIVE',
    };

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={officerSessionAlpha} />
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: /Camera 01/i });
    await user.click(screen.getByTestId('toggle-view-wall'));
    await screen.findByTestId('four-source-wall-grid');

    expect(screen.getByTestId('ai-work-paused-banner')).not.toBeNull();
    expect(screen.getByText('AI Work Paused')).not.toBeNull();
    expect(screen.queryByText('Live Monitored')).toBeNull();
    expect(screen.queryByText('Replay Mode')).toBeNull();
    expect(screen.getByTestId('wall-paused-cam-1')).not.toBeNull();
    expect(screen.queryByText('Track #7')).toBeNull();

    await user.click(screen.getByTestId('open-evidence-details-btn'));
    const pausedCard = within(screen.getByTestId('ai-detection-panel'));
    expect(pausedCard.getByTestId('ai-evidence-badge').textContent).toBe('AI WORK PAUSED');
    expect(pausedCard.getByTestId('ai-paused-empty-state')).not.toBeNull();
    expect(pausedCard.queryByText('Track #7')).toBeNull();
    expect(previewStore.calls.every((call) => call.enabled === false)).toBe(true);
  });

  it('preserves 16:9 video-first wall viewport without max-h-[260px] cap, bounds long camera/site disclosure, and keeps focus/enlarge/evidence actions accessible', async () => {
    const user = userEvent.setup();
    const longCameraName =
      'Camera 01 — North Tower Crane Perimeter High-Elevation Scaffold Assembly Sector Gate';
    const longSiteName =
      'Alpha Mega Industrial Construction Complex Phase II Structural Steel Sector';

    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
      items: [{ ...baseSite, name: longSiteName }],
      total: 1,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockResolvedValue({
      items: [{ ...baseCamera, name: longCameraName }, secondCamera],
      total: 2,
    });
    previewStore.byCameraId['cam-1'] = {
      preview: makePreview('CAM-01', []),
      status: 'LIVE',
      sourceKind: 'LIVE',
    };
    previewStore.byCameraId['cam-2'] = {
      preview: null,
      status: 'UNAVAILABLE',
      sourceKind: null,
    };

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={officerSessionAlpha} />
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: new RegExp(longCameraName, 'i') });
    await user.click(screen.getByTestId('toggle-view-wall'));

    const grid = await screen.findByTestId('four-source-wall-grid');
    expect(grid.className).toContain('items-start');

    const tile1 = screen.getByTestId('wall-tile-cam-1');
    expect(tile1.className).toContain('min-w-0');
    expect(tile1.className).not.toContain('justify-between');

    const videoViewport = screen.getByTestId('wall-video-viewport-cam-1');
    expect(videoViewport.className).toContain('aspect-video');
    expect(videoViewport.className).toContain('w-full');
    expect(videoViewport.className).not.toContain('max-h-[260px]');

    const unassignedSlot = screen.getByTestId('wall-unassigned-slot-3');
    expect(unassignedSlot.className).toContain('aspect-video');
    expect(unassignedSlot.className).not.toContain('max-h-[260px]');

    const details = screen.getByTestId('wall-tile-details-cam-1');
    const summary = within(details).getByText('Details');
    await user.click(summary);
    expect(details.hasAttribute('open')).toBe(true);
    expect(within(details).getByText(longSiteName)).not.toBeNull();

    expect(screen.getByTestId('focus-btn-cam-1').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('enlarge-camera-btn-cam-1')).not.toBeNull();
    expect(screen.getByTestId('tile-evidence-btn-cam-1')).not.toBeNull();
  });

  it('restores keyboard focus and returns from enlarged single view to 4-source wall on Escape after closing open evidence dialog, with fallback when camera 5+ is absent from bounded wall', async () => {
    const user = userEvent.setup();
    const cam3 = { ...baseCamera, id: 'cam-3', code: 'CAM-03', name: 'Camera 03' };
    const cam4 = { ...baseCamera, id: 'cam-4', code: 'CAM-04', name: 'Camera 04' };
    const cam5 = { ...baseCamera, id: 'cam-5', code: 'CAM-05', name: 'Camera 05' };
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
      items: [baseSite],
      total: 1,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockResolvedValue({
      items: [baseCamera, secondCamera, cam3, cam4, cam5],
      total: 5,
    });
    for (const [id, code] of [
      ['cam-1', 'CAM-01'],
      ['cam-2', 'CAM-02'],
      ['cam-3', 'CAM-03'],
      ['cam-4', 'CAM-04'],
      ['cam-5', 'CAM-05'],
    ] as const) {
      previewStore.byCameraId[id] = {
        preview: makePreview(code, []),
        status: 'LIVE',
        sourceKind: 'LIVE',
      };
    }

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={officerSessionAlpha} />
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: /Camera 01/i });
    await user.click(screen.getByTestId('toggle-view-wall'));
    await screen.findByTestId('four-source-wall-grid');

    await user.click(screen.getByTestId('enlarge-camera-btn-cam-2'));

    const backBtn = await screen.findByTestId('single-viewport-back-to-grid-btn');
    await waitFor(() => {
      expect(document.activeElement).toBe(backBtn);
    });

    // Open on-demand evidence dialog while in enlarged single view
    await user.click(screen.getByTestId('viewport-evidence-details-btn'));
    expect(screen.getByRole('dialog')).not.toBeNull();

    // First Escape closes only the evidence dialog and keeps enlarged single view active
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('single-camera-viewport')).not.toBeNull();

    // Second Escape returns to the 4-source wall, preserves cam-2 selection, and restores focus to cam-2 enlarge button
    await user.keyboard('{Escape}');
    await screen.findByTestId('four-source-wall-grid');
    expect(screen.getByTestId('focused-badge-cam-2')).not.toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId('enlarge-camera-btn-cam-2'));
    });

    // Enlarge again, switch to cam-5 (absent from bounded 4-tile wall), and return to wall -> focuses stable authorized fallback (cam-1 enlarge button)
    await user.click(screen.getByTestId('enlarge-camera-btn-cam-2'));
    await screen.findByTestId('single-camera-viewport');
    await user.click(screen.getByTestId('camera-chip-cam-5'));
    await user.keyboard('{Escape}');
    await screen.findByTestId('four-source-wall-grid');
    expect(screen.queryByTestId('enlarge-camera-btn-cam-5')).toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId('enlarge-camera-btn-cam-1'));
    });
  });

  it('opens optional monitor guided tour on demand in single view with Enlarge/Fullscreen anchor available, steps through authorized anchors, and closes on scope rotation', async () => {
    const user = userEvent.setup();
    window.localStorage.clear();
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
      items: [baseSite],
      total: 1,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockResolvedValue({
      items: [baseCamera, secondCamera],
      total: 2,
    });

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={officerSessionAlpha} />
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: /Camera 01/i });
    expect(screen.getByTestId('single-camera-viewport')).not.toBeNull();

    const trigger = screen.getByTestId('safety-task-tour-trigger');
    expect(screen.queryByTestId('safety-task-tour')).toBeNull();

    await user.click(trigger);
    const tour = screen.getByTestId('safety-task-tour');
    expect(tour.getAttribute('data-tour-step')).toBe('monitor-scope');
    // Safety Officer without SITE_MANAGER assignment has 4 monitor steps even in single view (Enlarge/Fullscreen anchor is toggle-fullscreen-btn)
    expect(screen.getByText('Step 1 of 4')).not.toBeNull();
    expect(screen.getByTestId('safety-task-tour-highlight')).not.toBeNull();

    await user.click(screen.getByTestId('safety-task-tour-next'));
    await user.click(screen.getByTestId('safety-task-tour-next'));
    expect(screen.getByTestId('safety-task-tour').getAttribute('data-tour-step')).toBe(
      'monitor-enlarge',
    );
    expect(
      screen.getByTestId('toggle-fullscreen-btn').getAttribute('data-tour-active-anchor'),
    ).toBe('true');

    // Scope rotation immediately closes the tour without leaking stale steps
    rerender(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView
          sharedSession={{
            ...officerSessionAlpha,
            sessionScope: 'scope-rotated-beta',
          }}
        />
      </QueryClientProvider>,
    );

    expect(screen.queryByTestId('safety-task-tour')).toBeNull();
  });

  it('keeps a metadata failure distinct from an empty or inaccessible camera scope', async () => {
    vi.mocked(SmartSiteManagementClient.prototype.listPreviewCameras).mockRejectedValue(
      new Error('private-upstream-detail'),
    );
    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={officerSessionAlpha} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    const viewport = screen.getByTestId('single-camera-viewport');
    expect(viewport.getAttribute('role')).toBe('status');
    expect(viewport.textContent).not.toContain('contact an administrator');
    expect(viewport.textContent).not.toContain('private-upstream-detail');
    expect(viewport.className).not.toContain('aspect-video');
  });

  it('renders a compact no-selected-camera state without the huge unavailable camera canvas or duplicate back-to-grid controls when camera scope is empty or denied', async () => {
    const siteManagerOnlySession: SharedSession = {
      accessToken: 'token-site-mgr-only',
      sessionScope: 'scope-site-mgr-only',
      user: {
        id: 'mgr-only-1',
        displayName: 'Site Manager Alpha',
        roleAssignments: [{ role: 'SITE_MANAGER', siteId: 'site-alpha' }],
      },
    };

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={siteManagerOnlySession} />
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: /Alpha Construction Site/i });

    const deniedViewport = screen.getByTestId('single-camera-viewport');
    expect(deniedViewport.className).not.toContain('aspect-video');
    expect(deniedViewport.className).not.toContain('min-h-[320px]');
    expect(deniedViewport.textContent).toContain('No camera selected');
    expect(deniedViewport.textContent).toContain(
      'This account does not have camera monitoring access to this site.',
    );
    expect(screen.queryByText('Camera Snapshot Unavailable')).toBeNull();
    expect(screen.queryByTestId('back-to-grid-btn')).toBeNull();
    expect(screen.queryByTestId('single-viewport-back-to-grid-btn')).toBeNull();

    // When an authorized Safety Officer has an active camera, only one Back to grid control exists (inside the viewport header)
    previewStore.byCameraId['cam-1'] = {
      preview: makePreview('CAM-01', []),
      status: 'LIVE',
      sourceKind: 'LIVE',
    };
    rerender(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={officerSessionAlpha} />
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: /Camera 01/i });
    const activeViewport = screen.getByTestId('single-camera-viewport');
    expect(activeViewport.className).toContain('aspect-video');
    expect(screen.queryByTestId('back-to-grid-btn')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Back to grid' })).toHaveLength(1);
    expect(screen.getByTestId('single-viewport-back-to-grid-btn')).not.toBeNull();
  });

  it('shows SOURCE: CONNECTING and CONNECTING status pill in single-viewport-header while AI-analyzed snapshot is pending, before transitioning to UNAVAILABLE on failure', async () => {
    previewStore.byCameraId['cam-1'] = {
      preview: null,
      status: 'CONNECTING',
      sourceKind: null,
    };

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={officerSessionAlpha} />
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: /Camera 01/i });

    const viewport = screen.getByTestId('single-camera-viewport');
    const viewportHeader = within(screen.getByTestId('single-viewport-header'));

    expect(viewport.textContent).toContain('Connecting to camera snapshot (500ms)...');
    expect(viewport.textContent).toContain('Authorized site and camera scope verified.');
    expect(screen.queryByText('Camera Snapshot Unavailable')).toBeNull();

    expect(viewportHeader.getByTestId('factual-source-label').textContent).toBe(
      'SOURCE: CONNECTING',
    );
    expect(viewportHeader.getByText('CONNECTING')).not.toBeNull();
    expect(viewportHeader.queryByText('UNAVAILABLE')).toBeNull();

    previewStore.byCameraId['cam-1'] = {
      preview: null,
      status: 'UNAVAILABLE',
      sourceKind: null,
    };

    rerender(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={officerSessionAlpha} />
      </QueryClientProvider>,
    );

    expect(viewportHeader.getByTestId('factual-source-label').textContent).toBe(
      'SOURCE: UNAVAILABLE',
    );
    expect(viewportHeader.getByText('UNAVAILABLE')).not.toBeNull();
    expect(screen.getByText('Camera Snapshot Unavailable')).not.toBeNull();
  });
});
