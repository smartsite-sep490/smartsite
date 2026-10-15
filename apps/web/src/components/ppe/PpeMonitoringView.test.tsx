// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { SmartSiteManagementClient, ApiError } from '@smartsite/api-client';
import type { Page, SiteResponse, CameraMediaFrame } from '@smartsite/api-client';
import type { CameraResponse } from '@smartsite/contracts';
import type { ScopedMediaStatus } from '../cameras/useScopedCameraMedia';
import type { ScopedRecordedVideoStatus } from '../cameras/useScopedRecordedVideo';
import type { Mf05DemoControlPanelProps } from './Mf05DemoControlPanel';
import { PpeMonitoringView } from './PpeMonitoringView';
import { formatPpeItemLabel } from '../cameras/monitoringUtils';
import type { DecodedPreview } from '../cameras/useRealtimePreview';
import type { VideoTestDetection } from '../cameras/videoTestFixture';
import type { SharedSession } from '../../types/shared-session';
import { AuthContext } from '../../features/auth/auth-session';
import i18n from '../../i18n';

// These suites render synthetic, mocked media hooks. Active-view cases need an
// explicit fixture mode; dedicated paused cases below override it to true.
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

const hookOptionsState = vi.hoisted(() => ({
  previewOptions: null as { enabled?: boolean } | null,
  mediaOptions: null as { enabled?: boolean } | null,
  recordedVideoOptions: null as { enabled?: boolean } | null,
}));

vi.mock('../cameras/useScopedRecordedVideo', () => ({
  useScopedRecordedVideo: (options?: { enabled?: boolean }) => {
    hookOptionsState.recordedVideoOptions = options ?? null;
    return {
      videoUrl: recordedVideoState.videoUrl,
      status: recordedVideoState.status,
      error: recordedVideoState.error,
      errorStatus: recordedVideoState.errorStatus,
      isLoading: recordedVideoState.status === 'LOADING',
      retry: recordedVideoState.retry,
    };
  },
}));

vi.mock('../cameras/useScopedCameraMedia', () => ({
  useScopedCameraMedia: (options?: { enabled?: boolean }) => {
    hookOptionsState.mediaOptions = options ?? null;
    return {
      image: mediaState.image,
      frame: mediaState.frame,
      status: mediaState.status,
      error: mediaState.error,
      errorStatus: mediaState.errorStatus,
      isStreaming: mediaState.status === 'LIVE',
      retry: mediaState.retry,
    };
  },
}));

vi.mock('../cameras/useScopedCameraPreview', () => ({
  useScopedCameraPreview: (options?: { enabled?: boolean }) => {
    hookOptionsState.previewOptions = options ?? null;
    return {
      preview: state.preview,
      status: state.status ?? (state.preview ? 'LIVE' : 'UNAVAILABLE'),
      sourceKind:
        state.sourceKind ?? (state.status === 'REPLAY' ? 'REPLAY' : state.preview ? 'LIVE' : null),
      error: state.error ?? null,
      errorStatus: state.errorStatus ?? null,
      isError: false,
      isLoading: false,
      isPolling: Boolean(state.preview),
      retry: state.retry,
      cameraExternalId: state.preview?.frame.cameraExternalId ?? null,
      capturedAt: state.preview?.frame.capturedAt ?? null,
    };
  },
}));
vi.mock('../cameras/useRealtimePreview', () => ({
  useRealtimePreview: () => ({ preview: state.preview, connected: true, error: null }),
}));

const demoPanelState = vi.hoisted(() => ({
  rendered: false,
  props: null as Mf05DemoControlPanelProps | null,
}));
vi.mock('./Mf05DemoControlPanel', () => ({
  Mf05DemoControlPanel: (props: Mf05DemoControlPanelProps) => {
    demoPanelState.rendered = true;
    demoPanelState.props = props;
    return (
      <div data-testid="mf05-demo-control-panel">
        <span>MF05 Diagnostic Region Controls</span>
        <span>Saved Rev: 3</span>
        <span>Loaded Rev: 3</span>
        <select aria-label="Active Saved Region" defaultValue="region-1">
          <option value="region-1">ZONE-A (v2)</option>
        </select>
        <button
          type="button"
          disabled={!props.canApply}
          onClick={() => props.onApplyingChange?.(true)}
        >
          Apply Saved Region
        </button>
        <button type="button" onClick={() => props.onApplyingChange?.(false)}>
          Finish Apply
        </button>
      </div>
    );
  },
}));

const mockSitesList: Page<SiteResponse> = {
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

const mockCamerasList: Page<CameraResponse> = {
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
      id: 'cam-2',
      siteId: 'site-alpha',
      externalId: 'CAM-02',
      code: 'CAM-02',
      name: 'Camera 02',
      status: 'ACTIVE',
      configurationVersion: 1,
      createdAt: '2026-09-30T00:00:00Z',
    },
  ],
  total: 2,
};

function mockDetection(trackId = 7): VideoTestDetection {
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
    trackId,
    cameraExternalId: 'CAM-01',
  };
}

function mockPreview(detection?: VideoTestDetection): DecodedPreview {
  return {
    image: {} as HTMLImageElement,
    frame: {
      sessionId: '00000000-0000-4000-8000-000000000001',
      sequenceNumber: '1',
      cameraExternalId: 'CAM-01',
      capturedAt: '2026-09-30T00:00:00Z',
      width: 640,
      height: 480,
      imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      zonePolygons: [],
      detections: detection ? [detection] : [],
      zoneDetections: [],
    },
  };
}

