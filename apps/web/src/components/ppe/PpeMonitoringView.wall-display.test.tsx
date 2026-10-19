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

const mockSitesList: Page<SiteResponse> = {
  items: [
    {
      id: 'site-alpha',
      code: 'SITE-A',
      name: 'Alpha Construction Site',
      createdAt: '2026-09-30T00:00:00Z',
    },
  ],
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

const mockCamerasList: Page<CameraResponse> = {
  items: [
    baseCamera,
    { ...baseCamera, id: 'cam-2', externalId: 'CAM-02', code: 'CAM-02', name: 'Camera 02' },
  ],
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

    const rightCard = within(screen.getByTestId('ai-detection-panel'));
    expect(screen.getByText('Live Monitored')).not.toBeNull();
    expect(screen.queryByText('Feed Standby')).toBeNull();
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
    expect(screen.getByText('Live AI Observations Active')).not.toBeNull();
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

    const rightCard = within(screen.getByTestId('ai-detection-panel'));
    await waitFor(() => {
      expect(screen.getByText('Replay Mode')).not.toBeNull();
    });
    expect(screen.queryByText('Feed Standby')).toBeNull();
    expect(rightCard.getByTestId('ai-evidence-badge').textContent).toBe(
      '00000000-0000-4000-8000-000000000002',
    );
    expect(rightCard.getAllByText('Track #12').length).toBeGreaterThan(0);
    expect(rightCard.getByText('91%')).not.toBeNull();
    expect(rightCard.getByText('SCANNING SNAPSHOT')).not.toBeNull();
    expect(
      rightCard.getByText('Rendering recorded video replay stream from Camera Preview API.'),
    ).not.toBeNull();
    expect(screen.getByText('Replay AI Observations Active')).not.toBeNull();
    expect(screen.queryByText('Live AI Observations Active')).toBeNull();
    expect(
      screen.getByText(/Technical PPE detections are rendered from recorded video replay stream/i),
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

    const rightCard = within(screen.getByTestId('ai-detection-panel'));
    expect(screen.getByText('Live Monitored')).not.toBeNull();
    expect(rightCard.getAllByText('Track #7').length).toBeGreaterThan(0);

    await user.click(screen.getByTestId('focus-btn-cam-2'));
    await waitFor(() => {
      expect(screen.getByText('Feed Standby')).not.toBeNull();
    });
    expect(rightCard.getByTestId('ai-evidence-badge').textContent).toBe('AI EVIDENCE UNAVAILABLE');
    expect(rightCard.getByText('AI snapshot unavailable')).not.toBeNull();
    expect(rightCard.getByTestId('ai-snapshot-unavailable-msg')).not.toBeNull();
    expect(rightCard.queryByText('Track #7')).toBeNull();
    expect(
      (rightCard.getByRole('button', { name: 'Review Alert' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    await user.click(screen.getByTestId('focus-btn-cam-1'));
    await waitFor(() => {
      expect(screen.getByText('Live Monitored')).not.toBeNull();
    });

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
    expect(rightCard.getByTestId('ai-evidence-badge').textContent).toBe('AI EVIDENCE UNAVAILABLE');
    expect(screen.queryByText('Track #7')).toBeNull();
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
    expect(screen.getByTestId('ai-evidence-badge').textContent).toBe('AI WORK PAUSED');
    expect(screen.getByTestId('ai-paused-empty-state')).not.toBeNull();
    expect(screen.getByTestId('wall-paused-cam-1')).not.toBeNull();
    expect(screen.queryByText('Track #7')).toBeNull();
    expect(previewStore.calls.every((call) => call.enabled === false)).toBe(true);
  });
});
