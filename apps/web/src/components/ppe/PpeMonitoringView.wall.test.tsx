// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import type { Page, SiteResponse, CameraResponse } from '@smartsite/contracts/management';
import { PpeMonitoringView } from './PpeMonitoringView';
import { type CameraPreviewModelObjects, type RealtimePreview } from '../cameras/realtimePreview';
import type { DecodedPreview } from '../cameras/useRealtimePreview';
import type { SharedSession } from '../../types/shared-session';

if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

interface MockCanvasContext2D {
  drawImage: ReturnType<typeof vi.fn>;
  beginPath: ReturnType<typeof vi.fn>;
  moveTo: ReturnType<typeof vi.fn>;
  lineTo: ReturnType<typeof vi.fn>;
  closePath: ReturnType<typeof vi.fn>;
  fill: ReturnType<typeof vi.fn>;
  stroke: ReturnType<typeof vi.fn>;
  strokeRect: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
  fillText: ReturnType<typeof vi.fn>;
  measureText: ReturnType<typeof vi.fn>;
  font: string;
  lineWidth: number;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  fillStyle: string | CanvasGradient | CanvasPattern;
  textBaseline: CanvasTextBaseline;
}

let mockContext: MockCanvasContext2D;

// Per-camera preview registry to simulate independent feeds
const cameraPreviews = new Map<string, DecodedPreview | null>();
const cameraStatuses = new Map<string, 'LIVE' | 'REPLAY' | 'UNAVAILABLE' | 'CONNECTING'>();
const cameraErrorStatuses = new Map<string, number | null>();

vi.mock('../cameras/useScopedCameraPreview', () => ({
  useScopedCameraPreview: ({ cameraId, siteId }: { cameraId?: string; siteId?: string }) => {
    const cid = cameraId ?? 'default';
    const sid = siteId ?? 'site-alpha';
    const preview = cameraPreviews.get(cid) ?? null;
    const status = cameraStatuses.get(cid) ?? (preview ? 'LIVE' : 'UNAVAILABLE');
    const errStatus = cameraErrorStatuses.get(cid) ?? null;
    return {
      preview,
      status,
      sourceKind: status === 'LIVE' || status === 'REPLAY' ? status : null,
      error: status === 'UNAVAILABLE' || errStatus !== null ? 'Feed offline' : null,
      errorStatus: errStatus,
      isError: status === 'UNAVAILABLE' || errStatus !== null,
      isLoading: false,
      isPolling: status === 'LIVE',
      retry: vi.fn(),
      cameraExternalId: preview?.frame.cameraExternalId ?? cid,
      capturedAt: preview?.frame.capturedAt ?? null,
      siteId: sid,
      cameraId: cid,
    };
  },
}));

vi.mock('../cameras/useRealtimePreview', () => ({
  useRealtimePreview: () => ({ preview: null, connected: true, error: null }),
}));

vi.mock('./ZonePpeSetupPanel', () => ({
  ZonePpeSetupPanel: () => null,
}));

vi.mock('./Mf05DemoControlPanel', () => ({
  Mf05DemoControlPanel: () => null,
}));

const mockSitesList: Page<SiteResponse> = {
  items: [
    {
      id: 'site-alpha',
      code: 'SITE-A',
      name: 'Công trường Alpha',
      createdAt: '2026-09-30T00:00:00Z',
    },
  ],
  total: 1,
};

// 4 cameras in test site (Root handles 4th source)
const mockCamerasList4: Page<CameraResponse> = {
  items: [
    {
      id: 'cam-1',
      siteId: 'site-alpha',
      externalId: 'CAM-01',
      code: 'CAM-01',
      name: 'Camera 01 - Cổng chính',
      status: 'ACTIVE',
      configurationVersion: 1,
      createdAt: '2026-09-30T00:00:00Z',
    },
    {
      id: 'cam-2',
      siteId: 'site-alpha',
      externalId: 'CAM-02',
      code: 'CAM-02',
      name: 'Camera 02 - Khu vực cẩu tháp',
      status: 'ACTIVE',
      configurationVersion: 1,
      createdAt: '2026-09-30T00:00:00Z',
    },
    {
      id: 'cam-3',
      siteId: 'site-alpha',
      externalId: 'CAM-03',
      code: 'CAM-03',
      name: 'Camera 03 - Giàn giáo tầng 5',
      status: 'ACTIVE',
      configurationVersion: 1,
      createdAt: '2026-09-30T00:00:00Z',
    },
    {
      id: 'cam-4',
      siteId: 'site-alpha',
      externalId: 'CAM-04',
      code: 'CAM-04',
      name: 'Camera 04 - Gia công cốt thép',
      status: 'ACTIVE',
      configurationVersion: 1,
      createdAt: '2026-09-30T00:00:00Z',
    },
  ],
  total: 4,
};

// Only 2 cameras available scenario
const mockCamerasList2: Page<CameraResponse> = {
  items: [mockCamerasList4.items[0]!, mockCamerasList4.items[1]!],
  total: 2,
};

const testSharedSession: SharedSession = {
  accessToken: 'test-token',
  sessionScope: 'test-scope',
  user: {
    id: 'user-1',
    username: 'admin',
    displayName: 'Test Admin',
    roleAssignments: [{ role: 'ADMIN', siteId: null }],
  },
};

function createMockFrame(
  cameraId: string,
  modelObjects?: CameraPreviewModelObjects,
): RealtimePreview {
  return {
    sessionId: '33333333-3333-3333-3333-333333333333',
    sequenceNumber: '101',
    cameraExternalId: cameraId,
    capturedAt: new Date().toISOString(),
    width: 640,
    height: 480,
    imageDataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
    zonePolygons: [],
    detections: [
      {
        eventId: 'evt-test-12',
        timecode: '00:00:01',
        trackId: 12,
        active: true,
        label: 'Worker #12',
        confidence: 0.92,
        boundingBox: { x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.8 },
        ppeStatus: { HARD_HAT: 'PRESENT', SAFETY_VEST: 'PRESENT' },
      },
    ],
    zoneDetections: [],
    ...(modelObjects ? { modelObjects } : {}),
  };
}

function createDecodedPreview(frame: RealtimePreview): DecodedPreview {
  const img = {
    naturalWidth: frame.width,
    naturalHeight: frame.height,
  } as unknown as HTMLImageElement;
  return { frame, image: img };
}