describe('PpeMonitoringView Navigation & Bounded Review Integration', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    });
    state.preview = mockPreview(mockDetection(7));
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue(mockSitesList);
    vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockResolvedValue(
      mockCamerasList,
    );
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    state.preview = null;
    state.status = null;
    state.sourceKind = null;
    state.retry.mockClear();
  });

  it('renders "View in Safety Alerts" action and navigates to incidents with PPE_VIOLATION context', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView onNavigate={onNavigate} />
      </QueryClientProvider>,
    );

    const alertsNavButton = screen.getByRole('button', { name: /View in Safety Alerts/i });
    expect(alertsNavButton).not.toBeNull();

    await user.click(alertsNavButton);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith('incidents', { alertType: 'PPE_VIOLATION' });
  });

  it('navigates from Violation Review modal to Safety Alerts when user clicks "Review in Safety Alerts"', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView onNavigate={onNavigate} />
      </QueryClientProvider>,
    );

    const reviewAlertBtn = screen.getByRole('button', { name: /Review Alert/i });
    await user.click(reviewAlertBtn);

    expect(screen.getByRole('heading', { name: 'Violation Review' })).not.toBeNull();

    const reviewInAlertsBtn = screen.getByRole('button', { name: /Review in Safety Alerts/i });
    await user.click(reviewInAlertsBtn);

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith('incidents', { alertType: 'PPE_VIOLATION' });

    expect(screen.queryByRole('heading', { name: 'Violation Review' })).toBeNull();
  });

  it('allows dismissing review preview modal without navigation', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView onNavigate={onNavigate} />
      </QueryClientProvider>,
    );

    const reviewAlertBtn = screen.getByRole('button', { name: /Review Alert/i });
    await user.click(reviewAlertBtn);

    expect(screen.getByRole('heading', { name: 'Violation Review' })).not.toBeNull();

    const dismissBtn = screen.getByRole('button', { name: /Dismiss Preview/i });
    await user.click(dismissBtn);

    expect(screen.queryByRole('heading', { name: 'Violation Review' })).toBeNull();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('hides replay table and shows concise technical-live status when live streaming is active', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView />
      </QueryClientProvider>,
    );

    expect(screen.queryByText('PPE Replay Observations')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();

    expect(screen.getByText('Live AI Observations Active')).not.toBeNull();
    expect(
      screen.getByText(/Technical PPE detections are rendered directly on the live camera feed/i),
    ).not.toBeNull();
  });

  it('displays Replay observations footer status and hides replay table during REPLAY stream playback', () => {
    state.preview = mockPreview(mockDetection(7));
    state.status = 'REPLAY';
    state.sourceKind = 'REPLAY';

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView />
      </QueryClientProvider>,
    );

    expect(screen.queryByText('PPE Replay Observations')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText('Live AI Observations Active')).toBeNull();
    expect(screen.getByText('Replay AI Observations Active')).not.toBeNull();
    expect(
      screen.getByText(/Technical PPE detections are rendered from recorded video replay stream/i),
    ).not.toBeNull();

    // Confirmed-missing detection legitimately displays missing PPE result
    expect(screen.getByText('MISSING PPE DETECTED')).not.toBeNull();
    expect(screen.getByText('Missing PPE observed in snapshot.')).not.toBeNull();
  });

  it('displays recorded video replay wording in RESULT description during REPLAY with pending/unknown observation', () => {
    state.preview = mockPreview({
      ...mockDetection(7),
      active: false,
      alertState: 'PENDING_CONFIRMATION',
      confirmedMissingItems: [],
      ppeStatus: { HARD_HAT: 'UNKNOWN', SAFETY_VEST: 'UNKNOWN' },
    });
    state.status = 'REPLAY';
    state.sourceKind = 'REPLAY';

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView />
      </QueryClientProvider>,
    );

    // Result description uses recorded video replay wording rather than live streaming
    expect(
      screen.getByText(/Rendering recorded video replay stream from Camera Preview API/i),
    ).not.toBeNull();
    expect(screen.queryByText(/Streaming live snapshot from Camera Preview API/i)).toBeNull();
  });

  it('shows replay table when live streaming is not active', () => {
    state.preview = null;

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView />
      </QueryClientProvider>,
    );

    expect(screen.getByText('PPE Replay Observations')).not.toBeNull();
    expect(screen.getByRole('table')).not.toBeNull();
    expect(screen.queryByText('Live AI Observations Active')).toBeNull();
  });

  it('renders legacy checklist with only mandatory Helmet and Safety Vest and omits unrecorded expanded items', () => {
    state.preview = mockPreview({
      ...mockDetection(7),
      ppeStatus: { HARD_HAT: 'MISSING', SAFETY_VEST: 'PRESENT' },
      confirmedMissingItems: ['HARD_HAT'],
    });

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView />
      </QueryClientProvider>,
    );

    expect(screen.getByText('PPE CHECK')).not.toBeNull();
    expect(
      screen.getByText(
        'Core observations: Helmet & Safety Vest. Expanded items are evaluated when reported.',
      ),
    ).not.toBeNull();
    expect(screen.getByText('Helmet · Missing · confirmed')).not.toBeNull();
    expect(screen.getByText('Safety Vest · Detected')).not.toBeNull();
    expect(screen.queryByText(/Gloves ·/i)).toBeNull();
    expect(screen.queryByText(/Boots ·/i)).toBeNull();
    expect(screen.queryByText(/Goggles ·/i)).toBeNull();
    expect(screen.queryByText(/harness/i)).toBeNull();
  });

  it('renders expanded checklist dynamically when GLOVES, BOOTS, and GOGGLES are reported', () => {
    state.preview = mockPreview({
      ...mockDetection(7),
      ppeStatus: {
        HARD_HAT: 'PRESENT',
        SAFETY_VEST: 'PRESENT',
        GLOVES: 'PRESENT',
        BOOTS: 'MISSING',
        GOGGLES: 'UNKNOWN',
      },
      confirmedMissingItems: [],
    });

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView />
      </QueryClientProvider>,
    );

    expect(screen.getByText('Helmet · Detected')).not.toBeNull();
    expect(screen.getByText('Safety Vest · Detected')).not.toBeNull();
    expect(screen.getByText('Gloves · Detected')).not.toBeNull();
    expect(screen.getByText('Boots · Missing · checking')).not.toBeNull();
    expect(screen.getByText('Goggles · Unknown')).not.toBeNull();
    expect(screen.queryByText(/harness/i)).toBeNull();
  });

  it('correctly displays confirmed missing state for expanded items and unknown state for unverified items', () => {
    state.preview = mockPreview({
      ...mockDetection(7),
      ppeStatus: {
        HARD_HAT: 'UNKNOWN',
        SAFETY_VEST: 'PRESENT',
        GLOVES: 'MISSING',
      },
      confirmedMissingItems: ['GLOVES'],
    });

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView />
      </QueryClientProvider>,
    );

    expect(screen.getByText('Helmet · Unknown')).not.toBeNull();
    expect(screen.getByText('Safety Vest · Detected')).not.toBeNull();
    expect(screen.getByText('Gloves · Missing · confirmed')).not.toBeNull();
    expect(screen.queryByText(/Boots ·/i)).toBeNull();
    expect(screen.queryByText(/Goggles ·/i)).toBeNull();
  });

  it('controlled sharedSession: null does not fall back to auth token and disables queries', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={null} />
      </QueryClientProvider>,
    );

    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    expect(selects[0]?.disabled).toBe(true);
  });
});

