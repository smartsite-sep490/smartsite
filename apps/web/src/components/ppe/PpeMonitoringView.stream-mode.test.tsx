// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import type { CameraMediaFrame, Page, SiteResponse } from '@smartsite/api-client';
import type { CameraResponse } from '@smartsite/contracts';
import type { ScopedMediaStatus } from '../cameras/useScopedCameraMedia';
import type { ScopedPreviewStatus } from '../cameras/useScopedCameraPreview';
import type { ScopedRecordedVideoStatus } from '../cameras/useScopedRecordedVideo';
import type { DecodedPreview } from '../cameras/useRealtimePreview';
import type { VideoTestDetection } from '../cameras/videoTestFixture';
import type { SharedSession } from '../../types/shared-session';
import i18n from '../../i18n';
import { PpeMonitoringView } from './PpeMonitoringView';

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
  retry: vi.fn(),
}));

const mediaState = vi.hoisted(() => ({
  image: null as HTMLImageElement | null,
  frame: null as CameraMediaFrame | null,
  status: 'LIVE' as ScopedMediaStatus,
  error: null as string | null,
  errorStatus: null as number | null,
  enabledCalls: [] as Array<boolean | undefined>,
  retry: vi.fn(),
}));

const recordedVideoState = vi.hoisted(() => ({
  videoUrl: null as string | null,
  status: 'READY' as ScopedRecordedVideoStatus,
  error: null as string | null,
  errorStatus: null as number | null,
  enabledCalls: [] as Array<boolean | undefined>,
  retry: vi.fn(),
}));

vi.mock('../cameras/useScopedCameraMedia', () => ({
  useScopedCameraMedia: (options?: { enabled?: boolean }) => {
    mediaState.enabledCalls.push(options?.enabled);
    return {
      image: mediaState.image,
      frame: mediaState.frame,
      status: mediaState.status,
      error: mediaState.error,
      errorStatus: mediaState.errorStatus,
      isStreaming: Boolean(options?.enabled && mediaState.status === 'LIVE'),
      retry: mediaState.retry,
    };
  },
}));

vi.mock('../cameras/useScopedRecordedVideo', () => ({
  useScopedRecordedVideo: (options?: { enabled?: boolean }) => {
    recordedVideoState.enabledCalls.push(options?.enabled);
    return {
      videoUrl: recordedVideoState.videoUrl,
      status: recordedVideoState.status,
      error: recordedVideoState.error,
      errorStatus: recordedVideoState.errorStatus,
      isLoading: Boolean(options?.enabled && recordedVideoState.status === 'LOADING'),
      retry: recordedVideoState.retry,
    };
  },
}));