describe('PpeMonitoringView 4-Source Wall & Display Presets', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    });

    cameraPreviews.clear();
    cameraStatuses.clear();
    cameraErrorStatuses.clear();

    mockContext = {
      drawImage: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      closePath: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      strokeRect: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn().mockReturnValue({ width: 50 }),
      font: '',
      lineWidth: 1,
      strokeStyle: '',
      fillStyle: '',
      textBaseline: 'alphabetic',
    };

    HTMLCanvasElement.prototype.getContext = vi.fn().mockImplementation((contextId: string) => {
      if (contextId === '2d') return mockContext;
      return null;
    });

    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue(mockSitesList);
    vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockResolvedValue(
      mockCamerasList4,
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('groups monitoring scope separately from setup actions and the viewing controls', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView apiUrl="http://localhost:3000" sharedSession={testSharedSession} />
      </QueryClientProvider>,
    );

    const scope = await screen.findByRole('region', { name: 'Monitoring scope' });
    const setup = screen.getByRole('region', { name: 'Configuration' });
    expect(within(scope).getByRole('combobox', { name: 'Site' })).not.toBeNull();
    expect(within(scope).getByRole('combobox', { name: 'Camera' })).not.toBeNull();
    expect(
      await within(setup).findByRole('button', { name: 'Configure PPE by Zone' }),
    ).not.toBeNull();
    expect(within(setup).queryByRole('combobox')).toBeNull();
    expect(within(scope).queryByTestId('toggle-view-wall')).toBeNull();
    expect(within(setup).queryByTestId('toggle-view-wall')).toBeNull();
    expect(screen.getByTestId('toggle-view-wall')).not.toBeNull();
  });

  it('uses a concise paused evidence state instead of empty observation fields', async () => {
    vi.stubEnv('VITE_AI_WORK_PAUSED', 'true');
    const view = render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView apiUrl="http://localhost:3000" sharedSession={testSharedSession} />
      </QueryClientProvider>,
    );
    try {
      await waitFor(() =>
        expect((screen.getByRole('combobox', { name: 'Camera' }) as HTMLSelectElement).value).toBe(
          'cam-1',
        ),
      );
      const openEvidenceBtn = await screen.findByTestId('open-evidence-details-btn');
      fireEvent.click(openEvidenceBtn);
      const panel = await screen.findByTestId('ai-detection-panel');
      expect(within(panel).queryByText('Track ID')).toBeNull();
      expect(within(panel).queryByText('Identity')).toBeNull();
      expect(within(panel).getByTestId('ai-evidence-badge').textContent).toContain('PAUSED');
      expect(screen.queryByText(/NO TARGETS/)).toBeNull();
    } finally {
      view.unmount();
      vi.unstubAllEnvs();
    }
  });

  it('renders View Mode switcher with Single Focus (default) and 4-Source Wall options', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView apiUrl="http://localhost:3000" sharedSession={testSharedSession} />
      </QueryClientProvider>,
    );

    const singleBtn = await screen.findByTestId('toggle-view-single');
    const wallBtn = await screen.findByTestId('toggle-view-wall');
    expect(singleBtn).not.toBeNull();
    expect(wallBtn).not.toBeNull();

    // Default is Single Focus mode
    expect(singleBtn.getAttribute('aria-pressed')).toBe('true');
    expect(wallBtn.getAttribute('aria-pressed')).toBe('false');
  });

  it('exposes the focused quick-camera button as pressed and updates it after selection', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView apiUrl="http://localhost:3000" sharedSession={testSharedSession} />
      </QueryClientProvider>,
    );
    const first = await screen.findByTestId('camera-chip-cam-1');
    const second = await screen.findByTestId('camera-chip-cam-2');
    expect(first.getAttribute('aria-pressed')).toBe('true');
    expect(second.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(second);
    await waitFor(() => expect(second.getAttribute('aria-pressed')).toBe('true'));
    expect(first.getAttribute('aria-pressed')).toBe('false');
  });

  it('associates the diagnostics disclosure with its expanded content', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView apiUrl="http://localhost:3000" sharedSession={testSharedSession} />
      </QueryClientProvider>,
    );
    const toggle = await screen.findByTestId('toggle-diagnostics-drawer');
    if (toggle.getAttribute('aria-expanded') === 'true') fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const controlsId = toggle.getAttribute('aria-controls');
    expect(controlsId).toBeTruthy();
    expect(document.getElementById(controlsId!)).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.getElementById(controlsId!)).not.toBeNull();
  });

  it('switches to 4-Source Wall and renders up to 4 real camera tiles without fabricated sources', async () => {
    // Setup 4 camera feeds: 3 LIVE, 1 REPLAY
    cameraPreviews.set('cam-1', createDecodedPreview(createMockFrame('CAM-01')));
    cameraStatuses.set('cam-1', 'LIVE');

    cameraPreviews.set('cam-2', createDecodedPreview(createMockFrame('CAM-02')));
    cameraStatuses.set('cam-2', 'LIVE');

    cameraPreviews.set('cam-3', createDecodedPreview(createMockFrame('CAM-03')));
    cameraStatuses.set('cam-3', 'REPLAY');

    cameraPreviews.set('cam-4', createDecodedPreview(createMockFrame('CAM-04')));
    cameraStatuses.set('cam-4', 'LIVE');

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView apiUrl="http://localhost:3000" sharedSession={testSharedSession} />
      </QueryClientProvider>,
    );

    // Switch to wall view
    const wallBtn = await screen.findByTestId('toggle-view-wall');
    fireEvent.click(wallBtn);

    const wallGrid = await screen.findByTestId('four-source-wall-grid');
    expect(wallGrid).not.toBeNull();

    // Exactly 4 authorized camera tiles present
    expect(screen.queryByTestId('wall-tile-cam-1')).not.toBeNull();
    expect(screen.queryByTestId('wall-tile-cam-2')).not.toBeNull();
    expect(screen.queryByTestId('wall-tile-cam-3')).not.toBeNull();
    expect(screen.queryByTestId('wall-tile-cam-4')).not.toBeNull();

    // Zero unassigned slots because all 4 slots have authorized feeds
    expect(screen.queryByTestId('wall-unassigned-slot-1')).toBeNull();
    expect(screen.queryByTestId('wall-unassigned-slot-5')).toBeNull();

    // Factual source badges verified from preview metadata
    const badgeCam1 = screen.getByTestId('wall-source-badge-cam-1');
    expect(badgeCam1?.textContent).toContain('LIVE');

    const badgeCam3 = screen.getByTestId('wall-source-badge-cam-3');
    expect(badgeCam3?.textContent).toContain('REPLAY');
  });

  it('bounds wall view when site only has 2 cameras: renders 2 real tiles and 2 unassigned placeholders, no fake sources', async () => {
    vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockResolvedValue(
      mockCamerasList2,
    );

    cameraPreviews.set('cam-1', createDecodedPreview(createMockFrame('CAM-01')));
    cameraStatuses.set('cam-1', 'LIVE');
    cameraPreviews.set('cam-2', createDecodedPreview(createMockFrame('CAM-02')));
    cameraStatuses.set('cam-2', 'LIVE');

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView apiUrl="http://localhost:3000" sharedSession={testSharedSession} />
      </QueryClientProvider>,
    );

    const wallBtn = await screen.findByTestId('toggle-view-wall');
    fireEvent.click(wallBtn);

    await screen.findByTestId('four-source-wall-grid');

    // Exactly 2 real camera tiles
    expect(screen.queryByTestId('wall-tile-cam-1')).not.toBeNull();
    expect(screen.queryByTestId('wall-tile-cam-2')).not.toBeNull();

    // Camera 3 and 4 are NOT fabricated
    expect(screen.queryByTestId('wall-tile-cam-3')).toBeNull();
    expect(screen.queryByTestId('wall-tile-cam-4')).toBeNull();

    // Unassigned placeholders exist explicitly for slot 3 and 4
    const slot3 = screen.getByTestId('wall-unassigned-slot-3');
    const slot4 = screen.getByTestId('wall-unassigned-slot-4');
    expect(slot3).not.toBeNull();
    expect(slot4).not.toBeNull();
    expect(slot3?.textContent).toContain('Slot 3 · Unassigned');
    expect(slot4?.textContent).toContain('Slot 4 · Unassigned');
  });

  it('clicking a tile in wall view updates selected camera and reuses wall frame in focus card without extra subscription', async () => {
    cameraPreviews.set('cam-1', createDecodedPreview(createMockFrame('CAM-01')));
    cameraStatuses.set('cam-1', 'LIVE');

    const frameCam2 = createMockFrame('CAM-02', {
      modelFamily: 'yolo11s',
      experimental: true,
      scope: 'OBJECT_DETECTION_ONLY',
      artifactId: 'weights-test',
      artifactSha256: 'a'.repeat(64),
      detections: [
        {
          classId: 13,
          className: 'fullbody-Harness',
          confidence: 0.88,
          boundingBox: { x1: 0.2, y1: 0.2, x2: 0.6, y2: 0.8, coordinateSpace: 'NORMALIZED_0_1' },
        },
      ],
    });
    cameraPreviews.set('cam-2', createDecodedPreview(frameCam2));
    cameraStatuses.set('cam-2', 'LIVE');

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView apiUrl="http://localhost:3000" sharedSession={testSharedSession} />
      </QueryClientProvider>,
    );

    const wallBtn = await screen.findByTestId('toggle-view-wall');
    fireEvent.click(wallBtn);

    // Initial focused camera is cam-1
    await screen.findByTestId('wall-tile-cam-1');
    expect(screen.getByTestId('focused-badge-cam-1')).not.toBeNull();
    expect(screen.queryByTestId('focused-badge-cam-2')).toBeNull();

    // Open secondary diagnostics drawer; cam-1 has no modelObjects so raw section is absent even when expanded
    const diagnosticsToggle = screen.getByTestId('toggle-diagnostics-drawer');
    expect(diagnosticsToggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(diagnosticsToggle);
    expect(diagnosticsToggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByTestId('experimental-objects-section')).toBeNull();

    // Click tile 2 to focus cam-2
    const tile2 = screen.getByTestId('wall-tile-cam-2');
    fireEvent.click(tile2);

    // Focused badge moved to cam-2
    expect(screen.queryByTestId('focused-badge-cam-1')).toBeNull();
    expect(screen.getByTestId('focused-badge-cam-2')).not.toBeNull();

    // Right card immediately synchronizes with cam-2 data (shows fullbody-Harness)
    const expSection = await screen.findByTestId('experimental-objects-section');
    const scoped = within(expSection);
    expect(scoped.getByTestId('model-object-item-fullbody-Harness')).not.toBeNull();
    expect(scoped.getByTestId('tag-object-only-fullbody-Harness')).not.toBeNull();
  });

  it('display presets filter positive model detections on display only without persisting or altering compliance', async () => {
    const frameWithAllPpe = createMockFrame('CAM-01', {
      modelFamily: 'yolo11s',
      experimental: true,
      scope: 'OBJECT_DETECTION_ONLY',
      artifactId: 'weights-test',
      artifactSha256: 'a'.repeat(64),
      detections: [
        {
          classId: 1,
          className: 'Hardhat',
          confidence: 0.95,
          boundingBox: { x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.3, coordinateSpace: 'NORMALIZED_0_1' },
        },
        {
          classId: 3,
          className: 'Safety Vest',
          confidence: 0.91,
          boundingBox: { x1: 0.1, y1: 0.3, x2: 0.4, y2: 0.6, coordinateSpace: 'NORMALIZED_0_1' },
        },
        {
          classId: 10,
          className: 'Goggles',
          confidence: 0.85,
          boundingBox: {
            x1: 0.15,
            y1: 0.15,
            x2: 0.25,
            y2: 0.25,
            coordinateSpace: 'NORMALIZED_0_1',
          },
        },
        {
          classId: 11,
          className: 'Mask',
          confidence: 0.82,
          boundingBox: {
            x1: 0.16,
            y1: 0.22,
            x2: 0.26,
            y2: 0.28,
            coordinateSpace: 'NORMALIZED_0_1',
          },
        },
        {
          classId: 13,
          className: 'fullbody-Harness',
          confidence: 0.89,
          boundingBox: { x1: 0.2, y1: 0.2, x2: 0.5, y2: 0.7, coordinateSpace: 'NORMALIZED_0_1' },
        },
        {
          classId: 14,
          className: 'Lanyard-Hook',
          confidence: 0.87,
          boundingBox: { x1: 0.45, y1: 0.6, x2: 0.55, y2: 0.75, coordinateSpace: 'NORMALIZED_0_1' },
        },
      ],
    });

    cameraPreviews.set('cam-1', createDecodedPreview(frameWithAllPpe));
    cameraStatuses.set('cam-1', 'LIVE');

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView apiUrl="http://localhost:3000" sharedSession={testSharedSession} />
      </QueryClientProvider>,
    );

    const diagnosticsToggle = await screen.findByTestId('toggle-diagnostics-drawer');
    expect(diagnosticsToggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(diagnosticsToggle);
    expect(diagnosticsToggle.getAttribute('aria-expanded')).toBe('true');

    const section = await screen.findByTestId('experimental-objects-section');
    const scoped = within(section);

    // Initial Preset: Full eight -> All 6 detected classes displayed
    expect(scoped.queryByTestId('model-object-item-Hardhat')).not.toBeNull();
    expect(scoped.queryByTestId('model-object-item-Safety Vest')).not.toBeNull();
    expect(scoped.queryByTestId('model-object-item-Goggles')).not.toBeNull();
    expect(scoped.queryByTestId('model-object-item-Mask')).not.toBeNull();
    expect(scoped.queryByTestId('model-object-item-fullbody-Harness')).not.toBeNull();
    expect(scoped.queryByTestId('model-object-item-Lanyard-Hook')).not.toBeNull();

    // Object-only labels exist on Mask, fullbody-Harness, Lanyard-Hook
    expect(scoped.queryByTestId('tag-object-only-Mask')).not.toBeNull();
    expect(scoped.queryByTestId('tag-object-only-fullbody-Harness')).not.toBeNull();
    expect(scoped.queryByTestId('tag-object-only-Lanyard-Hook')).not.toBeNull();

    // 1. Select Preset: Height (Harness/Hook)
    const heightBtn = scoped.getByTestId('preset-btn-HEIGHT');
    fireEvent.click(heightBtn);

    // Now only Height objects are visible in positive display list
    expect(scoped.queryByTestId('model-object-item-fullbody-Harness')).not.toBeNull();
    expect(scoped.queryByTestId('model-object-item-Lanyard-Hook')).not.toBeNull();
    expect(scoped.queryByTestId('model-object-item-Hardhat')).toBeNull();
    expect(scoped.queryByTestId('model-object-item-Safety Vest')).toBeNull();
    expect(scoped.queryByTestId('model-object-item-Goggles')).toBeNull();
    expect(scoped.queryByTestId('model-object-item-Mask')).toBeNull();

    // 2. Select Preset: Eye/face (Goggles/Mask)
    const eyeFaceBtn = scoped.getByTestId('preset-btn-EYE_FACE');
    fireEvent.click(eyeFaceBtn);

    expect(scoped.queryByTestId('model-object-item-Goggles')).not.toBeNull();
    expect(scoped.queryByTestId('model-object-item-Mask')).not.toBeNull();
    expect(scoped.queryByTestId('model-object-item-fullbody-Harness')).toBeNull();
    expect(scoped.queryByTestId('model-object-item-Hardhat')).toBeNull();

    // 3. Select Preset: Ground (Helmet/Vest/Gloves/Boots)
    const groundBtn = scoped.getByTestId('preset-btn-GROUND');
    fireEvent.click(groundBtn);

    expect(scoped.queryByTestId('model-object-item-Hardhat')).not.toBeNull();
    expect(scoped.queryByTestId('model-object-item-Safety Vest')).not.toBeNull();
    expect(scoped.queryByTestId('model-object-item-Goggles')).toBeNull();
    expect(scoped.queryByTestId('model-object-item-fullbody-Harness')).toBeNull();

    // Disclaimer clearly affirms non-persisted display only
    expect(scoped.getByText(/Display focus only/i)).not.toBeNull();
  });

  it('offline or empty camera tile never asserts safe state', async () => {
    // cam-1 is UNAVAILABLE
    cameraPreviews.set('cam-1', null);
    cameraStatuses.set('cam-1', 'UNAVAILABLE');

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView apiUrl="http://localhost:3000" sharedSession={testSharedSession} />
      </QueryClientProvider>,
    );

    const wallBtn = await screen.findByTestId('toggle-view-wall');
    fireEvent.click(wallBtn);

    const tile1 = await screen.findByTestId('wall-tile-cam-1');
    const scoped = within(tile1);

    // Displays factual unavailable warning, never "SAFE" or "CLEAR"
    expect(scoped.getByText(/Snapshot Unavailable/i)).not.toBeNull();
    expect(scoped.queryByText(/SAFE/i)).toBeNull();
    expect(scoped.queryByText(/CLEAR/i)).toBeNull();
  });

  it('uses strictly Person detections phrasing and flat minimalist styling without gradients or animate-ping', async () => {
    // cam-1 has 0 detections
    const emptyFrame = createMockFrame('CAM-01');
    emptyFrame.detections = [];
    cameraPreviews.set('cam-1', createDecodedPreview(emptyFrame));
    cameraStatuses.set('cam-1', 'LIVE');

    // cam-2 has 2 detections
    const frameWith2 = createMockFrame('CAM-02');
    frameWith2.detections = [
      {
        eventId: 'evt-test-1',
        timecode: '00:00:01',
        trackId: 1,
        active: true,
        label: 'Person #1',
        confidence: 0.9,
        boundingBox: { x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.5 },
        ppeStatus: { HARD_HAT: 'PRESENT', SAFETY_VEST: 'PRESENT' },
      },
      {
        eventId: 'evt-test-2',
        timecode: '00:00:02',
        trackId: 2,
        active: true,
        label: 'Person #2',
        confidence: 0.85,
        boundingBox: { x1: 0.4, y1: 0.2, x2: 0.6, y2: 0.7 },
        ppeStatus: { HARD_HAT: 'PRESENT', SAFETY_VEST: 'PRESENT' },
      },
    ];
    cameraPreviews.set('cam-2', createDecodedPreview(frameWith2));
    cameraStatuses.set('cam-2', 'LIVE');

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView apiUrl="http://localhost:3000" sharedSession={testSharedSession} />
      </QueryClientProvider>,
    );

    const wallBtn = await screen.findByTestId('toggle-view-wall');
    fireEvent.click(wallBtn);

    const tile1 = await screen.findByTestId('wall-tile-cam-1');
    const scoped1 = within(tile1);

    // Strictly 'No Person detections' in overlay only (no duplicate footer text), never 'No workers in frame' or '0 workers'
    expect(
      scoped1.getByText(/No Person detections · Zero detections do not certify safety clearance/i),
    ).not.toBeNull();
    expect(scoped1.queryByText(/^No Person detections$/i)).toBeNull();
    expect(scoped1.queryByText(/No workers in frame/i)).toBeNull();
    expect(scoped1.queryByText(/0 workers/i)).toBeNull();
    expect(scoped1.queryByText(/worker\(s\)/i)).toBeNull();

    // Check cam-2 shows '2 Person detection(s)', never '2 worker(s)'
    const tile2 = await screen.findByTestId('wall-tile-cam-2');
    const scoped2 = within(tile2);
    expect(scoped2.getByText(/2 Person detection\(s\)/i)).not.toBeNull();
    expect(scoped2.queryByText(/2 worker\(s\)/i)).toBeNull();

    // Check no gradient or animate-ping classes in tile DOM
    const html = tile1.innerHTML;
    expect(html.includes('bg-gradient-to-b')).toBe(false);
    expect(html.includes('bg-gradient-to-t')).toBe(false);
    expect(html.includes('animate-ping')).toBe(false);
  });

  it('synchronously guards against stale wall snapshots across site switch and rejects late callbacks', async () => {
    const mockSitesListMultiple: Page<SiteResponse> = {
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

    const mockCamerasBeta: Page<CameraResponse> = {
      items: [
        {
          id: 'cam-beta-1',
          siteId: 'site-beta',
          externalId: 'CAM-B01',
          code: 'CAM-B01',
          name: 'Camera Beta 01',
          status: 'ACTIVE',
          configurationVersion: 1,
          createdAt: '2026-09-30T00:00:00Z',
        },
      ],
      total: 1,
    };

    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue(
      mockSitesListMultiple,
    );
    vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockImplementation(
      async (_token, siteId) => {
        if (siteId === 'site-beta') return mockCamerasBeta;
        return mockCamerasList4;
      },
    );

    cameraPreviews.set('cam-1', createDecodedPreview(createMockFrame('CAM-01')));
    cameraStatuses.set('cam-1', 'LIVE');

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView apiUrl="http://localhost:3000" sharedSession={testSharedSession} />
      </QueryClientProvider>,
    );

    const wallBtn = await screen.findByTestId('toggle-view-wall');
    fireEvent.click(wallBtn);

    // Site Alpha tile is present
    expect(await screen.findByTestId('wall-tile-cam-1')).not.toBeNull();

    // Switch site selector to site-beta
    const siteSelect = screen.getByRole('combobox', { name: /Site/i });
    fireEvent.change(siteSelect, { target: { value: 'site-beta' } });

    // Under site-beta, cam-1 tile is unmounted and cam-beta-1 is mounted
    expect(await screen.findByTestId('wall-tile-cam-beta-1')).not.toBeNull();
    expect(screen.queryByTestId('wall-tile-cam-1')).toBeNull();

    // Stale cam-1 snapshot cannot be retained or displayed as focused
    expect(screen.queryByTestId('focused-badge-cam-1')).toBeNull();
  });

  it('synchronously clears wall snapshots on auth/session switch without 1-render leak', async () => {
    cameraPreviews.set('cam-1', createDecodedPreview(createMockFrame('CAM-01')));
    cameraStatuses.set('cam-1', 'LIVE');

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView apiUrl="http://localhost:3000" sharedSession={testSharedSession} />
      </QueryClientProvider>,
    );

    const wallBtn = await screen.findByTestId('toggle-view-wall');
    fireEvent.click(wallBtn);

    expect(await screen.findByTestId('wall-tile-cam-1')).not.toBeNull();

    // Switch session to a new sessionScope and token
    const newSession: SharedSession = {
      accessToken: 'new-token-999',
      sessionScope: 'new-scope-999',
      user: {
        id: 'user-2',
        username: 'engineer',
        displayName: 'Engineer Two',
        roleAssignments: [{ role: 'ADMIN', siteId: null }],
      },
    };

    rerender(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView apiUrl="http://localhost:3000" sharedSession={newSession} />
      </QueryClientProvider>,
    );

    // Old session credentials cannot publish or preserve old snapshots
    expect(await screen.findByTestId('wall-tile-cam-1')).not.toBeNull();
  });

  it('cleans up tile snapshot immediately when camera tile is unmounted', async () => {
    // Start with 4 cameras
    vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockResolvedValue(
      mockCamerasList4,
    );

    cameraPreviews.set('cam-4', createDecodedPreview(createMockFrame('CAM-04')));
    cameraStatuses.set('cam-4', 'LIVE');

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView apiUrl="http://localhost:3000" sharedSession={testSharedSession} />
      </QueryClientProvider>,
    );

    const wallBtn = await screen.findByTestId('toggle-view-wall');
    fireEvent.click(wallBtn);

    expect(await screen.findByTestId('wall-tile-cam-4')).not.toBeNull();

    // Now cameras drop to 2 (cam-4 is unmounted)
    vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockResolvedValue(
      mockCamerasList2,
    );
    await queryClient.refetchQueries();

    rerender(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView apiUrl="http://localhost:3000" sharedSession={testSharedSession} />
      </QueryClientProvider>,
    );

    // cam-4 tile is unmounted
    await waitFor(() => {
      expect(screen.queryByTestId('wall-tile-cam-4')).toBeNull();
    });
    // Replaced by unassigned placeholder
    expect(screen.getByTestId('wall-unassigned-slot-4')).not.toBeNull();
  });

  it('propagates 401 error from any wall tile to triggerSessionExpired and onSignOut', async () => {
    const onSignOutMock = vi.fn();
    const sessionWithSignOut: SharedSession = {
      ...testSharedSession,
      onSignOut: onSignOutMock,
    };

    cameraPreviews.set('cam-1', createDecodedPreview(createMockFrame('CAM-01')));
    cameraStatuses.set('cam-1', 'LIVE');

    cameraErrorStatuses.set('cam-2', 401);
    cameraStatuses.set('cam-2', 'UNAVAILABLE');

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView apiUrl="http://localhost:3000" sharedSession={sessionWithSignOut} />
      </QueryClientProvider>,
    );

    const wallBtn = await screen.findByTestId('toggle-view-wall');
    fireEvent.click(wallBtn);

    await waitFor(() => {
      expect(onSignOutMock).toHaveBeenCalledTimes(1);
    });
  });

  it('assigns camera-specific default presets, modifies selected camera preset only, and clears preset overrides on scope change', async () => {
    const mockSitesListMultiple: Page<SiteResponse> = {
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

    const mockRealFourCameras: Page<CameraResponse> = {
      items: [
        {
          id: 'cam-tapo',
          siteId: 'site-alpha',
          externalId: 'tapo-core5-live',
          code: 'CAM-TAPO',
          name: 'Tapo Core 5 Live',
          status: 'ACTIVE',
          configurationVersion: 1,
          createdAt: '2026-09-30T00:00:00Z',
        },
        {
          id: 'cam-laptop',
          siteId: 'site-alpha',
          externalId: 'laptop-webcam-live',
          code: 'CAM-LAPTOP',
          name: 'Laptop Webcam Live',
          status: 'ACTIVE',
          configurationVersion: 1,
          createdAt: '2026-09-30T00:00:00Z',
        },
        {
          id: 'cam-replay',
          siteId: 'site-alpha',
          externalId: 'core5-recorded-demo',
          code: 'CAM-REPLAY',
          name: 'Core 5 Replay Demo',
          status: 'ACTIVE',
          configurationVersion: 1,
          createdAt: '2026-09-30T00:00:00Z',
        },
        {
          id: 'cam-other',
          siteId: 'site-alpha',
          externalId: 'unknown-camera',
          code: 'CAM-OTHER',
          name: 'Unknown Regular Camera',
          status: 'ACTIVE',
          configurationVersion: 1,
          createdAt: '2026-09-30T00:00:00Z',
        },
      ],
      total: 4,
    };

    // Reused camera ID across different site scope to verify override clearing
    const mockCamerasBeta: Page<CameraResponse> = {
      items: [
        {
          id: 'cam-laptop',
          siteId: 'site-beta',
          externalId: 'laptop-webcam-live',
          code: 'CAM-B01',
          name: 'Camera Beta 01',
          status: 'ACTIVE',
          configurationVersion: 1,
          createdAt: '2026-09-30T00:00:00Z',
        },
      ],
      total: 1,
    };

    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue(
      mockSitesListMultiple,
    );
    vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockImplementation(
      async (_token, siteId) => {
        if (siteId === 'site-beta') return mockCamerasBeta;
        return mockRealFourCameras;
      },
    );

    const richFrame = createMockFrame('cam-tapo', {
      modelFamily: 'yolo11s',
      experimental: true,
      scope: 'OBJECT_DETECTION_ONLY',
      artifactId: 'weights-test',
      artifactSha256: 'a'.repeat(64),
      detections: [
        {
          classId: 1,
          className: 'Hardhat',
          confidence: 0.95,
          boundingBox: { x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.3, coordinateSpace: 'NORMALIZED_0_1' },
        },
        {
          classId: 3,
          className: 'Safety Vest',
          confidence: 0.91,
          boundingBox: { x1: 0.1, y1: 0.3, x2: 0.4, y2: 0.6, coordinateSpace: 'NORMALIZED_0_1' },
        },
        {
          classId: 10,
          className: 'Goggles',
          confidence: 0.85,
          boundingBox: {
            x1: 0.15,
            y1: 0.15,
            x2: 0.25,
            y2: 0.25,
            coordinateSpace: 'NORMALIZED_0_1',
          },
        },
        {
          classId: 11,
          className: 'Mask',
          confidence: 0.82,
          boundingBox: {
            x1: 0.16,
            y1: 0.22,
            x2: 0.26,
            y2: 0.28,
            coordinateSpace: 'NORMALIZED_0_1',
          },
        },
        {
          classId: 13,
          className: 'fullbody-Harness',
          confidence: 0.89,
          boundingBox: { x1: 0.2, y1: 0.2, x2: 0.5, y2: 0.7, coordinateSpace: 'NORMALIZED_0_1' },
        },
      ],
    });

    cameraPreviews.set('cam-tapo', createDecodedPreview(richFrame));
    cameraStatuses.set('cam-tapo', 'LIVE');
    cameraPreviews.set('cam-laptop', createDecodedPreview(richFrame));
    cameraStatuses.set('cam-laptop', 'LIVE');

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView apiUrl="http://localhost:3000" sharedSession={testSharedSession} />
      </QueryClientProvider>,
    );

    const wallBtn = await screen.findByTestId('toggle-view-wall');
    fireEvent.click(wallBtn);

    await screen.findByTestId('wall-tile-cam-tapo');

    const diagnosticsToggle = screen.getByTestId('toggle-diagnostics-drawer');
    expect(diagnosticsToggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(diagnosticsToggle);
    expect(diagnosticsToggle.getAttribute('aria-expanded')).toBe('true');

    // 1. Initial selected camera is cam-tapo -> Default preset is GROUND
    const section = await screen.findByTestId('experimental-objects-section');
    const groundBtn = screen.getByTestId('preset-btn-GROUND');
    expect(groundBtn.getAttribute('aria-pressed')).toBe('true');

    // Filtered to GROUND items only (Hardhat, Safety Vest), not Goggles or Harness
    const scoped1 = within(section);
    expect(scoped1.getByTestId('model-object-item-Hardhat')).not.toBeNull();
    expect(scoped1.getByTestId('model-object-item-Safety Vest')).not.toBeNull();
    expect(scoped1.queryByTestId('model-object-item-Goggles')).toBeNull();
    expect(scoped1.queryByTestId('model-object-item-fullbody-Harness')).toBeNull();

    // 2. Click tile cam-laptop -> Default preset is EYE_FACE
    const tileLaptop = screen.getByTestId('wall-tile-cam-laptop');
    fireEvent.click(tileLaptop);

    const eyeFaceBtn = await screen.findByTestId('preset-btn-EYE_FACE');
    expect(eyeFaceBtn.getAttribute('aria-pressed')).toBe('true');

    // Filtered to EYE_FACE items only (Goggles, Mask)
    const scoped2 = within(await screen.findByTestId('experimental-objects-section'));
    expect(scoped2.getByTestId('model-object-item-Goggles')).not.toBeNull();
    expect(scoped2.getByTestId('model-object-item-Mask')).not.toBeNull();
    expect(scoped2.queryByTestId('model-object-item-Hardhat')).toBeNull();
    expect(scoped2.queryByTestId('model-object-item-fullbody-Harness')).toBeNull();

    // 3. User manually selects HEIGHT preset for cam-laptop ONLY
    const heightBtn = screen.getByTestId('preset-btn-HEIGHT');
    fireEvent.click(heightBtn);
    expect(heightBtn.getAttribute('aria-pressed')).toBe('true');

    // 4. Click back to cam-tapo: its preset is STILL GROUND (untouched by cam-laptop's change)
    const tileTapo = screen.getByTestId('wall-tile-cam-tapo');
    fireEvent.click(tileTapo);
    const groundBtnAfter = screen.getByTestId('preset-btn-GROUND');
    expect(groundBtnAfter.getAttribute('aria-pressed')).toBe('true');

    // 5. Switch site to site-beta -> Presets are reset, proving reused cam-laptop clears previous HEIGHT override
    const siteSelect = screen.getByRole('combobox', { name: /Site/i });
    fireEvent.change(siteSelect, { target: { value: 'site-beta' } });

    await screen.findByTestId('wall-tile-cam-laptop');
    // In site-beta, cam-laptop returns to its default EYE_FACE preset, not retaining previous HEIGHT override
    const eyeFaceBtnSiteBeta = await screen.findByTestId('preset-btn-EYE_FACE');
    expect(eyeFaceBtnSiteBeta.getAttribute('aria-pressed')).toBe('true');
    const heightBtnSiteBeta = screen.getByTestId('preset-btn-HEIGHT');
    expect(heightBtnSiteBeta.getAttribute('aria-pressed')).toBe('false');
  });

  it('renders concise tile headers, native Details disclosure containing Observation Zones, and single-line paused badge when AI work is paused', async () => {
    vi.stubEnv('VITE_AI_WORK_PAUSED', 'true');
    try {
      render(
        <QueryClientProvider client={queryClient}>
          <PpeMonitoringView apiUrl="http://localhost:3000" sharedSession={testSharedSession} />
        </QueryClientProvider>,
      );

      fireEvent.click(await screen.findByTestId('toggle-view-wall'));
      const tile1 = await screen.findByTestId('wall-tile-cam-1');

      // Concise camera display name and single-line paused state inside tile
      expect(within(tile1).getByTestId('wall-source-badge-cam-1').textContent).toContain('PAUSED');
      const pausedNode = within(tile1).getByTestId('wall-paused-cam-1');
      expect(pausedNode.textContent).toContain('Camera preview paused');
      expect(pausedNode.textContent).not.toContain('Zone and region configuration remains active');

      // Long Site/Zone/ID metadata lives inside native <details> disclosure
      const details = within(tile1).getByTestId('wall-tile-details-cam-1');
      expect(details.tagName.toLowerCase()).toBe('details');
      expect(within(details).getByTestId('wall-zones-cam-1')).not.toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('enlarges a camera from its wall tile via Enlarge camera button and returns to 4-Source Wall via Back to grid controls', async () => {
    cameraPreviews.set('cam-1', createDecodedPreview(createMockFrame('CAM-01')));
    cameraStatuses.set('cam-1', 'LIVE');
    cameraPreviews.set('cam-2', createDecodedPreview(createMockFrame('CAM-02')));
    cameraStatuses.set('cam-2', 'LIVE');

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView apiUrl="http://localhost:3000" sharedSession={testSharedSession} />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByTestId('toggle-view-wall'));
    await screen.findByTestId('four-source-wall-grid');

    // Click Enlarge camera on cam-2 tile
    const enlargeCam2Btn = screen.getByTestId('enlarge-camera-btn-cam-2');
    fireEvent.click(enlargeCam2Btn);

    // Switches to enlarged single-camera viewport focused on cam-2
    const singleViewport = await screen.findByTestId('single-camera-viewport');
    expect(singleViewport).not.toBeNull();
    expect(screen.queryByTestId('four-source-wall-grid')).toBeNull();
    expect((screen.getByRole('combobox', { name: 'Camera' }) as HTMLSelectElement).value).toBe(
      'cam-2',
    );
    expect(within(singleViewport).getByTestId('single-viewport-details')).not.toBeNull();

    // Return to grid via viewport Back to grid button
    fireEvent.click(screen.getByTestId('single-viewport-back-to-grid-btn'));
    expect(await screen.findByTestId('four-source-wall-grid')).not.toBeNull();
    expect(screen.getByTestId('focused-badge-cam-2')).not.toBeNull();

    // Enlarge again and return via top toolbar Back to grid button
    fireEvent.click(screen.getByTestId('enlarge-camera-btn-cam-1'));
    expect(await screen.findByTestId('single-camera-viewport')).not.toBeNull();
    fireEvent.click(screen.getByTestId('toggle-view-wall'));
    expect(await screen.findByTestId('four-source-wall-grid')).not.toBeNull();
    expect(screen.getByTestId('focused-badge-cam-1')).not.toBeNull();
  });

  it('toggles browser fullscreen when supported and surfaces a safe fallback notice when fullscreen is unsupported or rejected', async () => {
    cameraPreviews.set('cam-1', createDecodedPreview(createMockFrame('CAM-01')));
    cameraStatuses.set('cam-1', 'LIVE');

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView apiUrl="http://localhost:3000" sharedSession={testSharedSession} />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect((screen.getByRole('combobox', { name: 'Camera' }) as HTMLSelectElement).value).toBe(
        'cam-1',
      ),
    );
    const viewport = await screen.findByTestId('single-camera-viewport');
    const fullscreenBtn = screen.getByTestId('toggle-fullscreen-btn');

    // 1. Unsupported environment (JSDOM default has no requestFullscreen on element)
    const origRequest = viewport.requestFullscreen;
    // @ts-expect-error testing missing fullscreen API
    viewport.requestFullscreen = undefined;
    fireEvent.click(fullscreenBtn);
    const errorNotice = await screen.findByTestId('fullscreen-error-notice');
    expect(errorNotice.textContent).toContain('Browser Fullscreen API is not supported');

    // 2. Supported requestFullscreen & exitFullscreen
    const reqMock = vi.fn().mockResolvedValue(undefined);
    const exitMock = vi.fn().mockResolvedValue(undefined);
    viewport.requestFullscreen = reqMock;
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      writable: true,
      value: exitMock,
    });

    fireEvent.click(fullscreenBtn);
    await waitFor(() => expect(reqMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(fullscreenBtn.getAttribute('aria-pressed')).toBe('true'));
    expect(screen.queryByTestId('fullscreen-error-notice')).toBeNull();

    fireEvent.click(fullscreenBtn);
    await waitFor(() => expect(exitMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(fullscreenBtn.getAttribute('aria-pressed')).toBe('false'));

    // 3. Unrelated fullscreen element/events must not be exited or trigger error notice
    const unrelatedDiv = document.createElement('div');
    document.body.appendChild(unrelatedDiv);
    try {
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        writable: true,
        value: unrelatedDiv,
      });
      unrelatedDiv.dispatchEvent(new Event('fullscreenerror', { bubbles: true }));
      expect(screen.queryByTestId('fullscreen-error-notice')).toBeNull();

      fireEvent.click(screen.getByTestId('single-viewport-back-to-grid-btn'));
      expect(exitMock).toHaveBeenCalledTimes(1); // Not called again for unrelated element
    } finally {
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        writable: true,
        value: null,
      });
      unrelatedDiv.remove();
      viewport.requestFullscreen = origRequest;
    }
  });

  it('keeps Evidence & Details off the permanent wall grid and opens/closes on-demand PpeDialog via toolbar or tile Evidence triggers with Escape', async () => {
    cameraPreviews.set('cam-1', createDecodedPreview(createMockFrame('CAM-01')));
    cameraStatuses.set('cam-1', 'LIVE');
    cameraPreviews.set('cam-2', createDecodedPreview(createMockFrame('CAM-02')));
    cameraStatuses.set('cam-2', 'LIVE');

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView apiUrl="http://localhost:3000" sharedSession={testSharedSession} />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByTestId('toggle-view-wall'));
    await screen.findByTestId('four-source-wall-grid');

    // By default, ai-detection-panel is not occupying a permanent column
    expect(screen.queryByTestId('ai-detection-panel')).toBeNull();

    // Clicking tile Evidence button on cam-2 selects cam-2 and opens Evidence dialog
    const tileEvidenceBtn2 = screen.getByTestId('tile-evidence-btn-cam-2');
    fireEvent.click(tileEvidenceBtn2);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).not.toBeNull();
    expect(within(dialog).getByTestId('ai-detection-panel')).not.toBeNull();
    expect(within(dialog).getByTestId('ppe-primary-context').textContent).toContain('Camera 02');

    // Pressing Escape closes the Evidence dialog
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('ai-detection-panel')).toBeNull());
  });
  it('closes open Evidence dialog immediately when Site selection changes', async () => {
    const mockSitesListMultiple: Page<SiteResponse> = {
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

    const mockCamerasBeta: Page<CameraResponse> = {
      items: [
        {
          id: 'cam-beta-1',
          siteId: 'site-beta',
          externalId: 'CAM-B01',
          code: 'CAM-B01',
          name: 'Camera Beta 01',
          status: 'ACTIVE',
          configurationVersion: 1,
          createdAt: '2026-09-30T00:00:00Z',
        },
      ],
      total: 1,
    };

    vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue(
      mockSitesListMultiple,
    );
    vi.spyOn(SmartSiteManagementClient.prototype, 'listPreviewCameras').mockImplementation(
      async (_token, siteId) => (siteId === 'site-beta' ? mockCamerasBeta : mockCamerasList4),
    );

    cameraPreviews.set('cam-1', createDecodedPreview(createMockFrame('CAM-01')));
    cameraStatuses.set('cam-1', 'LIVE');

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView apiUrl="http://localhost:3000" sharedSession={testSharedSession} />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByTestId('toggle-view-wall'));
    await screen.findByTestId('wall-tile-cam-1');

    fireEvent.click(screen.getByTestId('tile-evidence-btn-cam-1'));
    expect(await screen.findByTestId('ai-detection-panel')).not.toBeNull();

    fireEvent.change(screen.getByRole('combobox', { name: 'Site', hidden: true }), {
      target: { value: 'site-beta' },
    });

    expect(screen.queryByTestId('ai-detection-panel')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await screen.findByTestId('wall-tile-cam-beta-1')).not.toBeNull();
    expect(screen.queryByTestId('ai-detection-panel')).toBeNull();
  });

  it('ignores late requestFullscreen resolution after view return or scope change without restoring fullscreen state or exiting an unrelated active element', async () => {
    cameraPreviews.set('cam-1', createDecodedPreview(createMockFrame('CAM-01')));
    cameraStatuses.set('cam-1', 'LIVE');

    let resolveFirstReq!: () => void;
    let resolveSecondReq!: () => void;
    const reqMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirstReq = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveSecondReq = resolve;
          }),
      );
    const exitMock = vi.fn().mockResolvedValue(undefined);

    const origRequestFullscreen = HTMLElement.prototype.requestFullscreen;
    const origExitFullscreen = document.exitFullscreen;
    const unrelatedEl = document.createElement('div');
    document.body.appendChild(unrelatedEl);

    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
      configurable: true,
      writable: true,
      value: reqMock,
    });
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      writable: true,
      value: exitMock,
    });

    try {
      const { rerender } = render(
        <QueryClientProvider client={queryClient}>
          <PpeMonitoringView apiUrl="http://localhost:3000" sharedSession={testSharedSession} />
        </QueryClientProvider>,
      );

      await screen.findByTestId('single-camera-viewport');
      fireEvent.click(await screen.findByTestId('toggle-fullscreen-btn'));
      expect(reqMock).toHaveBeenCalledTimes(1);

      // Unrelated element owns document.fullscreenElement while request #1 is pending
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        writable: true,
        value: unrelatedEl,
      });

      // Return to wall view, then re-enlarge cam-1 before request #1 resolves
      fireEvent.click(screen.getByTestId('single-viewport-back-to-grid-btn'));
      await screen.findByTestId('four-source-wall-grid');
      fireEvent.click(screen.getByTestId('enlarge-camera-btn-cam-1'));
      await screen.findByTestId('toggle-fullscreen-btn');

      resolveFirstReq();
      await Promise.resolve();

      expect(screen.getByTestId('toggle-fullscreen-btn').getAttribute('aria-pressed')).toBe(
        'false',
      );
      expect(exitMock).not.toHaveBeenCalled();

      // Start request #2, then rotate session scope before request #2 resolves
      fireEvent.click(screen.getByTestId('toggle-fullscreen-btn'));
      expect(reqMock).toHaveBeenCalledTimes(2);

      const rotatedSession: SharedSession = {
        ...testSharedSession,
        accessToken: 'rotated-token-2',
        sessionScope: 'rotated-scope-2',
      };
      rerender(
        <QueryClientProvider client={queryClient}>
          <PpeMonitoringView apiUrl="http://localhost:3000" sharedSession={rotatedSession} />
        </QueryClientProvider>,
      );

      resolveSecondReq();
      await Promise.resolve();

      expect(
        (await screen.findByTestId('toggle-fullscreen-btn')).getAttribute('aria-pressed'),
      ).toBe('false');
      expect(exitMock).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        writable: true,
        value: null,
      });
      Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
        configurable: true,
        writable: true,
        value: origRequestFullscreen,
      });
      Object.defineProperty(document, 'exitFullscreen', {
        configurable: true,
        writable: true,
        value: origExitFullscreen,
      });
      unrelatedEl.remove();
    }
  });

  it('keeps the newer fullscreen request active after an older request rejects', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView apiUrl="http://localhost:3000" sharedSession={testSharedSession} />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect((screen.getByRole('combobox', { name: 'Camera' }) as HTMLSelectElement).value).toBe(
        'cam-1',
      ),
    );
    const viewport = screen.getByTestId('single-camera-viewport');
    let rejectOld!: (error: Error) => void;
    const first = new Promise<void>((_resolve, reject) => {
      rejectOld = reject;
    });
    viewport.requestFullscreen = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(undefined);
    const button = screen.getByTestId('toggle-fullscreen-btn');
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(button.getAttribute('aria-pressed')).toBe('true'));
    rejectOld(new Error('Old request rejected'));
    await Promise.resolve();
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByTestId('fullscreen-error-notice')).toBeNull();
  });

  it('supports full-wall native fullscreen and exit, preserves wall fullscreen when selecting another tile, exits on camera enlarge, and keeps global Evidence button free of raw UUID/status badges', async () => {
    cameraPreviews.set('cam-1', createDecodedPreview(createMockFrame('CAM-01')));
    cameraStatuses.set('cam-1', 'LIVE');
    cameraPreviews.set('cam-2', createDecodedPreview(createMockFrame('CAM-02')));
    cameraStatuses.set('cam-2', 'LIVE');

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView apiUrl="http://localhost:3000" sharedSession={testSharedSession} />
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByTestId('toggle-view-wall'));
    const wallContainer = await screen.findByTestId('wall-view-container');

    // Global Evidence & Details button is simplified without raw UUID or status badge text
    const openEvidenceBtn = screen.getByTestId('open-evidence-details-btn');
    expect(openEvidenceBtn.textContent?.trim()).toBe('Evidence & Details');
    expect(openEvidenceBtn.textContent).not.toContain('evt-test-12');
    expect(openEvidenceBtn.textContent).not.toContain('AI EVIDENCE UNAVAILABLE');
    expect(openEvidenceBtn.textContent).not.toContain('NO-DETECTION');

    const reqMock = vi.fn().mockImplementation(async () => {
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        writable: true,
        value: wallContainer,
      });
    });
    const exitMock = vi.fn().mockImplementation(async () => {
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        writable: true,
        value: null,
      });
    });
    const origRequest = wallContainer.requestFullscreen;
    const origExit = document.exitFullscreen;
    wallContainer.requestFullscreen = reqMock;
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      writable: true,
      value: exitMock,
    });

    try {
      const wallFullscreenBtn = screen.getByTestId('wall-fullscreen-btn');
      expect(wallFullscreenBtn.getAttribute('aria-pressed')).toBe('false');

      // Enter full-wall fullscreen
      fireEvent.click(wallFullscreenBtn);
      await waitFor(() => expect(reqMock).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(wallFullscreenBtn.getAttribute('aria-pressed')).toBe('true'));
      expect(screen.getByTestId('wall-exit-fullscreen-btn')).not.toBeNull();

      // Selecting another tile in the same authorized Site keeps wall fullscreen active
      fireEvent.click(screen.getByTestId('focus-btn-cam-2'));
      expect(screen.getByTestId('focused-badge-cam-2')).not.toBeNull();
      expect(wallFullscreenBtn.getAttribute('aria-pressed')).toBe('true');
      expect(exitMock).not.toHaveBeenCalled();

      // Exit fullscreen via the in-wall Exit fullscreen button
      fireEvent.click(screen.getByTestId('wall-exit-fullscreen-btn'));
      await waitFor(() => expect(exitMock).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(wallFullscreenBtn.getAttribute('aria-pressed')).toBe('false'));
      expect(screen.queryByTestId('wall-exit-fullscreen-btn')).toBeNull();

      // Re-enter full-wall fullscreen, then enlarge cam-2 -> exits wall fullscreen safely
      fireEvent.click(wallFullscreenBtn);
      await waitFor(() => expect(reqMock).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(wallFullscreenBtn.getAttribute('aria-pressed')).toBe('true'));

      // A body-portaled evidence dialog must leave wall fullscreen first.
      fireEvent.click(screen.getByTestId('tile-evidence-btn-cam-2'));
      await screen.findByRole('dialog');
      await waitFor(() => expect(exitMock).toHaveBeenCalledTimes(2));
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

      fireEvent.click(wallFullscreenBtn);
      await waitFor(() => expect(reqMock).toHaveBeenCalledTimes(3));
      await waitFor(() => expect(wallFullscreenBtn.getAttribute('aria-pressed')).toBe('true'));
      fireEvent.click(screen.getByTestId('enlarge-camera-btn-cam-2'));
      await screen.findByTestId('single-camera-viewport');
      await waitFor(() => expect(exitMock).toHaveBeenCalledTimes(3));
      expect(screen.getByTestId('toggle-fullscreen-btn').getAttribute('aria-pressed')).toBe(
        'false',
      );
    } finally {
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        writable: true,
        value: null,
      });
      wallContainer.requestFullscreen = origRequest;
      Object.defineProperty(document, 'exitFullscreen', {
        configurable: true,
        writable: true,
        value: origExit,
      });
    }
  });
  it('exits a late wall fullscreen activation after evidence opened while its request was pending', async () => {
    const originalElement = Object.getOwnPropertyDescriptor(document, 'fullscreenElement');
    const originalExit = Object.getOwnPropertyDescriptor(document, 'exitFullscreen');
    let resolveRequest!: () => void;
    const exit = vi.fn(async () => {
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
    });
    try {
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
      Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit });
      render(
        <QueryClientProvider client={queryClient}>
          <PpeMonitoringView apiUrl="http://localhost:3000" sharedSession={testSharedSession} />
        </QueryClientProvider>,
      );
      fireEvent.click(await screen.findByTestId('toggle-view-wall'));
      const wall = await screen.findByTestId('wall-view-container');
      wall.requestFullscreen = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveRequest = resolve;
          }),
      );
      fireEvent.click(screen.getByTestId('wall-fullscreen-btn'));
      fireEvent.click(await screen.findByTestId('tile-evidence-btn-cam-1'));
      await screen.findByRole('dialog');
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: wall });
      resolveRequest();
      await waitFor(() => expect(exit).toHaveBeenCalledTimes(1));
      expect(screen.getByRole('dialog')).not.toBeNull();
      expect(screen.getByTestId('wall-fullscreen-btn').getAttribute('aria-pressed')).toBe('false');
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      wall.requestFullscreen = vi.fn(async () => {
        Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: wall });
      });
      fireEvent.click(screen.getByTestId('wall-fullscreen-btn'));
      await waitFor(() =>
        expect(screen.getByTestId('wall-fullscreen-btn').getAttribute('aria-pressed')).toBe('true'),
      );
      vi.mocked(SmartSiteManagementClient.prototype.listPreviewCameras).mockRejectedValue(
        new Error('Camera metadata unavailable'),
      );
      await queryClient.invalidateQueries();
      await waitFor(() => expect(exit).toHaveBeenCalledTimes(2));
      expect(screen.getByTestId('wall-fullscreen-btn').getAttribute('aria-pressed')).toBe('false');
    } finally {
      if (originalElement) Object.defineProperty(document, 'fullscreenElement', originalElement);
      else Reflect.deleteProperty(document, 'fullscreenElement');
      if (originalExit) Object.defineProperty(document, 'exitFullscreen', originalExit);
      else Reflect.deleteProperty(document, 'exitFullscreen');
    }
  });
});