describe('PpeMonitoringView Scope & Review Lifecycle (RED Suite)', () => {
  let queryClient: QueryClient;

  const mockSessionAlpha: SharedSession = {
    accessToken: 'token-alpha',
    sessionScope: 'scope-alpha',
    user: {
      id: 'user-alpha-1',
      displayName: 'Cán bộ An toàn Alpha',
      roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: 'site-alpha' }],
    },
    onSignOut: vi.fn(),
  };

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    });
    state.preview = mockPreview(mockDetection(7));
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
  });

  it('preserves selectedSiteId for all Safety Alerts CTAs (Live banner, Replay header, and modal) without setting alertId', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={mockSessionAlpha} onNavigate={onNavigate} />
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: /Công trường Alpha/i });

    // 1. Live banner CTA
    const liveCta = screen.getByRole('button', { name: /View in Safety Alerts/i });
    await user.click(liveCta);
    expect(onNavigate).toHaveBeenLastCalledWith('incidents', {
      alertType: 'PPE_VIOLATION',
      siteId: 'site-alpha',
    });
    expect(onNavigate.mock.calls[0]?.[1]?.alertId).toBeUndefined();

    // 2. Modal review CTA
    const reviewAlertBtn = screen.getByRole('button', { name: /Review Alert/i });
    await user.click(reviewAlertBtn);
    const modalCta = screen.getByRole('button', { name: /Review in Safety Alerts/i });
    await user.click(modalCta);
    expect(onNavigate).toHaveBeenLastCalledWith('incidents', {
      alertType: 'PPE_VIOLATION',
      siteId: 'site-alpha',
    });
    expect(onNavigate.mock.calls[1]?.[1]?.alertId).toBeUndefined();

    // 3. Replay banner CTA
    state.preview = null;
    cleanup();
    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={mockSessionAlpha} onNavigate={onNavigate} />
      </QueryClientProvider>,
    );
    await screen.findByRole('option', { name: /Công trường Alpha/i });
    const replayCta = screen.getByRole('button', { name: /View in Safety Alerts/i });
    await user.click(replayCta);
    expect(onNavigate).toHaveBeenLastCalledWith('incidents', {
      alertType: 'PPE_VIOLATION',
      siteId: 'site-alpha',
    });
    expect(onNavigate.mock.calls[2]?.[1]?.alertId).toBeUndefined();
  });

  it('closes and detaches active Violation Review modal when Site selection changes', async () => {
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={mockSessionAlpha} />
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: /Công trường Alpha/i });

    // Mở modal review
    const reviewAlertBtn = screen.getByRole('button', { name: /Review Alert/i });
    await user.click(reviewAlertBtn);
    expect(screen.getByRole('heading', { name: 'Violation Review' })).not.toBeNull();

    // External scope updates must invalidate an open review even though its background is inert.
    fireEvent.change(screen.getByRole('combobox', { name: 'Site', hidden: true }), {
      target: { value: 'site-beta' },
    });

    // Modal review PHẢI tự động đóng để tránh stale review trên site mới
    expect(screen.queryByRole('heading', { name: 'Violation Review' })).toBeNull();
  });

  it('closes and detaches active Violation Review modal when Camera selection changes', async () => {
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={mockSessionAlpha} />
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: /Camera 01/i });

    // Mở modal review
    const reviewAlertBtn = screen.getByRole('button', { name: /Review Alert/i });
    await user.click(reviewAlertBtn);
    expect(screen.getByRole('heading', { name: 'Violation Review' })).not.toBeNull();

    // External camera updates must invalidate an open review even though its background is inert.
    fireEvent.change(screen.getByRole('combobox', { name: 'Camera', hidden: true }), {
      target: { value: 'cam-2' },
    });

    // Modal review PHẢI tự động đóng để tránh hiển thị sai camera
    expect(screen.queryByRole('heading', { name: 'Violation Review' })).toBeNull();
  });

  it('closes active Violation Review modal and evicts old session queries on sessionScope rotation', async () => {
    const user = userEvent.setup();

    const sessionA: SharedSession = {
      accessToken: 'token-A',
      sessionScope: 'scope-session-A',
      user: {
        id: 'user-A',
        displayName: 'User A',
        roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: 'site-alpha' }],
      },
    };

    const sessionB: SharedSession = {
      accessToken: 'token-B',
      sessionScope: 'scope-session-B',
      user: {
        id: 'user-B',
        displayName: 'User B',
        roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: 'site-alpha' }],
      },
    };

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={sessionA} />
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: /Công trường Alpha/i });

    // Mở modal review dưới session A
    const reviewAlertBtn = screen.getByRole('button', { name: /Review Alert/i });
    await user.click(reviewAlertBtn);
    expect(screen.getByRole('heading', { name: 'Violation Review' })).not.toBeNull();

    // Xoay vòng phiên sang session B
    rerender(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={sessionB} />
      </QueryClientProvider>,
    );

    // Modal review của session A phải bị đóng lập tức
    expect(screen.queryByRole('heading', { name: 'Violation Review' })).toBeNull();

    // Kiểm tra cache thực tế bằng dynamic key prefix: các queries của scope-session-A phải bị dọn dẹp
    await waitFor(() => {
      const oldQueries = queryClient.getQueryCache().findAll({
        predicate: (query) => {
          const key = query.queryKey as unknown[];
          return (
            key[0] === 'ppe-monitoring' &&
            key[1] === 'http://localhost:3000' &&
            key[2] === 'scope-session-A'
          );
        },
      });
      expect(oldQueries.length).toBe(0);
    });
  });

  it('same-sessionScope token change closes active review and rotates opaque credential cache key without exposing JWT', async () => {
    const user = userEvent.setup();

    const sessionV1: SharedSession = {
      accessToken: 'token-secret-jwt-1',
      sessionScope: 'scope-same-user',
      user: {
        id: 'user-1',
        displayName: 'User 1',
        roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: 'site-alpha' }],
      },
    };

    const sessionV2: SharedSession = {
      accessToken: 'token-secret-jwt-2',
      sessionScope: 'scope-same-user',
      user: {
        id: 'user-1',
        displayName: 'User 1',
        roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: 'site-alpha' }],
      },
    };

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={sessionV1} />
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: /Công trường Alpha/i });

    // Mở review modal dưới token v1
    const reviewAlertBtn = screen.getByRole('button', { name: /Review Alert/i });
    await user.click(reviewAlertBtn);
    expect(screen.getByRole('heading', { name: 'Violation Review' })).not.toBeNull();

    // Ghi nhận credentialId được cấp phát cho token v1
    const initialQuery = queryClient.getQueryCache().find({
      queryKey: ['ppe-monitoring', 'http://localhost:3000', 'scope-same-user'],
      exact: false,
    });
    const initialCredentialId = (initialQuery?.queryKey as unknown[])?.[3];
    expect(initialCredentialId).toBeDefined();

    // Rerender cùng sessionScope nhưng token v2 (xoay vòng token cùng user)
    rerender(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={sessionV2} />
      </QueryClientProvider>,
    );

    // Modal review PHẢI tự động đóng lập tức (không stale render flash)
    expect(screen.queryByRole('heading', { name: 'Violation Review' })).toBeNull();

    // Assert: tuyệt đối không có token JWT nào bị đưa vào Query Key
    const allQueries = queryClient.getQueryCache().getAll();
    expect(allQueries.length).toBeGreaterThan(0);
    for (const q of allQueries) {
      const serializedKey = JSON.stringify(q.queryKey);
      expect(serializedKey).not.toContain('token-secret-jwt-1');
      expect(serializedKey).not.toContain('token-secret-jwt-2');
    }

    // Query cũ gắn với initialCredentialId của token v1 bị dọn dẹp khỏi cache
    await waitFor(() => {
      const v1Queries = queryClient.getQueryCache().findAll({
        predicate: (query) => {
          const key = query.queryKey as unknown[];
          return (
            key[0] === 'ppe-monitoring' &&
            key[1] === 'http://localhost:3000' &&
            key[2] === 'scope-same-user' &&
            key[3] === initialCredentialId
          );
        },
      });
      expect(v1Queries.length).toBe(0);
    });
  });

  it('API origin change closes active review and shifts metadata query key', async () => {
    const user = userEvent.setup();

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView apiUrl="http://origin-one.local" sharedSession={mockSessionAlpha} />
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: /Công trường Alpha/i });

    // Mở review modal dưới origin-one
    const reviewAlertBtn = screen.getByRole('button', { name: /Review Alert/i });
    await user.click(reviewAlertBtn);
    expect(screen.getByRole('heading', { name: 'Violation Review' })).not.toBeNull();

    // Đổi apiUrl sang origin-two
    rerender(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView apiUrl="http://origin-two.local" sharedSession={mockSessionAlpha} />
      </QueryClientProvider>,
    );

    // Modal review PHẢI lập tức đóng
    expect(screen.queryByRole('heading', { name: 'Violation Review' })).toBeNull();

    // Cache của origin-one phải bị dọn dẹp
    await waitFor(() => {
      const originOneQueries = queryClient.getQueryCache().findAll({
        predicate: (query) => {
          const key = query.queryKey as unknown[];
          return key[0] === 'ppe-monitoring' && key[1] === 'http://origin-one.local';
        },
      });
      expect(originOneQueries.length).toBe(0);
    });
  });

  it('null logout after open review detaches modal and presents fail-closed notice', async () => {
    const user = userEvent.setup();

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={mockSessionAlpha} />
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: /Công trường Alpha/i });

    // Mở modal review khi đang authenticated
    const reviewAlertBtn = screen.getByRole('button', { name: /Review Alert/i });
    await user.click(reviewAlertBtn);
    expect(screen.getByRole('heading', { name: 'Violation Review' })).not.toBeNull();

    // Session chuyển thành null (đăng xuất hoặc phiên hết hạn)
    rerender(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={null} />
      </QueryClientProvider>,
    );

    // Modal review phải bị gỡ bỏ hoàn toàn (zero stale render)
    expect(screen.queryByRole('heading', { name: 'Violation Review' })).toBeNull();

    // Render thông báo Session pending or expired
    expect(await screen.findByText(/Session pending or expired/i)).not.toBeNull();
    expect(screen.queryByRole('button', { name: /Review Alert/i })).toBeNull();
  });

  it('controlled sharedSession null fails closed with session pending or expired notice and hides interactive review', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={null} />
      </QueryClientProvider>,
    );

    // Phải render thông báo phiên hết hạn / chờ xử lý (fail closed)
    expect(await screen.findByText(/Session pending or expired/i)).not.toBeNull();
    // Không cho phép review alert trong phiên null
    expect(screen.queryByRole('button', { name: /Review Alert/i })).toBeNull();
  });

  it('handles mounted logout -> restore transition without React hook order crash or stale review resurrection', async () => {
    const user = userEvent.setup();

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={mockSessionAlpha} />
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: /Công trường Alpha/i });

    // Mở modal review khi phiên đang active
    const reviewAlertBtn = screen.getByRole('button', { name: /Review Alert/i });
    await user.click(reviewAlertBtn);
    expect(screen.getByRole('heading', { name: 'Violation Review' })).not.toBeNull();

    // 1. Chuyển sang logout (sharedSession: null)
    rerender(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={null} />
      </QueryClientProvider>,
    );

    // Không crash, hiển thị session notice, ẩn modal review và các action controls
    expect(await screen.findByText(/Session pending or expired/i)).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'Violation Review' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Review Alert/i })).toBeNull();

    // 2. Chuyển lại restore (sharedSession: mockSessionAlpha)
    rerender(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={mockSessionAlpha} />
      </QueryClientProvider>,
    );

    // Session notice biến mất, không crash hook order, và modal review cũ KHÔNG bị hồi sinh (stale resurrection)
    await screen.findByRole('option', { name: /Công trường Alpha/i });
    expect(screen.queryByText(/Session pending or expired/i)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Violation Review' })).toBeNull();
    expect(screen.getByRole('button', { name: /Review Alert/i })).not.toBeNull();
  });

  it('two concurrent viewers: unmounting one viewer does not evict shared query cache for the other, and gcTime 0 cleans up after both unmount', async () => {
    const listSitesSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'listSites');

    // Mount 2 viewers cùng lúc chia sẻ chung queryClient và session
    const { unmount: unmountViewer1 } = render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={mockSessionAlpha} />
      </QueryClientProvider>,
    );

    const { unmount: unmountViewer2 } = render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={mockSessionAlpha} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(listSitesSpy).toHaveBeenCalled();
    });

    // Xác nhận TanStack signal được truyền vào client.listSites
    expect(listSitesSpy).toHaveBeenCalledWith(
      'token-alpha',
      { offset: 0, limit: 20 },
      expect.objectContaining({ signal: expect.any(Object) }),
    );

    // Unmount viewer 1: không được làm mất query data của viewer 2 đang active
    unmountViewer1();

    // Cache cho session-alpha vẫn phải tồn tại vì viewer 2 vẫn đang mount
    const remainingQueries = queryClient.getQueryCache().findAll({
      predicate: (query) => {
        const key = query.queryKey as unknown[];
        return key[0] === 'ppe-monitoring' && key[2] === 'scope-alpha';
      },
    });
    expect(remainingQueries.length).toBeGreaterThan(0);

    // Unmount nốt viewer 2: khi không còn observer nào, gcTime: 0 sẽ dọn sạch cache
    unmountViewer2();

    await waitFor(() => {
      const activeQueriesAfterBothUnmount = queryClient.getQueryCache().findAll({
        predicate: (query) => {
          const key = query.queryKey as unknown[];
          return key[0] === 'ppe-monitoring' && key[2] === 'scope-alpha';
        },
      });
      expect(activeQueriesAfterBothUnmount.length).toBe(0);
    });
  });
});