vi.mock('../cameras/useScopedCameraPreview', () => ({
  useScopedCameraPreview: (options?: {
    cameraId?: string | null;
    siteId?: string | null;
    enabled?: boolean;
  }) => {
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

const liveHardwareCamera: CameraResponse = {
  id: 'cam-live-1',
  siteId: 'site-alpha',
  externalId: 'tapo-core5-live',
  code: 'TAPO-01',
  name: 'Tapo Live Camera',
  status: 'ACTIVE',
  configurationVersion: 1,
  createdAt: '2026-09-30T00:00:00Z',
};

const recordedDemoCamera: CameraResponse = {
  id: 'cam-recorded-1',
  siteId: 'site-alpha',
  externalId: 'core5-recorded-demo',
  code: 'REC-01',
  name: 'Recorded Demo Camera',
  status: 'ACTIVE',
  configurationVersion: 1,
  createdAt: '2026-09-30T00:00:00Z',
};

const mockCamerasList: Page<CameraResponse> = {
  items: [liveHardwareCamera, recordedDemoCamera],
  total: 2,
};

const officerSessionAlpha: SharedSession = {
  accessToken: 'token-stream-mode-alpha',
  sessionScope: 'scope-stream-mode-alpha',
  user: {
    id: 'officer-stream-1',
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
    ppeStatus: { HARD_HAT: 'UNKNOWN', SAFETY_VEST: 'PRESENT' },
    timecode: '01:23',
    trackId: 7,
    cameraExternalId: 'tapo-core5-live',
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

describe('PpeMonitoringView Wall vs Single Stream Mode Truthfulness (Defect 1A)', () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    vi.stubEnv('VITE_AI_WORK_PAUSED', 'false');
    await i18n.changeLanguage('en');
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    previewStore.byCameraId = {};
    previewStore.retry.mockClear();
    mediaState.image = { naturalWidth: 640, naturalHeight: 480 } as HTMLImageElement;
    mediaState.frame = {
      type: 'media-frame',
      mediaVersion: 1,
      cameraExternalId: 'tapo-core5-live',
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      sequenceNumber: '100',
      capturedAt: '2026-10-19T08:30:00.000Z',
      width: 640,
      height: 480,
      imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
    };
    mediaState.status = 'LIVE';
    mediaState.error = null;
    mediaState.errorStatus = null;
    mediaState.enabledCalls = [];
    recordedVideoState.videoUrl = 'blob:http://localhost:3000/mock-recorded.mp4';
    recordedVideoState.status = 'READY';
    recordedVideoState.error = null;
    recordedVideoState.errorStatus = null;
    recordedVideoState.enabledCalls = [];

    const noop = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      new Proxy(
        {},
        { get: (_t, prop) => (prop === 'measureText' ? () => ({ width: 42 }) : noop) },
      ) as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
      items: [baseSite],
      total: 1,
    });
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

  it('reports AI snapshot offline in 2x2 Wall mode when a live-source camera snapshot is UNAVAILABLE without claiming raw live feed, while preserving raw-feed description in Single live-raw mode', async () => {
    const user = userEvent.setup();
    previewStore.byCameraId['cam-live-1'] = {
      preview: null,
      status: 'UNAVAILABLE',
      sourceKind: null,
    };
    previewStore.byCameraId['cam-recorded-1'] = {
      preview: null,
      status: 'UNAVAILABLE',
      sourceKind: null,
    };

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={officerSessionAlpha} />
      </QueryClientProvider>,
    );

    // 1. In Single mode, live-source camera defaults to live-raw and truthfully describes unanalyzed raw feed
    const rawToggle = await screen.findByTestId('mode-toggle-live-raw');
    expect(rawToggle.getAttribute('aria-pressed')).toBe('true');

    await user.click(screen.getByTestId('open-evidence-details-btn'));
    const singlePanel = within(screen.getByTestId('ai-detection-panel'));
    expect(singlePanel.getByTestId('raw-feed-unanalyzed-badge').textContent).toBe(
      'RAW VIEW UNANALYZED',
    );
    expect(singlePanel.getByTestId('ai-evidence-badge').textContent).toBe(
      'AI EVIDENCE UNAVAILABLE',
    );
    const singleVerdict = within(singlePanel.getByTestId('ppe-result-verdict'));
    expect(singleVerdict.getByText('AI EVIDENCE UNAVAILABLE')).not.toBeNull();
    expect(
      singleVerdict.getByText(
        'Displaying unanalyzed raw camera feed. AI snapshot inspection is currently unavailable.',
      ),
    ).not.toBeNull();
    expect(
      within(singlePanel.getByTestId('ai-snapshot-unavailable-msg')).getByText(
        'Displaying unanalyzed raw camera feed. Periodic snapshot inspection is offline or not received.',
      ),
    ).not.toBeNull();

    await user.click(screen.getByRole('button', { name: 'Close dialog' }));

    // 2. Switch to 4-Source Wall mode: wall only displays AI snapshots, never raw video
    await user.click(screen.getByTestId('toggle-view-wall'));
    await screen.findByTestId('four-source-wall-grid');
    expect(mediaState.enabledCalls.at(-1)).toBe(false);
    expect(recordedVideoState.enabledCalls.at(-1)).toBe(false);

    await user.click(screen.getByTestId('open-evidence-details-btn'));
    const wallPanel = within(screen.getByTestId('ai-detection-panel'));
    expect(wallPanel.queryByTestId('raw-feed-unanalyzed-badge')).toBeNull();
    expect(wallPanel.queryByTestId('recorded-feed-unanalyzed-badge')).toBeNull();
    expect(wallPanel.getByTestId('ai-evidence-badge').textContent).toBe('AI EVIDENCE UNAVAILABLE');
    const wallVerdict = within(wallPanel.getByTestId('ppe-result-verdict'));
    expect(wallVerdict.getByText('AI EVIDENCE UNAVAILABLE')).not.toBeNull();
    expect(wallVerdict.getByText('Camera snapshot is unavailable or offline.')).not.toBeNull();
    expect(
      within(wallPanel.getByTestId('ai-snapshot-unavailable-msg')).getByText(
        'No active AI preview snapshot received for this camera.',
      ),
    ).not.toBeNull();
    expect(
      wallPanel.queryByText(
        'Displaying unanalyzed raw camera feed. AI snapshot inspection is currently unavailable.',
      ),
    ).toBeNull();
    expect(
      wallPanel.queryByText(
        'Displaying unanalyzed raw camera feed. Periodic snapshot inspection is offline or not received.',
      ),
    ).toBeNull();

    // 3. Also verify recorded-source camera on the wall does not show RECORDED RAW badge
    await user.click(screen.getByRole('button', { name: 'Close dialog' }));
    await user.click(screen.getByTestId('focus-btn-cam-recorded-1'));
    await user.click(screen.getByTestId('open-evidence-details-btn'));
    const wallRecordedPanel = within(screen.getByTestId('ai-detection-panel'));
    expect(wallRecordedPanel.queryByTestId('recorded-feed-unanalyzed-badge')).toBeNull();
    expect(wallRecordedPanel.getByTestId('ai-evidence-badge').textContent).toBe(
      'AI EVIDENCE UNAVAILABLE',
    );
    const wallRecordedVerdict = within(wallRecordedPanel.getByTestId('ppe-result-verdict'));
    expect(wallRecordedVerdict.getByText('AI EVIDENCE UNAVAILABLE')).not.toBeNull();
    expect(
      wallRecordedVerdict.getByText('Camera snapshot is unavailable or offline.'),
    ).not.toBeNull();

    // 4. Returning to Single mode restores recorded-raw for cam-recorded-1 and live-raw for cam-live-1
    await user.click(screen.getByRole('button', { name: 'Close dialog' }));
    await user.click(screen.getByTestId('toggle-view-single'));
    const recordedToggle = await screen.findByTestId('mode-toggle-recorded-raw');
    expect(recordedToggle.getAttribute('aria-pressed')).toBe('true');
  });

  it('preserves current UNKNOWN vs explicit confirmedMissingItems episode warning on 2x2 Wall for a live-source camera when AI snapshot is LIVE', async () => {
    const user = userEvent.setup();
    previewStore.byCameraId['cam-live-1'] = {
      preview: makePreview('tapo-core5-live', [
        makeDetection({
          ppeStatus: { HARD_HAT: 'UNKNOWN', SAFETY_VEST: 'PRESENT' },
          confirmedMissingItems: ['HARD_HAT'],
        }),
      ]),
      status: 'LIVE',
      sourceKind: 'LIVE',
    };

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={officerSessionAlpha} />
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: /Tapo Live Camera/i });
    await user.click(screen.getByTestId('toggle-view-wall'));
    await screen.findByTestId('four-source-wall-grid');

    await user.click(screen.getByTestId('open-evidence-details-btn'));
    const wallPanel = within(screen.getByTestId('ai-detection-panel'));
    expect(wallPanel.queryByTestId('raw-feed-unanalyzed-badge')).toBeNull();
    expect(wallPanel.getByText('MISSING PPE DETECTED')).not.toBeNull();
    expect(wallPanel.getByText('Missing PPE observed in snapshot.')).not.toBeNull();
    expect(wallPanel.getByText('Helmet · Unknown')).not.toBeNull();
    expect(wallPanel.queryByText('Helmet · Missing · confirmed')).toBeNull();

    const episodeWarning = wallPanel.getByTestId('confirmed-episode-warning-7-HARD_HAT');
    expect(episodeWarning.textContent).toContain('Active confirmed episode: Missing · confirmed');
    expect(episodeWarning.textContent).toContain('Current snapshot: Unknown');
  });

  it('retains explicit user-chosen AI evidence mode on the same live-source camera across a single -> wall -> single roundtrip without re-enabling raw media hooks', async () => {
    const user = userEvent.setup();
    previewStore.byCameraId['cam-live-1'] = {
      preview: makePreview('tapo-core5-live', [makeDetection()]),
      status: 'LIVE',
      sourceKind: 'LIVE',
    };

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={officerSessionAlpha} />
      </QueryClientProvider>,
    );

    // 1. Initial Single view on cam-live-1 defaults to live-raw with raw media hook enabled
    const rawToggleInitial = await screen.findByTestId('mode-toggle-live-raw');
    const aiToggleInitial = screen.getByTestId('mode-toggle-ai-analyzed');
    expect(rawToggleInitial.getAttribute('aria-pressed')).toBe('true');
    expect(aiToggleInitial.getAttribute('aria-pressed')).toBe('false');
    expect(mediaState.enabledCalls.at(-1)).toBe(true);
    expect(recordedVideoState.enabledCalls.at(-1)).toBe(false);

    // 2. Operator explicitly switches cam-live-1 to AI evidence (Boxes) mode in Single view
    await user.click(aiToggleInitial);
    expect(aiToggleInitial.getAttribute('aria-pressed')).toBe('true');
    expect(rawToggleInitial.getAttribute('aria-pressed')).toBe('false');
    expect(mediaState.enabledCalls.at(-1)).toBe(false);
    expect(recordedVideoState.enabledCalls.at(-1)).toBe(false);
    expect(screen.getByText('AI snapshot polling: 500ms')).not.toBeNull();

    // 3. Switch to 4-Source Wall view on the same camera: media hooks remain disabled
    await user.click(screen.getByTestId('toggle-view-wall'));
    await screen.findByTestId('four-source-wall-grid');
    expect(mediaState.enabledCalls.at(-1)).toBe(false);
    expect(recordedVideoState.enabledCalls.at(-1)).toBe(false);

    // 4. Return to Single view on the same cam-live-1: explicit AI mode is preserved, not reset to live-raw
    await user.click(screen.getByTestId('toggle-view-single'));
    const aiToggleReturned = await screen.findByTestId('mode-toggle-ai-analyzed');
    const rawToggleReturned = screen.getByTestId('mode-toggle-live-raw');
    expect(aiToggleReturned.getAttribute('aria-pressed')).toBe('true');
    expect(rawToggleReturned.getAttribute('aria-pressed')).toBe('false');
    expect(mediaState.enabledCalls.at(-1)).toBe(false);
    expect(recordedVideoState.enabledCalls.at(-1)).toBe(false);
    expect(screen.queryByTestId('raw-camera-media-canvas')).toBeNull();
    expect(screen.getByText('AI snapshot polling: 500ms')).not.toBeNull();
  });
});
