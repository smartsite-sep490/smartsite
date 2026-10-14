// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import type { Page, SiteResponse, CameraMediaFrame } from '@smartsite/api-client';
import type { CameraResponse } from '@smartsite/contracts';
import type { ScopedMediaStatus } from '../cameras/useScopedCameraMedia';
import type { ScopedRecordedVideoStatus } from '../cameras/useScopedRecordedVideo';
import { PpeMonitoringView } from './PpeMonitoringView';
import type { DecodedPreview } from '../cameras/useRealtimePreview';
import type { VideoTestDetection } from '../cameras/videoTestFixture';
import type { SharedSession } from '../../types/shared-session';

if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

const state = vi.hoisted(() => ({
  preview: null as DecodedPreview | null,
  status: null as 'LIVE' | 'REPLAY' | 'UNAVAILABLE' | 'CONNECTING' | null,
  sourceKind: null as 'LIVE' | 'REPLAY' | null,
  error: null as string | null,
  errorStatus: null as number | null,
  retry: vi.fn(),
}));

const mediaState = vi.hoisted(() => ({
  image: null as HTMLImageElement | null,
  frame: null as CameraMediaFrame | null,
  status: 'LIVE' as ScopedMediaStatus,
  error: null as string | null,
  errorStatus: null as number | null,
  retry: vi.fn(),
}));

const recordedVideoState = vi.hoisted(() => ({
  videoUrl: null as string | null,
  status: 'READY' as ScopedRecordedVideoStatus,
  error: null as string | null,
  errorStatus: null as number | null,
  retry: vi.fn(),
}));

vi.mock('../cameras/useScopedRecordedVideo', () => ({
  useScopedRecordedVideo: () => ({
    videoUrl: recordedVideoState.videoUrl,
    status: recordedVideoState.status,
    error: recordedVideoState.error,
    errorStatus: recordedVideoState.errorStatus,
    isLoading: recordedVideoState.status === 'LOADING',
    retry: recordedVideoState.retry,
  }),
}));

vi.mock('../cameras/useScopedCameraMedia', () => ({
  useScopedCameraMedia: () => ({
    image: mediaState.image,
    frame: mediaState.frame,
    status: mediaState.status,
    error: mediaState.error,
    errorStatus: mediaState.errorStatus,
    isStreaming: mediaState.status === 'LIVE',
    retry: mediaState.retry,
  }),
}));

vi.mock('../cameras/useScopedCameraPreview', () => ({
  useScopedCameraPreview: () => ({
    preview: state.preview,
    status: state.status ?? (state.preview ? 'LIVE' : 'UNAVAILABLE'),
    sourceKind:
      state.sourceKind ??
      (state.status === 'REPLAY' ? 'REPLAY' : state.preview ? 'LIVE' : null),
    error: state.error ?? null,
    errorStatus: state.errorStatus ?? null,
    isError: false,
    isLoading: false,
    isPolling: Boolean(state.preview),
    retry: state.retry,
    cameraExternalId: state.preview?.frame.cameraExternalId ?? null,
    capturedAt: state.preview?.frame.capturedAt ?? null,
  }),
}));

vi.mock('../cameras/useRealtimePreview', () => ({
  useRealtimePreview: () => ({ preview: state.preview, connected: true, error: null }),
}));

vi.mock('./Mf05DemoControlPanel', () => ({
  Mf05DemoControlPanel: () => <div data-testid="mf05-demo-control-panel" />,
}));

const mockSitesList: Page<SiteResponse> = {
  items: [
    {
      id: 'site-alpha',
      code: 'SITE-A',
      name: 'Site Alpha',
      createdAt: '2026-09-30T00:00:00Z',
    },
  ],
  total: 1,
};

const mockCamerasList: Page<CameraResponse> = {
  items: [
    {
      id: 'cam-laptop',
      siteId: 'site-alpha',
      externalId: 'laptop-webcam-live',
      code: 'CAM-WEBCAM',
      name: 'Laptop Live Webcam',
      status: 'ACTIVE',
      configurationVersion: 1,
      createdAt: '2026-09-30T00:00:00Z',
    },
  ],
  total: 1,
};

function createMockDetection(overrides: Partial<VideoTestDetection> = {}): VideoTestDetection {
  return {
    active: true,
    alertState: 'CONFIRMED',
    confirmedMissingItems: ['GLOVES'],
    boundingBox: { x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.9 },
    confidence: 0.92,
    eventId: '00000000-0000-4000-8000-000000000001',
    label: 'Track #7 PPE Inspection',
    ppeStatus: {
      HARD_HAT: 'PRESENT',
      SAFETY_VEST: 'PRESENT',
      GLOVES: 'UNKNOWN',
    },
    timecode: '00:15',
    trackId: 7,
    cameraExternalId: 'laptop-webcam-live',
    ...overrides,
  };
}