describe('formatPpeItemLabel', () => {
  it('formats HARD_HAT and SAFETY_VEST accurately', () => {
    expect(formatPpeItemLabel('HARD_HAT')).toBe('Hard Hat');
    expect(formatPpeItemLabel('SAFETY_VEST')).toBe('Safety Vest');
  });

  it('formats extended PPE items (GLOVES, BOOTS, GOGGLES) without mapping to vest', () => {
    expect(formatPpeItemLabel('GLOVES')).toBe('Gloves');
    expect(formatPpeItemLabel('BOOTS')).toBe('Boots');
    expect(formatPpeItemLabel('GOGGLES')).toBe('Goggles');
  });

  it('falls back to PPE for undefined or unrecognised item', () => {
    expect(formatPpeItemLabel(undefined)).toBe('PPE');
  });
});

describe('PpeMonitoringView 401 Session Expiration & Factual Source Labels', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
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
  });

  it('renders factual source label SOURCE: LIVE during live preview', () => {
    state.preview = mockPreview(mockDetection(7));
    state.status = 'LIVE';
    state.sourceKind = 'LIVE';

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView />
      </QueryClientProvider>,
    );

    const sourceBadge = screen.getByTestId('factual-source-label');
    expect(sourceBadge).not.toBeNull();
    expect(sourceBadge.textContent).toContain('SOURCE: LIVE');
  });

  it('renders factual source label SOURCE: REPLAY during recorded video replay', () => {
    state.preview = mockPreview(mockDetection(7));
    state.status = 'REPLAY';
    state.sourceKind = 'REPLAY';

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView />
      </QueryClientProvider>,
    );

    const sourceBadge = screen.getByTestId('factual-source-label');
    expect(sourceBadge).not.toBeNull();
    expect(sourceBadge.textContent).toContain('SOURCE: REPLAY');
  });

  it('renders experimental 5 observations header and clarifies zero detections do not certify safety clearance', () => {
    state.preview = mockPreview();
    state.preview.frame.detections = [];

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView />
      </QueryClientProvider>,
    );

    expect(screen.getByText('EXPERIMENTAL (5 ITEMS)')).not.toBeNull();
    expect(
      screen.getByText(
        /Experimental 5 AI observations \(Helmet, Vest, Gloves, Boots, Goggles\): unsupported items remain Unknown/i,
      ),
    ).not.toBeNull();
    expect(
      screen.getAllByText(/Zero detections do not certify safety clearance/i).length,
    ).toBeGreaterThan(0);
  });

  it('CURRENT 401 via scopedPreview.errorStatus triggers triggerSessionExpired with sessionScope', async () => {
    state.errorStatus = 401;
    const triggerSessionExpired = vi.fn();
    const activeScope = 'test-active-session-scope';
    const activeToken = 'test-token-401';

    render(
      <AuthContext.Provider
        value={{
          accessToken: activeToken,
          sessionScope: activeScope,
          isSessionExpired: false,
          triggerSessionExpired,
          dismissSessionExpired: vi.fn(),
          setAccessToken: vi.fn(),
        }}
      >
        <QueryClientProvider client={queryClient}>
          <PpeMonitoringView apiUrl="http://localhost:3000" />
        </QueryClientProvider>
      </AuthContext.Provider>,
    );

    await waitFor(() => {
      expect(triggerSessionExpired).toHaveBeenCalledTimes(1);
      expect(triggerSessionExpired).toHaveBeenCalledWith(activeScope);
    });
  });

  it('CURRENT 403 Forbidden via scopedPreview.errorStatus does NOT trigger session expired or logout', async () => {
    state.errorStatus = 403;
    const triggerSessionExpired = vi.fn();
    const activeScope = 'test-active-session-scope';
    const activeToken = 'test-token-403';

    render(
      <AuthContext.Provider
        value={{
          accessToken: activeToken,
          sessionScope: activeScope,
          isSessionExpired: false,
          triggerSessionExpired,
          dismissSessionExpired: vi.fn(),
          setAccessToken: vi.fn(),
        }}
      >
        <QueryClientProvider client={queryClient}>
          <PpeMonitoringView apiUrl="http://localhost:3000" />
        </QueryClientProvider>
      </AuthContext.Provider>,
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(triggerSessionExpired).not.toHaveBeenCalled();
  });

  it('direct 401 on sitesQuery triggers triggerSessionExpired with sessionScope', async () => {
    const triggerSessionExpired = vi.fn();
    const activeScope = 'test-active-session-scope';
    const activeToken = 'test-token-sites-401';

    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockRejectedValue(
      new ApiError('http', 'Session expired', 401, undefined),
    );

    render(
      <AuthContext.Provider
        value={{
          accessToken: activeToken,
          sessionScope: activeScope,
          isSessionExpired: false,
          triggerSessionExpired,
          dismissSessionExpired: vi.fn(),
          setAccessToken: vi.fn(),
        }}
      >
        <QueryClientProvider client={queryClient}>
          <PpeMonitoringView apiUrl="http://localhost:3000" />
        </QueryClientProvider>
      </AuthContext.Provider>,
    );

    await waitFor(() => {
      expect(triggerSessionExpired).toHaveBeenCalledTimes(1);
      expect(triggerSessionExpired).toHaveBeenCalledWith(activeScope);
    });
  });

  it('direct 403 on sitesQuery does NOT trigger session expired or logout', async () => {
    const triggerSessionExpired = vi.fn();
    const activeScope = 'test-active-session-scope';
    const activeToken = 'test-token-sites-403';

    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockRejectedValue(
      new ApiError('http', 'Forbidden site access', 403, undefined),
    );

    render(
      <AuthContext.Provider
        value={{
          accessToken: activeToken,
          sessionScope: activeScope,
          isSessionExpired: false,
          triggerSessionExpired,
          dismissSessionExpired: vi.fn(),
          setAccessToken: vi.fn(),
        }}
      >
        <QueryClientProvider client={queryClient}>
          <PpeMonitoringView apiUrl="http://localhost:3000" />
        </QueryClientProvider>
      </AuthContext.Provider>,
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(triggerSessionExpired).not.toHaveBeenCalled();
  });
});

describe('PpeMonitoringView MF05 Demo Control Panel Integration', () => {
  let queryClient: QueryClient;

  const adminSession: SharedSession = {
    accessToken: 'token-admin-mf05',
    sessionScope: 'scope-admin-mf05',
    user: {
      id: 'admin-1',
      displayName: 'Global Admin',
      roleAssignments: [{ role: 'ADMIN', siteId: null }],
    },
  };

  const nonAdminSession: SharedSession = {
    accessToken: 'token-officer-mf05',
    sessionScope: 'scope-officer-mf05',
    user: {
      id: 'officer-1',
      displayName: 'Safety Officer',
      roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: 'site-alpha' }],
    },
  };

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    });
    state.preview = mockPreview(mockDetection(7));
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue(mockSitesList);
    vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockResolvedValue(
      mockCamerasList,
    );
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    state.preview = null;
    state.status = null;
    state.sourceKind = null;
    state.retry.mockClear();
    demoPanelState.rendered = false;
    demoPanelState.props = null;
  });

  it('does NOT render Mf05DemoControlPanel when VITE_MF05_DEMO_CONTROLS is undefined or false', async () => {
    vi.stubEnv('VITE_MF05_DEMO_CONTROLS', 'false');

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={adminSession} />
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: /Công trường Alpha/i });
    expect(demoPanelState.rendered).toBe(false);
    expect(screen.queryByTestId('mf05-demo-control-panel')).toBeNull();
  });

  it('renders Mf05DemoControlPanel when VITE_MF05_DEMO_CONTROLS is true with correct props and admin privilege', async () => {
    vi.stubEnv('VITE_MF05_DEMO_CONTROLS', 'true');

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={adminSession} />
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: /Công trường Alpha/i });

    await waitFor(() => expect(demoPanelState.rendered).toBe(true));
    expect(demoPanelState.props).not.toBeNull();
    expect(demoPanelState.props?.siteId).toBe('site-alpha');
    expect(demoPanelState.props?.cameraId).toBe('cam-1');
    expect(demoPanelState.props?.token).toBe('token-admin-mf05');
    expect(demoPanelState.props?.sessionScope).toBe('scope-admin-mf05');
    expect(demoPanelState.props?.canApply).toBe(true);

    const applyButton = await screen.findByRole('button', { name: /Apply Saved Region/i });
    expect(applyButton).not.toBeNull();
    expect((applyButton as HTMLButtonElement).disabled).toBe(false);
  });

  it('disables apply button when user is not a global admin (canApply: false)', async () => {
    vi.stubEnv('VITE_MF05_DEMO_CONTROLS', 'true');

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={nonAdminSession} />
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: /Công trường Alpha/i });
    await waitFor(() => expect(demoPanelState.rendered).toBe(true));
    expect(demoPanelState.props?.canApply).toBe(false);

    const applyButton = await screen.findByRole('button', { name: /Apply Saved Region/i });
    expect((applyButton as HTMLButtonElement).disabled).toBe(true);
  });

  it('hides camera preview, displays "Applying Demo Region..." while APPLYING, and retries preview on completion', async () => {
    const user = userEvent.setup();
    vi.stubEnv('VITE_MF05_DEMO_CONTROLS', 'true');

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={adminSession} />
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: /Công trường Alpha/i });
    expect(screen.queryByText(/Applying Demo Region\.\.\./i)).toBeNull();

    // Trigger Apply action
    const applyButton = await screen.findByRole('button', { name: /Apply Saved Region/i });
    await user.click(applyButton);

    // During mutation pending (applying), preview must be hidden and applying indicator displayed
    await waitFor(() => {
      expect(screen.getByText('Applying Demo Region...')).not.toBeNull();
      expect(
        screen.getByText('Awaiting fresh camera snapshot after region reconfiguration.'),
      ).not.toBeNull();
    });

    // Complete the mutation
    const finishButton = screen.getByRole('button', { name: /Finish Apply/i });
    await user.click(finishButton);

    // Once finished, applying indicator clears and scopedPreview.retry() is called
    await waitFor(() => {
      expect(screen.queryByText('Applying Demo Region...')).toBeNull();
      expect(state.retry).toHaveBeenCalled();
    });
  });

  it('isolates applying state to CURRENT camera scope, preventing cross-scope state flash when changing cameras', async () => {
    const user = userEvent.setup();
    vi.stubEnv('VITE_MF05_DEMO_CONTROLS', 'true');

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={adminSession} />
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: /Công trường Alpha/i });

    // Trigger apply on cam-1
    const applyButton = await screen.findByRole('button', { name: /Apply Saved Region/i });
    await user.click(applyButton);

    await waitFor(() => {
      expect(screen.getByText('Applying Demo Region...')).not.toBeNull();
    });

    // User switches camera to cam-2 (camera select is index 1 among comboboxes)
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    await user.selectOptions(selects[1]!, 'cam-2');

    // The applying indicator must disappear immediately for cam-2 (no cross-scope flash)
    await waitFor(() => {
      expect(screen.queryByText('Applying Demo Region...')).toBeNull();
    });
  });
});