function createMockPreview(detection: VideoTestDetection): DecodedPreview {
  return {
    image: {} as HTMLImageElement,
    frame: {
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      sequenceNumber: '1',
      cameraExternalId: 'laptop-webcam-live',
      capturedAt: '2026-10-08T12:00:00Z',
      width: 640,
      height: 480,
      imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      zonePolygons: [],
      detections: [detection],
      zoneDetections: [],
    },
  };
}

const testSession: SharedSession = {
  accessToken: 'mock-valid-token',
  sessionScope: 'scope-webcam',
  user: {
    id: 'user-op-1',
    displayName: 'Safety Officer',
    roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: 'site-alpha' }],
  },
  onSignOut: vi.fn(),
};

describe('PpeMonitoringView - Current Snapshot vs Active Confirmed Episode (MF05 Regression)', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue(mockSitesList);
    vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockResolvedValue(
      mockCamerasList,
    );
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.restoreAllMocks();
    state.preview = null;
    state.status = null;
    state.sourceKind = null;
    mediaState.image = null;
    mediaState.frame = null;
    mediaState.status = 'LIVE';
    mediaState.error = null;
    mediaState.errorStatus = null;
    recordedVideoState.videoUrl = null;
    recordedVideoState.status = 'READY';
    recordedVideoState.error = null;
    recordedVideoState.errorStatus = null;
    recordedVideoState.retry.mockClear();
  });

  it('1. UNKNOWN+confirmed GLOVES: preserves current snapshot Unknown and renders separate compact warning for confirmed episode', async () => {
    const detection = createMockDetection({
      ppeStatus: {
        HARD_HAT: 'PRESENT',
        SAFETY_VEST: 'PRESENT',
        GLOVES: 'UNKNOWN',
      },
      confirmedMissingItems: ['GLOVES'],
    });
    state.preview = createMockPreview(detection);
    state.status = 'LIVE';
    state.sourceKind = 'LIVE';

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={testSession} />
      </QueryClientProvider>,
    );

    // Existing UI text for current evidence is present
    const currentEvidenceText = await screen.findByText(/Gloves · Unknown/i);
    expect(currentEvidenceText).not.toBeNull();

    // Semantic assertion for separate compact warning for confirmed episode
    const warningBox = await screen.findByTestId('confirmed-episode-warning-7-GLOVES');
    expect(warningBox).not.toBeNull();
    expect(warningBox.textContent).toContain('Active confirmed episode: Missing · confirmed');
    expect(warningBox.textContent).toContain('Current snapshot: Unknown');
    expect(warningBox.textContent).toContain(
      'Unknown means insufficient current evidence and does not clear confirmed episode.',
    );
  });

  it('2. PRESENT+confirmed GLOVES (one clear frame): preserves current snapshot Detected and renders separate compact warning', async () => {
    const detection = createMockDetection({
      ppeStatus: {
        HARD_HAT: 'PRESENT',
        SAFETY_VEST: 'PRESENT',
        GLOVES: 'PRESENT',
      },
      confirmedMissingItems: ['GLOVES'],
    });
    state.preview = createMockPreview(detection);
    state.status = 'LIVE';
    state.sourceKind = 'LIVE';

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={testSession} />
      </QueryClientProvider>,
    );

    // Existing UI text for current evidence is present
    const currentEvidenceText = await screen.findByText(/Gloves · Detected/i);
    expect(currentEvidenceText).not.toBeNull();

    // Semantic assertion for separate compact warning indicating previous missing episode is still confirmed
    const warningBox = await screen.findByTestId('confirmed-episode-warning-7-GLOVES');
    expect(warningBox).not.toBeNull();
    expect(warningBox.textContent).toContain('Active confirmed episode: Missing · confirmed');
    expect(warningBox.textContent).toContain('Current snapshot: Detected');
    expect(warningBox.textContent).toContain('Previous missing episode still confirmed');
  });

  it('3. Cleared empty array: transition naturally clears separate confirmed warning when server clears confirmedMissingItems', async () => {
    // Phase 1: active confirmed missing GLOVES with current UNKNOWN
    const activeDetection = createMockDetection({
      ppeStatus: {
        HARD_HAT: 'PRESENT',
        SAFETY_VEST: 'PRESENT',
        GLOVES: 'UNKNOWN',
      },
      confirmedMissingItems: ['GLOVES'],
    });
    state.preview = createMockPreview(activeDetection);
    state.status = 'LIVE';
    state.sourceKind = 'LIVE';

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={testSession} />
      </QueryClientProvider>,
    );

    await screen.findByText(/Gloves · Unknown/i);
    await screen.findByTestId('confirmed-episode-warning-7-GLOVES');

    // Phase 2: server clears confirmedMissingItems on next frame, GLOVES detected
    const clearedDetection = createMockDetection({
      ppeStatus: {
        HARD_HAT: 'PRESENT',
        SAFETY_VEST: 'PRESENT',
        GLOVES: 'PRESENT',
      },
      confirmedMissingItems: [], // Server cleared
    });
    state.preview = createMockPreview(clearedDetection);

    rerender(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={testSession} />
      </QueryClientProvider>,
    );

    await screen.findByText(/Gloves · Detected/i);

    // Warning is proven to disappear on transition
    expect(screen.queryByTestId('confirmed-episode-warning-7-GLOVES')).toBeNull();
  });

  it('4. Current unknown unconfirmed: does not show warning when item is UNKNOWN and not in confirmedMissingItems', async () => {
    const detection = createMockDetection({
      active: true, // Legacy active flag
      alertState: 'CONFIRMED',
      confirmedMissingItems: ['HARD_HAT'], // Only HARD_HAT, NOT GLOVES
      ppeStatus: {
        HARD_HAT: 'MISSING',
        SAFETY_VEST: 'PRESENT',
        GLOVES: 'UNKNOWN',
      },
    });
    state.preview = createMockPreview(detection);
    state.status = 'LIVE';
    state.sourceKind = 'LIVE';

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={testSession} />
      </QueryClientProvider>,
    );

    await screen.findByText(/Gloves · Unknown/i);

    // GLOVES must NOT have a confirmed episode warning because it is not in confirmedMissingItems
    expect(screen.queryByTestId('confirmed-episode-warning-7-GLOVES')).toBeNull();
  });

  it('5. Absent confirmedMissingItems with legacy active=true: cannot create item warning without explicit array', async () => {
    const detection = createMockDetection({
      active: true, // Legacy active flag is true
      alertState: 'CONFIRMED',
      confirmedMissingItems: undefined, // Absent array
      ppeStatus: {
        HARD_HAT: 'MISSING',
        SAFETY_VEST: 'PRESENT',
        GLOVES: 'UNKNOWN',
      },
    });
    state.preview = createMockPreview(detection);
    state.status = 'LIVE';
    state.sourceKind = 'LIVE';

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={testSession} />
      </QueryClientProvider>,
    );

    await screen.findByText(/Gloves · Unknown/i);

    // Legacy active=true cannot blanket fall back to creating warning for GLOVES
    expect(screen.queryByTestId('confirmed-episode-warning-7-GLOVES')).toBeNull();
  });

  it('6. Source / auth unavailable: transition from active warning gracefully clears stale warnings', async () => {
    // Phase 1: active confirmed warning present
    const activeDetection = createMockDetection({
      ppeStatus: {
        HARD_HAT: 'PRESENT',
        SAFETY_VEST: 'PRESENT',
        GLOVES: 'UNKNOWN',
      },
      confirmedMissingItems: ['GLOVES'],
    });
    state.preview = createMockPreview(activeDetection);
    state.status = 'LIVE';
    state.sourceKind = 'LIVE';

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={testSession} />
      </QueryClientProvider>,
    );

    await screen.findByText(/Gloves · Unknown/i);
    await screen.findByTestId('confirmed-episode-warning-7-GLOVES');

    // Phase 2: feed / auth becomes unavailable
    state.preview = null;
    state.status = 'UNAVAILABLE';

    rerender(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={testSession} />
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId('ai-snapshot-unavailable-msg')).not.toBeNull();
    expect(screen.queryByTestId('confirmed-episode-warning-7-GLOVES')).toBeNull();
  });

  it('7. Omitted current status with explicit confirmed GLOVES: displays Current snapshot Not reported and separate active confirmed warning', async () => {
    const detection = createMockDetection({
      ppeStatus: {
        HARD_HAT: 'PRESENT',
        SAFETY_VEST: 'PRESENT',
      },
      confirmedMissingItems: ['GLOVES'],
    });
    delete (detection.ppeStatus as Record<string, string | undefined>).GLOVES;

    state.preview = createMockPreview(detection);
    state.status = 'LIVE';
    state.sourceKind = 'LIVE';

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={testSession} />
      </QueryClientProvider>,
    );

    // Current snapshot row displays Gloves · Not reported
    const currentEvidenceText = await screen.findByText(/Gloves · Not reported/i);
    expect(currentEvidenceText).not.toBeNull();

    // Separate compact warning for confirmed episode is rendered
    const warningBox = await screen.findByTestId('confirmed-episode-warning-7-GLOVES');
    expect(warningBox).not.toBeNull();
    expect(warningBox.textContent).toContain('Active confirmed episode: Missing · confirmed');
    expect(warningBox.textContent).toContain('Current snapshot: Not reported');
    expect(warningBox.textContent).toContain(
      'Not reported indicates current snapshot omitted item evidence and does not clear confirmed episode.',
    );
  });
});