describe('PpeMonitoringView Live Raw Video vs AI Evidence Presentation Mode', () => {
  let queryClient: QueryClient;

  const testPresentationSession: SharedSession = {
    accessToken: 'token-presentation',
    sessionScope: 'scope-presentation',
    user: {
      id: 'user-presentation-1',
      displayName: 'Operator Presentation',
      roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: 'site-alpha' }],
    },
    onSignOut: vi.fn(),
  };

  const mockPresentationCameras: Page<CameraResponse> = {
    items: [
      {
        id: 'cam-live-1',
        siteId: 'site-alpha',
        externalId: 'tapo-core5-live',
        code: 'TAPO-01',
        name: 'Tapo Live Camera',
        status: 'ACTIVE',
        configurationVersion: 1,
        createdAt: '2026-09-30T00:00:00Z',
      },
      {
        id: 'cam-replay-1',
        siteId: 'site-alpha',
        externalId: 'core5-recorded-demo',
        code: 'REPLAY-01',
        name: 'Recorded Replay Demo',
        status: 'ACTIVE',
        configurationVersion: 1,
        createdAt: '2026-09-30T00:00:00Z',
      },
      {
        id: 'cam-replay-generic',
        siteId: 'site-alpha',
        externalId: 'generic-replay-feed',
        code: 'GEN-01',
        name: 'Generic Replay Camera',
        status: 'ACTIVE',
        configurationVersion: 1,
        createdAt: '2026-09-30T00:00:00Z',
      },
    ],
    total: 3,
  };

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      clearRect: vi.fn(),
      measureText: (text: string) => ({ width: text.length * 7 }),
      save: vi.fn(),
      restore: vi.fn(),
      strokeRect: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue(mockSitesList);
    vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockResolvedValue(
      mockPresentationCameras,
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

  it('renders Live video (Raw) and AI evidence (Boxes) buttons for LIVE camera with raw default ON', async () => {
    state.preview = mockPreview(mockDetection(7));
    state.status = 'LIVE';
    state.sourceKind = 'LIVE';

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={testPresentationSession} />
      </QueryClientProvider>,
    );

    const rawButton = await screen.findByTestId('mode-toggle-live-raw');
    const aiButton = await screen.findByTestId('mode-toggle-ai-analyzed');

    expect(rawButton).not.toBeNull();
    expect(aiButton).not.toBeNull();
    expect(rawButton.getAttribute('aria-pressed')).toBe('true');
    expect(aiButton.getAttribute('aria-pressed')).toBe('false');
  });

  it('allows user to switch between Raw Live stream and AI Evidence with boxes', async () => {
    const user = userEvent.setup();
    state.preview = mockPreview(mockDetection(7));
    state.status = 'LIVE';
    state.sourceKind = 'LIVE';

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={testPresentationSession} />
      </QueryClientProvider>,
    );

    const rawButton = await screen.findByTestId('mode-toggle-live-raw');
    const aiButton = await screen.findByTestId('mode-toggle-ai-analyzed');

    // Click AI evidence
    await user.click(aiButton);
    expect(aiButton.getAttribute('aria-pressed')).toBe('true');
    expect(rawButton.getAttribute('aria-pressed')).toBe('false');

    // Click back to Live video
    await user.click(rawButton);
    expect(rawButton.getAttribute('aria-pressed')).toBe('true');
    expect(aiButton.getAttribute('aria-pressed')).toBe('false');
  });

  it('shows REPLAY · AI evidence only for unsupported REPLAY cameras without raw toggle', async () => {
    const user = userEvent.setup();
    state.preview = mockPreview(mockDetection(7));
    state.status = 'REPLAY';
    state.sourceKind = 'REPLAY';

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={testPresentationSession} />
      </QueryClientProvider>,
    );

    // Camera selector is combobox at index 1
    await screen.findByRole('option', { name: /Generic Replay Camera/i });
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    await user.selectOptions(selects[1]!, 'cam-replay-generic');

    expect(screen.queryByTestId('mode-toggle-live-raw')).toBeNull();
    expect(screen.queryByTestId('mode-toggle-recorded-raw')).toBeNull();
    expect(screen.getByText('REPLAY · AI evidence only')).not.toBeNull();
  });

  it('renders Recorded video (Raw) controls and native video element for recorded demo cameras', async () => {
    const user = userEvent.setup();
    state.preview = mockPreview(mockDetection(7));
    state.status = 'REPLAY';
    state.sourceKind = 'REPLAY';
    recordedVideoState.videoUrl = 'blob:http://localhost:3000/mock-recorded-video.mp4';
    recordedVideoState.status = 'READY';

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={testPresentationSession} />
      </QueryClientProvider>,
    );

    // Select recorded demo camera
    await screen.findByRole('option', { name: /Recorded Replay Demo/i });
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    await user.selectOptions(selects[1]!, 'cam-replay-1');

    // Default mode is recorded-raw
    const recButton = await screen.findByTestId('mode-toggle-recorded-raw');
    const aiButton = await screen.findByTestId('mode-toggle-ai-analyzed');

    expect(recButton).not.toBeNull();
    expect(aiButton).not.toBeNull();
    expect(recButton.getAttribute('aria-pressed')).toBe('true');
    expect(aiButton.getAttribute('aria-pressed')).toBe('false');

    // Native video element rendered with muted, loop, playsInline, controls
    const video = (await screen.findByTestId('raw-recorded-video-element')) as HTMLVideoElement;
    expect(video).not.toBeNull();
    expect(video.src).toContain('mock-recorded-video.mp4');
    expect(video.hasAttribute('controls')).toBe(true);
    expect(video.autoplay).toBe(true);
    expect(video.loop).toBe(true);

    // Source label reflects REPLAY
    expect(screen.getByTestId('factual-source-label').textContent).toBe('SOURCE: REPLAY');

    // Toolbar cadence label explicitly notes source-independent playback not synced to AI
    expect(
      screen.getByText('Recorded raw MP4 · Source-independent playback (not synced to AI)'),
    ).not.toBeNull();

    // AI panel header displays unanalyzed badge
    expect(screen.getByTestId('recorded-feed-unanalyzed-badge').textContent).toBe(
      'RECORDED RAW · NOT SYNCED TO AI',
    );
  });

  it('allows user to switch between Recorded video (Raw) and AI evidence mode for recorded cameras', async () => {
    const user = userEvent.setup();
    state.preview = mockPreview(mockDetection(7));
    state.status = 'REPLAY';
    state.sourceKind = 'REPLAY';
    recordedVideoState.videoUrl = 'blob:http://localhost:3000/mock-recorded-video.mp4';
    recordedVideoState.status = 'READY';

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={testPresentationSession} />
      </QueryClientProvider>,
    );

    // Select recorded demo camera
    await screen.findByRole('option', { name: /Recorded Replay Demo/i });
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    await user.selectOptions(selects[1]!, 'cam-replay-1');

    const recButton = await screen.findByTestId('mode-toggle-recorded-raw');
    const aiButton = await screen.findByTestId('mode-toggle-ai-analyzed');

    // Click AI evidence
    await user.click(aiButton);
    expect(aiButton.getAttribute('aria-pressed')).toBe('true');
    expect(recButton.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText('AI snapshot polling: 500ms')).not.toBeNull();

    // In AI mode, native video element is not shown
    expect(screen.queryByTestId('raw-recorded-video-element')).toBeNull();

    // Click back to Recorded video
    await user.click(recButton);
    expect(recButton.getAttribute('aria-pressed')).toBe('true');
    expect(aiButton.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('raw-recorded-video-element')).not.toBeNull();
  });

  it.each([
    { status: 403, message: 'You do not have permission to view this camera.', blocked: true },
    {
      status: 429,
      message:
        'Too many requests. The stream will reconnect automatically after the server waiting period.',
      blocked: true,
    },
    {
      status: 503,
      message: 'The camera source is offline. Check its connection or try again.',
      blocked: false,
    },
  ])(
    'shows actionable raw camera feedback for HTTP $status',
    async ({ status, message, blocked }) => {
      mediaState.status = status === 403 ? 'HALTED' : 'UNAVAILABLE';
      mediaState.errorStatus = status;
      mediaState.error = 'Technical stream error';
      render(
        <QueryClientProvider client={queryClient}>
          <PpeMonitoringView sharedSession={testPresentationSession} />
        </QueryClientProvider>,
      );
      await screen.findByTestId('mode-toggle-live-raw');
      expect(await screen.findByText(message)).not.toBeNull();
      const retry = screen.getByRole('button', { name: 'Retry Stream' }) as HTMLButtonElement;
      expect(retry.disabled).toBe(blocked);
      mediaState.retry.mockClear();
      await userEvent.setup().click(retry);
      expect(mediaState.retry).toHaveBeenCalledTimes(blocked ? 0 : 1);
    },
  );

  it('explains recorded camera access denial and disables retry', async () => {
    recordedVideoState.status = 'HALTED';
    recordedVideoState.errorStatus = 403;
    recordedVideoState.error = 'Technical video access error';
    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={testPresentationSession} />
      </QueryClientProvider>,
    );
    await screen.findByRole('option', { name: /Recorded Replay Demo/i });
    await userEvent
      .setup()
      .selectOptions(screen.getByRole('combobox', { name: 'Camera' }), 'cam-replay-1');
    expect(
      await screen.findByText('You do not have permission to view this recorded video.'),
    ).not.toBeNull();
    const retry = screen.getByRole('button', { name: 'Retry Video' }) as HTMLButtonElement;
    expect(retry.disabled).toBe(true);
    recordedVideoState.retry.mockClear();
    await userEvent.setup().click(retry);
    expect(recordedVideoState.retry).not.toHaveBeenCalled();
  });

  it('shows SOURCE: LIVE and LIVE status pill when live-raw is active even while AI preview snapshot is unavailable, with AI panel explicitly marked unavailable separately', async () => {
    state.preview = null;
    state.status = 'UNAVAILABLE';
    mediaState.status = 'LIVE';
    mediaState.image = { naturalWidth: 640, naturalHeight: 480 } as HTMLImageElement;
    mediaState.frame = {
      type: 'media-frame',
      mediaVersion: 1,
      cameraExternalId: 'tapo-core5-live',
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      sequenceNumber: '1042',
      capturedAt: '2026-10-08T12:00:00.000Z',
      width: 640,
      height: 480,
      imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
    };

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={testPresentationSession} />
      </QueryClientProvider>,
    );

    await screen.findByTestId('mode-toggle-live-raw');

    // Source badge reflects actual raw media status (LIVE), NOT the missing AI snapshot
    const sourceLabel = screen.getByTestId('factual-source-label');
    expect(sourceLabel.textContent).toBe('SOURCE: LIVE');

    // Status pill reflects LIVE
    expect(screen.getByText(/LIVE -/i)).not.toBeNull();

    // Raw camera media canvas is rendered
    expect(screen.getByTestId('raw-camera-media-canvas')).not.toBeNull();

    // AI panel explicitly indicates AI snapshot evidence is unavailable separately
    expect(screen.getByTestId('raw-feed-unanalyzed-badge').textContent).toBe('RAW VIEW UNANALYZED');
    expect(screen.getByTestId('ai-evidence-badge').textContent).toBe('AI EVIDENCE UNAVAILABLE');
    expect(screen.getByTestId('ai-snapshot-unavailable-msg')).not.toBeNull();
    expect(screen.getByText('AI snapshot unavailable')).not.toBeNull();

    // Cadence label truthfully states raw source independent capped 8 frames/s and AI snapshot polling 500ms
    expect(
      screen.getByText('Raw source independent (capped 8 frames/s) · AI snapshot polling: 500ms'),
    ).not.toBeNull();
  });

  it('shows SOURCE: STALLED distinctly when raw stream stalls', async () => {
    state.preview = null;
    state.status = 'UNAVAILABLE';
    mediaState.status = 'STALLED';
    mediaState.image = null;
    mediaState.frame = null;

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={testPresentationSession} />
      </QueryClientProvider>,
    );

    await screen.findByTestId('mode-toggle-live-raw');

    // Source badge reflects distinct STALLED state
    const sourceLabel = screen.getByTestId('factual-source-label');
    expect(sourceLabel.textContent).toBe('SOURCE: STALLED');
    expect(screen.getByText('Raw Live Stream Stalled')).not.toBeNull();
    expect(screen.getByText('Raw Live Stream Stalled')).not.toBeNull();
  });

  it('uses AI snapshot statuses when in AI evidence mode', async () => {
    const user = userEvent.setup();
    state.preview = mockPreview(mockDetection(7));
    state.status = 'LIVE';
    state.sourceKind = 'LIVE';
    mediaState.status = 'LIVE';

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={testPresentationSession} />
      </QueryClientProvider>,
    );

    // Switch to AI evidence mode
    const aiButton = await screen.findByTestId('mode-toggle-ai-analyzed');
    await user.click(aiButton);

    // In AI mode, source badge uses AI snapshot status (LIVE)
    const sourceLabel = screen.getByTestId('factual-source-label');
    expect(sourceLabel.textContent).toBe('SOURCE: LIVE');
    expect(screen.getByText('AI snapshot polling: 500ms')).not.toBeNull();

    // Switch to replay camera
    const selects = screen.getAllByRole('combobox') as HTMLSelectElement[];
    await user.selectOptions(selects[1]!, 'cam-replay-1');
    state.status = 'REPLAY';
    state.sourceKind = 'REPLAY';

    expect(screen.getByTestId('factual-source-label').textContent).toBe('SOURCE: REPLAY');
  });
});

describe('PpeMonitoringView Paused Mode (VITE_AI_WORK_PAUSED=true)', () => {
  let queryClient: QueryClient;

  const adminSession: SharedSession = {
    accessToken: 'token-admin-paused',
    sessionScope: 'scope-admin-paused',
    user: {
      id: 'admin-paused-1',
      displayName: 'Global Admin Paused',
      roleAssignments: [
        { role: 'ADMIN', siteId: null },
        { role: 'SITE_MANAGER', siteId: 'site-alpha' },
        { role: 'SITE_MANAGER', siteId: 'site-beta' },
      ],
    },
  };

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    state.preview = mockPreview(mockDetection(7));
    state.status = 'LIVE';
    state.sourceKind = 'LIVE';
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue(mockSitesList);
    vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockResolvedValue(
      mockCamerasList,
    );
    vi.spyOn(SmartSiteManagementClient.prototype, 'listZones').mockResolvedValue({
      items: [],
      total: 0,
    });
    vi.stubEnv('VITE_AI_WORK_PAUSED', 'true');
    vi.stubEnv('VITE_MF05_DEMO_CONTROLS', 'true');
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    state.preview = null;
    state.status = null;
    state.sourceKind = null;
    demoPanelState.rendered = false;
    demoPanelState.props = null;
    hookOptionsState.previewOptions = null;
    hookOptionsState.mediaOptions = null;
    hookOptionsState.recordedVideoOptions = null;
  });

  it('renders operational banner and shows "AI Work Paused" instead of "Live Monitored" in header', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={adminSession} />
      </QueryClientProvider>,
    );

    // Banner is rendered with clear operational directive
    const banner = await screen.findByTestId('ai-work-paused-banner');
    expect(banner).not.toBeNull();
    expect(banner.textContent).toContain('AI Work Paused by Human Operator');
    expect(banner.textContent).toContain(
      'Zone and region configuration remains active and can be saved',
    );

    // Status header never shows "Live Monitored" even though preview is LIVE
    expect(screen.queryByText('Live Monitored')).toBeNull();
    expect(screen.getByText('AI Work Paused')).not.toBeNull();
    expect(screen.queryByText('Live AI Observations Active')).toBeNull();
    expect(screen.getByTestId('toggle-diagnostics-drawer').getAttribute('aria-expanded')).toBe(
      'false',
    );
    expect(
      screen.queryByRole('button', {
        name: /Retry Snapshot|Retry Stream|Retry Video|Reconnect Stream/i,
      }),
    ).toBeNull();
    expect(screen.queryByText('Missing Hard Hat')).toBeNull();
  });

  it('disables MF05 demo Apply action even for Global Admin, while keeping Zone PPE setup enabled to save', async () => {
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={adminSession} />
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: /Công trường Alpha/i });

    // MF05 Demo Control Panel is rendered, but canApply is disabled due to AI work paused
    await user.click(screen.getByTestId('toggle-diagnostics-drawer'));
    await waitFor(() => expect(demoPanelState.rendered).toBe(true));
    expect(demoPanelState.props?.canApply).toBe(false);

    const applyButton = await screen.findByRole('button', { name: /Apply Saved Region/i });
    expect((applyButton as HTMLButtonElement).disabled).toBe(true);

    // Global Admin can still open Zone PPE setup and save configuration
    const zoneConfigBtn = screen.getByRole('button', { name: /Configure PPE by Zone/i });
    expect(zoneConfigBtn).not.toBeNull();
    expect((zoneConfigBtn as HTMLButtonElement).disabled).toBe(false);

    await user.click(zoneConfigBtn);

    // Zone setup panel opens and save button is accessible
    const saveZoneBtn = await screen.findByRole('button', { name: /Save Zone PPE/i });
    expect(saveZoneBtn).not.toBeNull();
    expect((saveZoneBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('disables AI preview polling, live media, recorded media, and wall polling hooks while configuration queries remain accessible', async () => {
    const listSitesSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listSites')
      .mockResolvedValue(mockSitesList);
    const listCamerasSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras')
      .mockResolvedValue(mockCamerasList);

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={adminSession} />
      </QueryClientProvider>,
    );

    // Configuration / metadata queries remain active and resolve
    await screen.findByRole('option', { name: /Công trường Alpha/i });
    expect(listSitesSpy).toHaveBeenCalled();
    expect(listCamerasSpy).toHaveBeenCalled();

    // AI and media hooks are strictly disabled (enabled: false)
    expect(hookOptionsState.previewOptions?.enabled).toBe(false);
    expect(hookOptionsState.mediaOptions?.enabled).toBe(false);
    expect(hookOptionsState.recordedVideoOptions?.enabled).toBe(false);
  });
});

describe('PpeMonitoringView Single-Runtime i18n Language Switching', () => {
  let queryClient: QueryClient;

  const adminSession: SharedSession = {
    accessToken: 'token-admin-i18n',
    sessionScope: 'scope-admin-i18n',
    user: {
      id: 'admin-i18n-1',
      displayName: 'Global Admin i18n',
      roleAssignments: [
        { role: 'ADMIN', siteId: null },
        { role: 'SITE_MANAGER', siteId: 'site-alpha' },
        { role: 'SITE_MANAGER', siteId: 'site-beta' },
      ],
    },
  };

  const mockCamerasWithBeta: Page<CameraResponse> = {
    items: [
      ...mockCamerasList.items,
      {
        id: 'cam-beta-1',
        siteId: 'site-beta',
        externalId: 'CAM-B1',
        code: 'CAM-B1',
        name: 'Camera Beta 01',
        status: 'ACTIVE',
        configurationVersion: 1,
        createdAt: '2026-09-30T00:00:00Z',
      },
      {
        id: 'cam-beta-2',
        siteId: 'site-beta',
        externalId: 'CAM-B2',
        code: 'CAM-B2',
        name: 'Camera Beta 02',
        status: 'ACTIVE',
        configurationVersion: 2,
        createdAt: '2026-09-30T00:00:00Z',
      },
    ],
    total: 4,
  };

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    window.localStorage.clear();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    state.preview = mockPreview(mockDetection(7));
    state.status = 'LIVE';
    state.sourceKind = 'LIVE';
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue(mockSitesList);
    vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockImplementation(
      async (_token, siteId) => ({
        items: mockCamerasWithBeta.items.filter((c) => c.siteId === siteId),
        total: mockCamerasWithBeta.items.filter((c) => c.siteId === siteId).length,
      }),
    );
    vi.spyOn(SmartSiteManagementClient.prototype, 'listZones').mockResolvedValue({
      items: [],
      total: 0,
    });
  });

  afterEach(async () => {
    cleanup();
    queryClient.clear();
    await i18n.changeLanguage('en');
    window.localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    state.preview = null;
    state.status = null;
    state.sourceKind = null;
    demoPanelState.rendered = false;
    demoPanelState.props = null;
    hookOptionsState.previewOptions = null;
    hookOptionsState.mediaOptions = null;
    hookOptionsState.recordedVideoOptions = null;
  });

  it('switching language (en -> vi -> en) preserves selected Site, camera, Zone PPE setup draft state, and deep-link navigation', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={adminSession} onNavigate={onNavigate} />
      </QueryClientProvider>,
    );

    await screen.findByRole('option', { name: /Công trường Beta/i });

    // Select Site Beta and Camera Beta 02
    const siteSelect = screen.getByRole('combobox', { name: 'Site' }) as HTMLSelectElement;
    await user.selectOptions(siteSelect, 'site-beta');

    await screen.findByRole('option', { name: /Camera Beta 02/i });
    const cameraSelect = screen.getByRole('combobox', { name: 'Camera' }) as HTMLSelectElement;
    await user.selectOptions(cameraSelect, 'cam-beta-2');

    expect(siteSelect.value).toBe('site-beta');
    expect(cameraSelect.value).toBe('cam-beta-2');

    // Open Zone PPE setup dialog and populate unsaved policy draft fields
    const configureZoneBtn = screen.getByRole('button', { name: /Configure PPE by Zone/i });
    await user.click(configureZoneBtn);

    const codeInput = (await screen.findByLabelText(/Zone Code/i)) as HTMLInputElement;
    const nameInput = screen.getByLabelText(/Zone Name/i) as HTMLInputElement;
    const glovesCheckbox = document.getElementById('ppe-item-gloves') as HTMLInputElement;

    await user.type(codeInput, 'ZONE-B2');
    await user.type(nameInput, 'Khu vực Cẩu Tháp B2');
    await user.click(glovesCheckbox);

    expect(codeInput.value).toBe('ZONE-B2');
    expect(nameInput.value).toBe('Khu vực Cẩu Tháp B2');
    expect(glovesCheckbox.checked).toBe(true);

    // Switch shared single-runtime i18n engine to Vietnamese
    await act(async () => {
      await i18n.changeLanguage('vi');
    });

    // Visible captions retranslate to Vietnamese
    expect(screen.getByRole('button', { name: /Lưu PPE khu vực/i })).not.toBeNull();
    expect(screen.getByText('KIỂM TRA BẢO HỘ (PPE)')).not.toBeNull();

    // Selected Site, Camera, open dialog, and unsaved draft state are preserved
    expect((screen.getByLabelText('Công trường') as HTMLSelectElement).value).toBe('site-beta');
    expect((screen.getByLabelText('Camera') as HTMLSelectElement).value).toBe('cam-beta-2');
    expect((document.getElementById('zone-code') as HTMLInputElement).value).toBe('ZONE-B2');
    expect((document.getElementById('zone-name') as HTMLInputElement).value).toBe(
      'Khu vực Cẩu Tháp B2',
    );
    expect((document.getElementById('ppe-item-gloves') as HTMLInputElement).checked).toBe(true);

    // Close dialog to trigger deep-link CTA in Vietnamese and verify raw machine enum & siteId
    const closeDialogBtn = screen.getByRole('button', { name: 'Đóng hộp thoại' });
    await user.click(closeDialogBtn);
    // The dirty-draft guard requires an explicit discard before leaving configuration.
    await user.click(screen.getByRole('button', { name: 'Hủy thay đổi' }));

    const alertsNavBtnVi = screen.getByRole('button', { name: /Xem trong Cảnh báo An toàn/i });
    await user.click(alertsNavBtnVi);
    expect(onNavigate).toHaveBeenCalledWith('incidents', {
      alertType: 'PPE_VIOLATION',
      siteId: 'site-beta',
    });

    // Switch back to English and verify English captions restore with selections intact
    await act(async () => {
      await i18n.changeLanguage('en');
    });

    expect(screen.getByText('PPE CHECK')).not.toBeNull();
    expect((screen.getByRole('combobox', { name: 'Site' }) as HTMLSelectElement).value).toBe(
      'site-beta',
    );
    expect((screen.getByRole('combobox', { name: 'Camera' }) as HTMLSelectElement).value).toBe(
      'cam-beta-2',
    );
  });

  it('paused mode (VITE_AI_WORK_PAUSED=true) across language switches retranslates paused notices while keeping preview/media polling disabled and MF05 Apply disabled', async () => {
    const user = userEvent.setup();
    vi.stubEnv('VITE_AI_WORK_PAUSED', 'true');
    vi.stubEnv('VITE_MF05_DEMO_CONTROLS', 'true');

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={adminSession} />
      </QueryClientProvider>,
    );

    const banner = await screen.findByTestId('ai-work-paused-banner');
    expect(banner.textContent).toContain('AI Work Paused by Human Operator');
    expect(screen.getByText('AI Work Paused')).not.toBeNull();

    // Open diagnostics drawer in English
    await user.click(screen.getByTestId('toggle-diagnostics-drawer'));
    await waitFor(() => expect(demoPanelState.rendered).toBe(true));
    expect(demoPanelState.props?.canApply).toBe(false);
    expect(hookOptionsState.previewOptions?.enabled).toBe(false);
    expect(hookOptionsState.mediaOptions?.enabled).toBe(false);
    expect(hookOptionsState.recordedVideoOptions?.enabled).toBe(false);

    // Switch to Vietnamese
    await act(async () => {
      await i18n.changeLanguage('vi');
    });

    expect(screen.getByTestId('ai-work-paused-banner').textContent).toContain(
      'Tác vụ AI đang tạm dừng theo lệnh vận hành',
    );
    expect(screen.getByText('Tạm dừng xử lý AI')).not.toBeNull();

    // Paused guards remain strictly enforced after language switch
    expect(demoPanelState.props?.canApply).toBe(false);
    expect(hookOptionsState.previewOptions?.enabled).toBe(false);
    expect(hookOptionsState.mediaOptions?.enabled).toBe(false);
    expect(hookOptionsState.recordedVideoOptions?.enabled).toBe(false);
    expect(screen.queryByTestId('raw-camera-media-canvas')).toBeNull();
  });

  it('preserves distinct current UNKNOWN vs explicit confirmedMissingItems episode warning across language switches without turning UNKNOWN into current-frame MISSING', async () => {
    state.preview = mockPreview({
      ...mockDetection(7),
      active: true,
      alertState: 'CONFIRMED',
      ppeStatus: {
        HARD_HAT: 'UNKNOWN',
        SAFETY_VEST: 'PRESENT',
      },
      confirmedMissingItems: ['HARD_HAT'],
    });

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView sharedSession={adminSession} />
      </QueryClientProvider>,
    );

    // In English: current frame is Unknown, while confirmed episode warning is shown separately
    expect(screen.getByText('Helmet · Unknown')).not.toBeNull();
    expect(screen.queryByText('Helmet · Missing · confirmed')).toBeNull();

    const episodeWarningEn = screen.getByTestId('confirmed-episode-warning-7-HARD_HAT');
    expect(episodeWarningEn.textContent).toContain('Active confirmed episode: Missing · confirmed');
    expect(episodeWarningEn.textContent).toContain('Current snapshot: Unknown');
    expect(episodeWarningEn.textContent).toContain(
      'Unknown means insufficient current evidence and does not clear confirmed episode.',
    );

    // Switch to Vietnamese
    await act(async () => {
      await i18n.changeLanguage('vi');
    });

    // Vietnamese UNKNOWN remains a current-frame abstention, separate from the confirmed episode.
    expect(screen.getByText('Mũ bảo hộ · Chưa xác định')).not.toBeNull();
    expect(screen.queryByText('Mũ bảo hộ · Thiếu · đã xác nhận')).toBeNull();

    const episodeWarningVi = screen.getByTestId('confirmed-episode-warning-7-HARD_HAT');
    expect(episodeWarningVi.textContent).toContain(
      'Đợt thiếu PPE đã xác nhận đang mở: Thiếu · đã xác nhận',
    );
    expect(episodeWarningVi.textContent).toContain('Ảnh chụp hiện tại: Chưa xác định');
    expect(episodeWarningVi.textContent).toContain(
      'Chưa xác định nghĩa là ảnh chụp hiện tại chưa đủ bằng chứng quan sát và không xóa đợt thiếu bảo hộ đã xác nhận.',
    );
  });
});
