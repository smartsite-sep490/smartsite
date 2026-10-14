// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { SmartSiteManagementClient, ApiError } from '@smartsite/api-client';
import type { Page, ZoneResponse } from '@smartsite/api-client';
import type { CameraResponse, RegionResponse, RegionMutationResponse } from '@smartsite/contracts';
import { ZonePpeCameraRegionPanel } from './ZonePpeCameraRegionPanel';
import { PpeDialog } from './PpeDialog';
import type { DecodedPreview } from '../cameras/useRealtimePreview';

if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    strokeRect: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn().mockReturnValue({ width: 50 }),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
}

if (typeof SVGElement !== 'undefined') {
  SVGElement.prototype.getBoundingClientRect = vi.fn().mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: 640,
    height: 480,
    right: 640,
    bottom: 480,
  });
}

const previewState = vi.hoisted(() => ({
  preview: null as DecodedPreview | null,
  status: 'LIVE' as 'LIVE' | 'REPLAY' | 'UNAVAILABLE' | 'CONNECTING' | null,
  sourceKind: 'LIVE' as 'LIVE' | 'REPLAY' | null,
  errorStatus: null as number | null,
  enabled: undefined as boolean | undefined,
}));

vi.mock('../cameras/useScopedCameraPreview', () => ({
  useScopedCameraPreview: (options: {
    apiUrl?: string;
    token?: string | null;
    sessionScope?: string | null;
    siteId?: string | null;
    cameraId?: string | null;
    enabled?: boolean;
  }) => {
    // Assert no credentialId is passed to useScopedCameraPreview
    expect((options as Record<string, unknown>).credentialId).toBeUndefined();
    previewState.enabled = options.enabled;

    return {
      preview: previewState.preview,
      status: previewState.status ?? (previewState.preview ? 'LIVE' : 'UNAVAILABLE'),
      sourceKind: previewState.sourceKind ?? 'LIVE',
      error: null,
      errorStatus: previewState.errorStatus ?? null,
      isError: previewState.errorStatus !== null,
      isLoading: false,
      isPolling: Boolean(previewState.preview),
      retry: vi.fn(),
      cameraExternalId: previewState.preview?.frame.cameraExternalId ?? null,
      capturedAt: previewState.preview?.frame.capturedAt ?? null,
    };
  },
}));

function mockPreview(
  cameraExternalId = 'CAM-EXT-01',
  capturedAt = new Date().toISOString(),
): DecodedPreview {
  return {
    image: {} as HTMLImageElement,
    frame: {
      sessionId: '00000000-0000-4000-8000-000000000001',
      sequenceNumber: '1',
      cameraExternalId,
      capturedAt,
      width: 640,
      height: 480,
      imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      zonePolygons: [],
      detections: [],
      zoneDetections: [],
    },
  };
}

const mockZones: ZoneResponse[] = [
  {
    id: 'zone-1',
    siteId: 'site-alpha',
    code: 'ZONE-A1',
    name: 'Hazardous Scaffold Area',
    type: 'HAZARDOUS',
    restrictionPolicy: 'NONE',
    requiredPpe: ['HARD_HAT', 'SAFETY_VEST'],
    configurationLocked: false,
    createdAt: '2026-10-07T00:00:00Z',
  },
  {
    id: 'zone-2',
    siteId: 'site-alpha',
    code: 'ZONE-A2',
    name: 'Helmet Only Area',
    type: 'HAZARDOUS',
    restrictionPolicy: 'NONE',
    requiredPpe: ['HARD_HAT'],
    configurationLocked: false,
    createdAt: '2026-10-07T00:00:00Z',
  },
];

const mockCamerasList: Page<CameraResponse> = {
  items: [
    {
      id: 'cam-1',
      siteId: 'site-alpha',
      externalId: 'CAM-EXT-01',
      code: 'CAM-01',
      name: 'Scaffold Camera 01',
      status: 'ACTIVE',
      configurationVersion: 3,
      createdAt: '2026-09-30T00:00:00Z',
    },
    {
      id: 'cam-2',
      siteId: 'site-alpha',
      externalId: 'CAM-EXT-02',
      code: 'CAM-02',
      name: 'Inactive Camera 02',
      status: 'INACTIVE', // Must be excluded
      configurationVersion: 1,
      createdAt: '2026-09-30T00:00:00Z',
    },
    {
      id: 'cam-cross',
      siteId: 'site-other', // Must be excluded
      externalId: 'CAM-EXT-CROSS',
      code: 'CAM-CROSS',
      name: 'Cross Site Camera',
      status: 'ACTIVE',
      configurationVersion: 1,
      createdAt: '2026-09-30T00:00:00Z',
    },
  ],
  total: 3,
};

const mockRegionsList: Page<RegionResponse> = {
  items: [
    {
      id: 'reg-1',
      cameraId: 'cam-1',
      zoneId: 'zone-1',
      polygon: {
        coordinates: [
          [0.1, 0.1],
          [0.5, 0.1],
          [0.5, 0.5],
          [0.1, 0.5],
        ],
      },
      coordinateSpace: 'NORMALIZED_0_1',
      version: 2,
      isActive: true,
      createdAt: '2026-10-07T00:00:00Z',
    },
  ],
  total: 1,
};

describe('ZonePpeCameraRegionPanel (MF05 Camera-Region Linking - Corrected Suite)', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: 0 },
      },
    });
    previewState.preview = mockPreview('CAM-EXT-01');
    previewState.status = 'LIVE';
    previewState.sourceKind = 'LIVE';

    vi.spyOn(SmartSiteManagementClient.prototype, 'listCameras').mockResolvedValue(mockCamerasList);
    vi.spyOn(SmartSiteManagementClient.prototype, 'getCamera').mockResolvedValue(
      mockCamerasList.items[0]!,
    );
    vi.spyOn(SmartSiteManagementClient.prototype, 'listRegions').mockResolvedValue(mockRegionsList);
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    previewState.preview = null;
    previewState.status = null;
    previewState.sourceKind = null;
    previewState.errorStatus = null;
    previewState.enabled = undefined;
  });

  it('keeps region metadata usable without starting preview polling or drawing while AI is paused', async () => {
    vi.stubEnv('VITE_AI_WORK_PAUSED', 'true');
    render(
      <QueryClientProvider client={queryClient}>
        <ZonePpeCameraRegionPanel
          apiUrl="http://localhost:3000"
          token="mock-token-xyz"
          sessionScope="scope-01"
          credentialId={1}
          siteId="site-alpha"
          zones={mockZones}
        />
      </QueryClientProvider>,
    );
    const start = await screen.findByRole('button', { name: /Start Drawing Region/i });
    expect(previewState.enabled).toBe(false);
    expect((start as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByLabelText(/Camera Region Drawing Canvas/i)).toBeNull();
    expect(SmartSiteManagementClient.prototype.listCameras).toHaveBeenCalled();
    await waitFor(() => expect(SmartSiteManagementClient.prototype.listRegions).toHaveBeenCalled());
  });

  it('cancels only the inline region editor with Escape and keeps the parent configuration popup open', async () => {
    const user = userEvent.setup();
    const closeConfiguration = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <PpeDialog open title="Configuration" onClose={closeConfiguration}>
          <ZonePpeCameraRegionPanel
            apiUrl="http://localhost:3000"
            token="mock-token-xyz"
            sessionScope="scope-01"
            credentialId={1}
            siteId="site-alpha"
            zones={mockZones}
          />
        </PpeDialog>
      </QueryClientProvider>,
    );
    await user.click(await screen.findByRole('button', { name: /Start Drawing Region/i }));
    const canvas = screen.getByLabelText(/Camera Region Drawing Canvas/i);
    fireEvent.click(canvas, { clientX: 100, clientY: 100 });
    fireEvent.keyDown(canvas, { key: 'Escape' });
    expect(closeConfiguration).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Configuration' })).toBeDefined();
    expect(screen.queryByLabelText(/Camera Region Drawing Canvas/i)).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: /Start Drawing Region/i }),
    );
  });

  // --------------------------------------------------------------------------
  // 1. SCOPED DROPDOWNS & ALLOW REPLAY AS WELL AS LIVE
  // --------------------------------------------------------------------------
  it('renders selectors, excludes inactive/cross-site cameras, and allows REPLAY status for demo', async () => {
    // Demo runs in REPLAY mode!
    previewState.status = 'REPLAY';
    previewState.sourceKind = 'REPLAY';

    render(
      <QueryClientProvider client={queryClient}>
        <ZonePpeCameraRegionPanel
          apiUrl="http://localhost:3000"
          token="mock-token-xyz"
          sessionScope="scope-01"
          credentialId={1}
          siteId="site-alpha"
          zones={mockZones}
        />
      </QueryClientProvider>,
    );

    // Section title
    expect(
      await screen.findByRole('heading', { name: /Link Zone to Camera Region/i }),
    ).toBeDefined();

    // Zone selector contains mockZones
    const zoneSelect = screen.getByLabelText(/Select Zone/i) as HTMLSelectElement;
    expect(zoneSelect).toBeDefined();
    expect(
      screen.getByRole('option', { name: /ZONE-A1 · Hazardous Scaffold Area/i }),
    ).toBeDefined();
    expect(screen.getByRole('option', { name: /ZONE-A2 · Helmet Only Area/i })).toBeDefined();

    // Camera selector contains only ACTIVE camera on site-alpha
    const cameraSelect = await screen.findByLabelText(/Select Camera/i);
    expect(cameraSelect).toBeDefined();
    expect(screen.getByRole('option', { name: /CAM-01 · Scaffold Camera 01/i })).toBeDefined();

    // INACTIVE and cross-site cameras are strictly excluded
    expect(screen.queryByRole('option', { name: /Inactive Camera 02/i })).toBeNull();
    expect(screen.queryByRole('option', { name: /Cross Site Camera/i })).toBeNull();

    // Button is enabled in REPLAY mode
    const startBtn = screen.getByRole('button', { name: /Start Drawing Region/i });
    expect((startBtn as HTMLButtonElement).disabled).toBe(false);

    // Query keys must omit token
    const queries = queryClient.getQueryCache().findAll();
    for (const query of queries) {
      expect(JSON.stringify(query.queryKey)).not.toContain('mock-token-xyz');
    }
  });

  // --------------------------------------------------------------------------
  // 2. PREVIEW GUARD: UNAVAILABLE OR MISMATCHED CAMERA PREVENTS DRAWING
  // --------------------------------------------------------------------------
  it('disables drawing when camera snapshot preview is unavailable or externalId mismatches', async () => {
    // 2A: Preview UNAVAILABLE
    previewState.preview = null;
    previewState.status = 'UNAVAILABLE';

    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <ZonePpeCameraRegionPanel
          apiUrl="http://localhost:3000"
          token="mock-token-xyz"
          sessionScope="scope-01"
          credentialId={1}
          siteId="site-alpha"
          zones={mockZones}
        />
      </QueryClientProvider>,
    );

    const startBtn = await screen.findByRole('button', { name: /Start Drawing Region/i });
    expect((startBtn as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Camera snapshot preview unavailable/i)).toBeDefined();
    unmount();

    // 2B: Preview belongs to a different camera externalId (CAM-EXT-MISMATCH !== CAM-EXT-01)
    previewState.preview = mockPreview('CAM-EXT-MISMATCH');
    previewState.status = 'LIVE';

    render(
      <QueryClientProvider client={queryClient}>
        <ZonePpeCameraRegionPanel
          apiUrl="http://localhost:3000"
          token="mock-token-xyz"
          sessionScope="scope-01"
          credentialId={1}
          siteId="site-alpha"
          zones={mockZones}
        />
      </QueryClientProvider>,
    );

    const startBtnMismatch = await screen.findByRole('button', { name: /Start Drawing Region/i });
    expect((startBtnMismatch as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Preview external ID does not match selected camera/i)).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // 3. DRAWING INTERACTION, SCALED GEOMETRY & OUT-OF-BOUNDS REJECTION (NEVER CLAMP)
  // --------------------------------------------------------------------------
  it('freezes frame on drawing start, rejects out-of-bounds clicks, and records normalized SVG coordinates', async () => {
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={queryClient}>
        <ZonePpeCameraRegionPanel
          apiUrl="http://localhost:3000"
          token="mock-token-xyz"
          sessionScope="scope-01"
          credentialId={1}
          siteId="site-alpha"
          zones={mockZones}
        />
      </QueryClientProvider>,
    );

    const startBtn = await screen.findByRole('button', { name: /Start Drawing Region/i });
    await user.click(startBtn);

    const svgCanvas = await screen.findByLabelText(/Camera Region Drawing Canvas/i);
    expect(svgCanvas.parentElement?.style.aspectRatio).toBe('640 / 480');
    expect(svgCanvas).toBeDefined();

    // 3A: Out-of-bounds click (e.g. negative clientX or clientX > width) -> NEVER CLAMP; REJECT!
    fireEvent.click(svgCanvas, { clientX: -20, clientY: 100 });
    expect(
      await screen.findByText(/Clicked coordinates are outside the camera frame/i),
    ).toBeDefined();
    expect(screen.getByText(/Points: 0 \/ 32/i)).toBeDefined(); // No point added!

    // 3B: Valid clicks: Point 1 (64, 48) -> [0.1, 0.1]
    fireEvent.click(svgCanvas, { clientX: 64, clientY: 48 });
    expect(screen.getByText(/Points: 1 \/ 32/i)).toBeDefined();

    // Point 2 (512, 48) -> [0.8, 0.1]
    fireEvent.click(svgCanvas, { clientX: 512, clientY: 48 });
    // Point 3 (512, 384) -> [0.8, 0.8]
    fireEvent.click(svgCanvas, { clientX: 512, clientY: 384 });

    expect(screen.getByText(/Points: 3 \/ 32/i)).toBeDefined();

    // 3C: SVG attributes and scaled points match rendered dimensions
    expect(svgCanvas.getAttribute('viewBox')).toBe('0 0 640 480');
    const image = svgCanvas.querySelector('image');
    expect(image?.getAttribute('width')).toBe('640');
    expect(image?.getAttribute('height')).toBe('480');

    const polyline = svgCanvas.querySelector('polyline');
    expect(polyline?.getAttribute('points')).toBe('64,48 512,48 512,384');

    const circles = svgCanvas.querySelectorAll('circle');
    expect(circles.length).toBe(3);
    expect(circles[0]?.getAttribute('cx')).toBe('64');
    expect(circles[0]?.getAttribute('cy')).toBe('48');
  });

  // --------------------------------------------------------------------------
  // 4. POINT VALIDATION: MIN 3, DUPLICATE VERTICES, ZERO DEGENERATE & OVERLAP
  // --------------------------------------------------------------------------
  it('validates min 3 points, rejects any repeated vertices, zero-degenerate area and overlapping edges', async () => {
    const user = userEvent.setup();
    const createRegionSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'createRegion');

    render(
      <QueryClientProvider client={queryClient}>
        <ZonePpeCameraRegionPanel
          apiUrl="http://localhost:3000"
          token="mock-token-xyz"
          sessionScope="scope-01"
          credentialId={1}
          siteId="site-alpha"
          zones={mockZones}
        />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('button', { name: /Start Drawing Region/i }));
    const svgCanvas = screen.getByLabelText(/Camera Region Drawing Canvas/i);
    const saveBtn = screen.getByRole('button', { name: /Save Region/i });

    // 4A: Only 2 points clicked -> save button is disabled (UX guard against incomplete polygon)
    fireEvent.click(svgCanvas, { clientX: 100, clientY: 100 });
    fireEvent.click(svgCanvas, { clientX: 200, clientY: 100 });
    expect((saveBtn as HTMLButtonElement).disabled).toBe(true);
    expect(createRegionSpy).not.toHaveBeenCalled();

    // 4B: Repeated vertex clicked (any duplicate vertex) -> rejected
    fireEvent.click(svgCanvas, { clientX: 100, clientY: 100 });
    expect(
      await screen.findByText(/A vertex with identical coordinates already exists/i),
    ).toBeDefined();
    expect(screen.getByText(/Points: 2 \/ 32/i)).toBeDefined();

    // 4C: Zero degenerate area (collinear points with area = 0) -> rejected (zero degenerate only)
    fireEvent.click(svgCanvas, { clientX: 300, clientY: 100 });
    expect(screen.getByText(/Points: 3 \/ 32/i)).toBeDefined();
    await user.click(saveBtn);
    expect(await screen.findByText(/Polygon area must not be zero or degenerate/i)).toBeDefined();
    expect(createRegionSpy).not.toHaveBeenCalled();

    // 4D: Asymmetric crossing polygon has nonzero signed area, so it reaches the edge check.
    const resetBtn = screen.getByRole('button', { name: /Reset Drawing/i });
    await user.click(resetBtn);

    fireEvent.click(svgCanvas, { clientX: 64, clientY: 48 });
    fireEvent.click(svgCanvas, { clientX: 512, clientY: 384 });
    fireEvent.click(svgCanvas, { clientX: 64, clientY: 384 });
    fireEvent.click(svgCanvas, { clientX: 384, clientY: 48 });
    expect(screen.getByText(/Points: 4 \/ 32/i)).toBeDefined();

    await user.click(saveBtn);
    expect(
      await screen.findByText(/Polygon edges must not self-intersect or overlap/i),
    ).toBeDefined();
    expect(createRegionSpy).not.toHaveBeenCalled();

    // 4E: Maximum 32 points boundary guard
    await user.click(resetBtn);
    for (let i = 0; i < 32; i++) {
      const x = 50 + (i % 8) * 60;
      const y = 50 + Math.floor(i / 8) * 90;
      fireEvent.click(svgCanvas, { clientX: x, clientY: y });
    }
    expect(screen.getByText(/Points: 32 \/ 32/i)).toBeDefined();

    // 33rd point attempt -> rejected
    fireEvent.click(svgCanvas, { clientX: 590, clientY: 450 });
    expect(await screen.findByText(/Maximum 32 points allowed per region polygon/i)).toBeDefined();
    expect(screen.getByText(/Points: 32 \/ 32/i)).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // 5. UNDO & RESET CONTROLS (BUTTONS, SHORTCUTS, IGNORE TYPING IN INPUTS)
  // --------------------------------------------------------------------------
  it('supports undo and reset, ignoring global typing z in inputs but honoring shortcuts on canvas', async () => {
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={queryClient}>
        <ZonePpeCameraRegionPanel
          apiUrl="http://localhost:3000"
          token="mock-token-xyz"
          sessionScope="scope-01"
          credentialId={1}
          siteId="site-alpha"
          zones={mockZones}
        />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('button', { name: /Start Drawing Region/i }));
    const svgCanvas = screen.getByLabelText(/Camera Region Drawing Canvas/i);

    // Add 3 points
    fireEvent.click(svgCanvas, { clientX: 100, clientY: 100 });
    fireEvent.click(svgCanvas, { clientX: 300, clientY: 100 });
    fireEvent.click(svgCanvas, { clientX: 300, clientY: 300 });
    expect(screen.getByText(/Points: 3 \/ 32/i)).toBeDefined();

    // 5A: Typing 'z' in an input element does NOT trigger undo
    const dummyInput = document.createElement('input');
    document.body.appendChild(dummyInput);
    dummyInput.focus();
    fireEvent.keyDown(dummyInput, { key: 'z' });
    expect(screen.getByText(/Points: 3 \/ 32/i)).toBeDefined(); // Still 3!
    document.body.removeChild(dummyInput);

    // 5B: Button Undo
    const undoBtn = screen.getByRole('button', { name: /Undo Point/i });
    await user.click(undoBtn);
    expect(screen.getByText(/Points: 2 \/ 32/i)).toBeDefined();

    // 5C: Keyboard 'z' undo on canvas
    fireEvent.keyDown(svgCanvas, { key: 'z' });
    expect(screen.getByText(/Points: 1 \/ 32/i)).toBeDefined();

    // 5D: Keyboard 'Ctrl+z' undo
    fireEvent.click(svgCanvas, { clientX: 200, clientY: 100 });
    expect(screen.getByText(/Points: 2 \/ 32/i)).toBeDefined();
    fireEvent.keyDown(svgCanvas, { key: 'z', ctrlKey: true });
    expect(screen.getByText(/Points: 1 \/ 32/i)).toBeDefined();

    // 5E: Keyboard 'Escape' resets and exits drawing mode
    fireEvent.keyDown(svgCanvas, { key: 'Escape' });
    expect(screen.queryByLabelText(/Camera Region Drawing Canvas/i)).toBeNull();
    expect(screen.getByRole('button', { name: /Start Drawing Region/i })).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // 6. FRESH CAMERA QUERY, ACTIVE STATUS GUARD & VISIBLE REGION ID / VERSION
  // --------------------------------------------------------------------------
  it('checks fresh getCamera active status before POST, invalidates queries and displays regionId and version', async () => {
    const user = userEvent.setup();

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    // 6A: If fresh camera returns INACTIVE, abort POST
    vi.spyOn(SmartSiteManagementClient.prototype, 'getCamera').mockResolvedValueOnce({
      ...mockCamerasList.items[0]!,
      status: 'INACTIVE', // Inactive camera!
    });
    const createRegionSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'createRegion');

    render(
      <QueryClientProvider client={queryClient}>
        <ZonePpeCameraRegionPanel
          apiUrl="http://localhost:3000"
          token="mock-token-xyz"
          sessionScope="scope-01"
          credentialId={1}
          siteId="site-alpha"
          zones={mockZones}
        />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('button', { name: /Start Drawing Region/i }));
    const svgCanvas = screen.getByLabelText(/Camera Region Drawing Canvas/i);

    fireEvent.click(svgCanvas, { clientX: 64, clientY: 48 });
    fireEvent.click(svgCanvas, { clientX: 512, clientY: 48 });
    fireEvent.click(svgCanvas, { clientX: 512, clientY: 384 });

    const saveBtn = screen.getByRole('button', { name: /Save Region/i });
    await user.click(saveBtn);

    // Blocked before POST
    expect(createRegionSpy).not.toHaveBeenCalled();
    expect(await screen.findByText(/Camera metadata changed or became inactive/i)).toBeDefined();

    // 6B: Valid fresh camera saves and shows regionId and version
    vi.spyOn(SmartSiteManagementClient.prototype, 'getCamera').mockResolvedValueOnce({
      ...mockCamerasList.items[0]!,
      status: 'ACTIVE',
      configurationVersion: 7,
    });
    createRegionSpy.mockResolvedValueOnce({
      region: {
        id: 'reg-new-99',
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
        version: 1,
        isActive: true,
        createdAt: '2026-10-07T12:00:00Z',
      },
      configurationVersion: 8,
    });

    await user.click(saveBtn);

    expect(createRegionSpy).toHaveBeenCalledTimes(1);
    expect(createRegionSpy).toHaveBeenCalledWith('mock-token-xyz', 'site-alpha', 'cam-1', {
      zoneId: 'zone-1',
      polygon: {
        coordinates: [
          [0.1, 0.1],
          [0.8, 0.1],
          [0.8, 0.8],
        ],
      },
      expectedConfigurationVersion: 7,
    });

    // Visible regionId and version in success feedback
    expect(
      await screen.findByText(
        /Saved region "reg-new-99" \(v1\)\. Select this region for the AI worker and apply\/restart it before monitoring uses it\./i,
      ),
    ).toBeDefined();

    // Verified query invalidations: cameras-for-region and zones
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: queryClient
          .getQueryCache()
          .getAll()
          .find((query) => query.queryKey.at(-2) === 'cameras-for-region')!
          .queryKey.slice(0, -1),
      }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ['ppe-monitoring', 'http://localhost:3000', 'scope-01', 1, 'site-alpha', 'zones'],
      }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ['zone-admin', 'http://localhost:3000', 'scope-01', 'site-alpha', 'cam-1'],
    });
  });

  // --------------------------------------------------------------------------
  // 7. EXISTING LINKED REGIONS DISPLAY & DUPLICATE DRAFT SAVE BLOCK
  // --------------------------------------------------------------------------
  it('displays existing linked regions for chosen Zone/Camera and blocks saving identical draft twice', async () => {
    const user = userEvent.setup();

    const createRegionSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'createRegion')
      .mockResolvedValue({
        region: {
          id: 'reg-dup',
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
          version: 1,
          isActive: true,
          createdAt: '2026-10-07T12:00:00Z',
        },
        configurationVersion: 5,
      });

    render(
      <QueryClientProvider client={queryClient}>
        <ZonePpeCameraRegionPanel
          apiUrl="http://localhost:3000"
          token="mock-token-xyz"
          sessionScope="scope-01"
          credentialId={1}
          siteId="site-alpha"
          zones={mockZones}
        />
      </QueryClientProvider>,
    );

    // Displays existing region reg-1
    expect(await screen.findByText(/Existing Regions for this Camera & Zone/i)).toBeDefined();
    expect(await screen.findByText('reg-1')).toBeDefined();

    // Save first time
    await user.click(await screen.findByRole('button', { name: /Start Drawing Region/i }));
    const svgCanvas = screen.getByLabelText(/Camera Region Drawing Canvas/i);

    fireEvent.click(svgCanvas, { clientX: 64, clientY: 48 });
    fireEvent.click(svgCanvas, { clientX: 512, clientY: 48 });
    fireEvent.click(svgCanvas, { clientX: 512, clientY: 384 });

    const saveBtn = screen.getByRole('button', { name: /Save Region/i });
    await user.click(saveBtn);

    expect(createRegionSpy).toHaveBeenCalledTimes(1);

    // Save second time with same draft points -> blocked
    await user.click(saveBtn);
    expect(await screen.findByText(/This polygon draft has already been saved/i)).toBeDefined();
    expect(createRegionSpy).toHaveBeenCalledTimes(1);
  });

  // --------------------------------------------------------------------------
  // 8. DOUBLE SUBMIT PREVENTION WHILE MUTATION IS PENDING
  // --------------------------------------------------------------------------
  it('prevents double submissions while region creation mutation is in-flight', async () => {
    const user = userEvent.setup();

    let resolveMutation!: (value: RegionMutationResponse) => void;
    const createRegionSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'createRegion')
      .mockReturnValue(
        new Promise<RegionMutationResponse>((resolve) => {
          resolveMutation = resolve;
        }),
      );

    render(
      <QueryClientProvider client={queryClient}>
        <ZonePpeCameraRegionPanel
          apiUrl="http://localhost:3000"
          token="mock-token-xyz"
          sessionScope="scope-01"
          credentialId={1}
          siteId="site-alpha"
          zones={mockZones}
        />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('button', { name: /Start Drawing Region/i }));
    const svgCanvas = screen.getByLabelText(/Camera Region Drawing Canvas/i);

    fireEvent.click(svgCanvas, { clientX: 64, clientY: 48 });
    fireEvent.click(svgCanvas, { clientX: 512, clientY: 48 });
    fireEvent.click(svgCanvas, { clientX: 512, clientY: 384 });

    const saveBtn = screen.getByRole('button', { name: /Save Region/i });
    await user.click(saveBtn);

    expect(createRegionSpy).toHaveBeenCalledTimes(1);
    expect((saveBtn as HTMLButtonElement).disabled).toBe(true);

    // Second click ignored
    await user.click(saveBtn);
    expect(createRegionSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveMutation({
        region: {
          id: 'reg-inflight',
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
          version: 1,
          isActive: true,
          createdAt: '2026-10-07T12:00:00Z',
        },
        configurationVersion: 4,
      });
    });

    expect(await screen.findByText(/Saved region "reg-inflight" \(v1\)/i)).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // 9. REMOUNT KEYED OPAQUE SCOPE ID: CAMERA OR ZONE CHANGE RESETS CANVAS
  // --------------------------------------------------------------------------
  it('synchronously resets drawing canvas on camera or zone change via keyed remount', async () => {
    const user = userEvent.setup();

    render(
      <QueryClientProvider client={queryClient}>
        <ZonePpeCameraRegionPanel
          apiUrl="http://localhost:3000"
          token="mock-token-xyz"
          sessionScope="scope-01"
          credentialId={1}
          siteId="site-alpha"
          zones={mockZones}
        />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('button', { name: /Start Drawing Region/i }));
    const svgCanvas = screen.getByLabelText(/Camera Region Drawing Canvas/i);

    fireEvent.click(svgCanvas, { clientX: 64, clientY: 48 });
    expect(await screen.findByText(/Points: 1 \/ 32/i)).toBeDefined();

    // User switches Zone
    const zoneSelect = screen.getByLabelText(/Select Zone/i);
    await user.selectOptions(zoneSelect, 'zone-2');

    // Drawing canvas is synchronously unmounted / cleared
    expect(screen.queryByLabelText(/Camera Region Drawing Canvas/i)).toBeNull();
  });

  // --------------------------------------------------------------------------
  // 10. TRANSIENT STREAM LOSS: HIDES STALE IMAGE, RETAINS DRAFT POINTS & SAVES
  // --------------------------------------------------------------------------
  it('hides stale image but retains numeric draft points and save capability during transient preview loss', async () => {
    const user = userEvent.setup();
    const createRegionSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'createRegion')
      .mockResolvedValueOnce({
        region: {
          id: 'reg-transient-1',
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
          version: 1,
          isActive: true,
          createdAt: '2026-10-07T12:00:00Z',
        },
        configurationVersion: 4,
      });

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <ZonePpeCameraRegionPanel
          apiUrl="http://localhost:3000"
          token="mock-token-xyz"
          sessionScope="scope-01"
          credentialId={1}
          siteId="site-alpha"
          zones={mockZones}
        />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('button', { name: /Start Drawing Region/i }));
    const svgCanvas = screen.getByLabelText(/Camera Region Drawing Canvas/i);
    expect(svgCanvas).not.toBeNull();
    expect(svgCanvas.querySelector('image')).not.toBeNull();

    // User draws 3 points
    fireEvent.click(svgCanvas, { clientX: 64, clientY: 48 });
    fireEvent.click(svgCanvas, { clientX: 512, clientY: 48 });
    fireEvent.click(svgCanvas, { clientX: 512, clientY: 384 });
    expect(screen.getByText(/Points: 3 \/ 32/i)).toBeDefined();

    // Stream drops to UNAVAILABLE (e.g. transient 503 or polling gap)
    previewState.preview = null;
    previewState.status = 'UNAVAILABLE';

    rerender(
      <QueryClientProvider client={queryClient}>
        <ZonePpeCameraRegionPanel
          apiUrl="http://localhost:3000"
          token="mock-token-xyz"
          sessionScope="scope-01"
          credentialId={1}
          siteId="site-alpha"
          zones={mockZones}
        />
      </QueryClientProvider>,
    );

    // Canvas is NOT reset! Safe numeric draft is retained!
    expect(screen.getByLabelText(/Camera Region Drawing Canvas/i)).not.toBeNull();
    expect(screen.getByText(/Points: 3 \/ 32/i)).toBeDefined();

    // Stale image element is hidden to never display expired frozen pixels
    expect(svgCanvas.querySelector('image')).toBeNull();

    // User can still save region without drawer reset or abort
    const saveBtn = screen.getByRole('button', { name: /Save Region/i });
    expect((saveBtn as HTMLButtonElement).disabled).toBe(false);
    await user.click(saveBtn);

    expect(createRegionSpy).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Saved region "reg-transient-1" \(v1\)/i)).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // 11. REVISION CONFLICT (409) REFRESHES VERSION WITHOUT AUTOMATIC POST RETRY
  // --------------------------------------------------------------------------
  it('handles 409 revision conflict by refreshing version without automatic POST retry', async () => {
    const user = userEvent.setup();

    const getCameraSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'getCamera');
    const createRegionSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'createRegion')
      .mockRejectedValueOnce(new ApiError('http', 'Configuration version conflict', 409));

    render(
      <QueryClientProvider client={queryClient}>
        <ZonePpeCameraRegionPanel
          apiUrl="http://localhost:3000"
          token="mock-token-xyz"
          sessionScope="scope-01"
          credentialId={1}
          siteId="site-alpha"
          zones={mockZones}
        />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('button', { name: /Start Drawing Region/i }));
    const svgCanvas = screen.getByLabelText(/Camera Region Drawing Canvas/i);

    fireEvent.click(svgCanvas, { clientX: 64, clientY: 48 });
    fireEvent.click(svgCanvas, { clientX: 512, clientY: 48 });
    fireEvent.click(svgCanvas, { clientX: 512, clientY: 384 });

    const saveBtn = screen.getByRole('button', { name: /Save Region/i });
    await user.click(saveBtn);

    expect(
      await screen.findByText(
        /Configuration version conflict\. Camera configuration was updated by another operator/i,
      ),
    ).toBeDefined();

    expect(getCameraSpy).toHaveBeenCalled();
    // MUST NOT automatically fire createRegion again
    expect(createRegionSpy).toHaveBeenCalledTimes(1);
  });

  // --------------------------------------------------------------------------
  // 12. WRONG-SCOPE RESPONSE, SAFE 401/403 & NO RAW NETWORK ERROR LEAK
  // --------------------------------------------------------------------------
  it('guards against wrong-scope response, displays safe 401/403 and never leaks raw network errors', async () => {
    const user = userEvent.setup();

    // 12A: Mismatched returned cameraId
    vi.spyOn(SmartSiteManagementClient.prototype, 'createRegion').mockResolvedValueOnce({
      region: {
        id: 'reg-wrong',
        cameraId: 'cam-WRONG',
        zoneId: 'zone-1',
        polygon: {
          coordinates: [
            [0.1, 0.1],
            [0.8, 0.1],
            [0.8, 0.8],
          ],
        },
        coordinateSpace: 'NORMALIZED_0_1',
        version: 1,
        isActive: true,
        createdAt: '2026-10-07T12:00:00Z',
      },
      configurationVersion: 4,
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ZonePpeCameraRegionPanel
          apiUrl="http://localhost:3000"
          token="mock-token-xyz"
          sessionScope="scope-01"
          credentialId={1}
          siteId="site-alpha"
          zones={mockZones}
        />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('button', { name: /Start Drawing Region/i }));
    const svgCanvas = screen.getByLabelText(/Camera Region Drawing Canvas/i);

    fireEvent.click(svgCanvas, { clientX: 64, clientY: 48 });
    fireEvent.click(svgCanvas, { clientX: 512, clientY: 48 });
    fireEvent.click(svgCanvas, { clientX: 512, clientY: 384 });

    const saveBtn = screen.getByRole('button', { name: /Save Region/i });
    await user.click(saveBtn);

    expect(screen.queryByText(/Saved region/i)).toBeNull();
    expect(
      await screen.findByText(/Region was created with an unexpected camera or zone scope/i),
    ).toBeDefined();

    // 12B: 401 Unauthorized safe text
    vi.spyOn(SmartSiteManagementClient.prototype, 'createRegion').mockRejectedValueOnce(
      new ApiError('http', 'Secret auth token leak: eyJhbGciOi...', 401),
    );
    await user.click(saveBtn);
    expect(
      await screen.findByText(/Session expired or unauthorized\. Please sign in again\./i),
    ).toBeDefined();
    expect(screen.queryByText(/Secret auth token leak/i)).toBeNull();

    // 12C: 403 Forbidden safe text
    vi.spyOn(SmartSiteManagementClient.prototype, 'createRegion').mockRejectedValueOnce(
      new ApiError('http', 'Secret RBAC denial trace at internal/auth', 403),
    );
    await user.click(saveBtn);
    expect(
      await screen.findByText('You do not have permission to perform this action.'),
    ).toBeDefined();
    expect(screen.queryByText(/Secret RBAC denial trace/i)).toBeNull();

    // 12D: Network raw error leakage prevented
    vi.spyOn(SmartSiteManagementClient.prototype, 'createRegion').mockRejectedValueOnce(
      new Error('fetch failed at http://192.168.1.99:8080/private-internal-route'),
    );
    await user.click(saveBtn);
    expect(
      await screen.findByText(
        /Failed to save observation region\. Please verify your inputs and try again\./i,
      ),
    ).toBeDefined();
    expect(screen.queryByText(/private-internal-route/i)).toBeNull();
  });

  // --------------------------------------------------------------------------
  // 13. TERMINAL REVOCATION: 401, 403, 404 IMMEDIATELY RESETS DRAWER
  // --------------------------------------------------------------------------
  it('immediately resets drawer and clears drawing scope on 401, 403, or 404 revocation', async () => {
    const user = userEvent.setup();

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <ZonePpeCameraRegionPanel
          apiUrl="http://localhost:3000"
          token="mock-token-xyz"
          sessionScope="scope-01"
          credentialId={1}
          siteId="site-alpha"
          zones={mockZones}
        />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('button', { name: /Start Drawing Region/i }));
    expect(screen.getByLabelText(/Camera Region Drawing Canvas/i)).not.toBeNull();

    // 13A: 401 Unauthorized revocation
    previewState.errorStatus = 401;
    previewState.status = 'UNAVAILABLE';

    rerender(
      <QueryClientProvider client={queryClient}>
        <ZonePpeCameraRegionPanel
          apiUrl="http://localhost:3000"
          token="mock-token-xyz"
          sessionScope="scope-01"
          credentialId={1}
          siteId="site-alpha"
          zones={mockZones}
        />
      </QueryClientProvider>,
    );

    // Drawing canvas is synchronously unmounted / cleared
    expect(screen.queryByLabelText(/Camera Region Drawing Canvas/i)).toBeNull();

    // 13B: 403 Forbidden revocation
    previewState.errorStatus = null;
    previewState.status = 'LIVE';
    previewState.preview = mockPreview('CAM-EXT-01');

    rerender(
      <QueryClientProvider client={queryClient}>
        <ZonePpeCameraRegionPanel
          apiUrl="http://localhost:3000"
          token="mock-token-xyz"
          sessionScope="scope-01"
          credentialId={1}
          siteId="site-alpha"
          zones={mockZones}
        />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('button', { name: /Start Drawing Region/i }));
    expect(screen.getByLabelText(/Camera Region Drawing Canvas/i)).not.toBeNull();

    previewState.errorStatus = 403;
    rerender(
      <QueryClientProvider client={queryClient}>
        <ZonePpeCameraRegionPanel
          apiUrl="http://localhost:3000"
          token="mock-token-xyz"
          sessionScope="scope-01"
          credentialId={1}
          siteId="site-alpha"
          zones={mockZones}
        />
      </QueryClientProvider>,
    );
    expect(screen.queryByLabelText(/Camera Region Drawing Canvas/i)).toBeNull();

    // 13C: 404 Not Found revocation
    previewState.errorStatus = null;
    previewState.status = 'LIVE';
    rerender(
      <QueryClientProvider client={queryClient}>
        <ZonePpeCameraRegionPanel
          apiUrl="http://localhost:3000"
          token="mock-token-xyz"
          sessionScope="scope-01"
          credentialId={1}
          siteId="site-alpha"
          zones={mockZones}
        />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('button', { name: /Start Drawing Region/i }));
    expect(screen.getByLabelText(/Camera Region Drawing Canvas/i)).not.toBeNull();

    previewState.errorStatus = 404;
    rerender(
      <QueryClientProvider client={queryClient}>
        <ZonePpeCameraRegionPanel
          apiUrl="http://localhost:3000"
          token="mock-token-xyz"
          sessionScope="scope-01"
          credentialId={1}
          siteId="site-alpha"
          zones={mockZones}
        />
      </QueryClientProvider>,
    );
    expect(screen.queryByLabelText(/Camera Region Drawing Canvas/i)).toBeNull();
  });

  // --------------------------------------------------------------------------
  // 14. SECOND START DRAWING DOES NOT IMMEDIATELY DISAPPEAR ON JITTER
  // --------------------------------------------------------------------------
  it('preserves drawing mode when second Start Drawing is initiated despite transient status jitter', async () => {
    const user = userEvent.setup();

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <ZonePpeCameraRegionPanel
          apiUrl="http://localhost:3000"
          token="mock-token-xyz"
          sessionScope="scope-01"
          credentialId={1}
          siteId="site-alpha"
          zones={mockZones}
        />
      </QueryClientProvider>,
    );

    // First drawing session started and closed via Esc
    await user.click(await screen.findByRole('button', { name: /Start Drawing Region/i }));
    expect(screen.getByLabelText(/Camera Region Drawing Canvas/i)).not.toBeNull();
    fireEvent.keyDown(screen.getByLabelText(/Camera Region Drawing Canvas/i), { key: 'Escape' });
    expect(screen.queryByLabelText(/Camera Region Drawing Canvas/i)).toBeNull();

    // Second start drawing initiated
    const startBtn = screen.getByRole('button', { name: /Start Drawing Region/i });
    await user.click(startBtn);
    expect(screen.getByLabelText(/Camera Region Drawing Canvas/i)).not.toBeNull();

    // Transient jitter in preview stream (e.g. CONNECTING)
    previewState.status = 'CONNECTING';

    rerender(
      <QueryClientProvider client={queryClient}>
        <ZonePpeCameraRegionPanel
          apiUrl="http://localhost:3000"
          token="mock-token-xyz"
          sessionScope="scope-01"
          credentialId={1}
          siteId="site-alpha"
          zones={mockZones}
        />
      </QueryClientProvider>,
    );

    // Drawer must NOT immediately disappear!
    expect(screen.getByLabelText(/Camera Region Drawing Canvas/i)).not.toBeNull();
  });

  // --------------------------------------------------------------------------
  // 15. EXPIRED FROZEN PIXELS (>5s) HIDDEN WHILE RETAINING NUMERIC DRAFT
  // --------------------------------------------------------------------------
  it('hides expired frozen frame pixels (>5s) while retaining safe vector draft points', async () => {
    const user = userEvent.setup();

    // Preview frame with capturedAt 10 seconds ago
    const staleFrame = mockPreview('CAM-EXT-01');
    staleFrame.frame.capturedAt = new Date(Date.now() - 10000).toISOString();
    previewState.preview = staleFrame;

    render(
      <QueryClientProvider client={queryClient}>
        <ZonePpeCameraRegionPanel
          apiUrl="http://localhost:3000"
          token="mock-token-xyz"
          sessionScope="scope-01"
          credentialId={1}
          siteId="site-alpha"
          zones={mockZones}
        />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('button', { name: /Start Drawing Region/i }));
    const svgCanvas = screen.getByLabelText(/Camera Region Drawing Canvas/i);
    expect(svgCanvas).not.toBeNull();

    // Image must NOT be displayed because pixels are expired (>5s)
    expect(svgCanvas.querySelector('image')).toBeNull();

    // But vector drawing and clicks still function safely
    fireEvent.click(svgCanvas, { clientX: 64, clientY: 48 });
    expect(screen.getByText(/Points: 1 \/ 32/i)).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // 16. WRONG SOURCE WHILE DRAWING: IMMEDIATE REVOCATION ON EXTERNAL ID MISMATCH
  // --------------------------------------------------------------------------
  it('immediately revokes drawing scope and unmounts drawer when fresh preview externalId mismatches selected camera', async () => {
    const user = userEvent.setup();

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <ZonePpeCameraRegionPanel
          apiUrl="http://localhost:3000"
          token="mock-token-xyz"
          sessionScope="scope-01"
          credentialId={1}
          siteId="site-alpha"
          zones={mockZones}
        />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('button', { name: /Start Drawing Region/i }));
    const svgCanvas = screen.getByLabelText(/Camera Region Drawing Canvas/i);
    expect(svgCanvas).not.toBeNull();

    // User draws 2 points
    fireEvent.click(svgCanvas, { clientX: 64, clientY: 48 });
    fireEvent.click(svgCanvas, { clientX: 512, clientY: 48 });
    expect(screen.getByText(/Points: 2 \/ 32/i)).toBeDefined();

    // Fresh preview arrives with wrong source cameraExternalId (CAM-EXT-WRONG !== CAM-EXT-01)
    previewState.preview = mockPreview('CAM-EXT-WRONG');
    previewState.status = 'LIVE';

    rerender(
      <QueryClientProvider client={queryClient}>
        <ZonePpeCameraRegionPanel
          apiUrl="http://localhost:3000"
          token="mock-token-xyz"
          sessionScope="scope-01"
          credentialId={1}
          siteId="site-alpha"
          zones={mockZones}
        />
      </QueryClientProvider>,
    );

    // Drawing canvas is immediately revoked and unmounted
    expect(screen.queryByLabelText(/Camera Region Drawing Canvas/i)).toBeNull();
  });

  // --------------------------------------------------------------------------
  // 17. SELECTION CHANGE CLEARS STALE SUCCESS FEEDBACK AND LAST SAVED DRAFT
  // --------------------------------------------------------------------------
  it('immediately clears stale success feedback and lastSavedDraft when zone or camera selection changes', async () => {
    const user = userEvent.setup();

    vi.spyOn(SmartSiteManagementClient.prototype, 'createRegion').mockResolvedValue({
      region: {
        id: 'reg-saved-zone-1',
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
        version: 1,
        isActive: true,
        createdAt: '2026-10-07T12:00:00Z',
      },
      configurationVersion: 4,
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ZonePpeCameraRegionPanel
          apiUrl="http://localhost:3000"
          token="mock-token-xyz"
          sessionScope="scope-01"
          credentialId={1}
          siteId="site-alpha"
          zones={mockZones}
        />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('button', { name: /Start Drawing Region/i }));
    const svgCanvas = screen.getByLabelText(/Camera Region Drawing Canvas/i);

    fireEvent.click(svgCanvas, { clientX: 64, clientY: 48 });
    fireEvent.click(svgCanvas, { clientX: 512, clientY: 48 });
    fireEvent.click(svgCanvas, { clientX: 512, clientY: 384 });

    const saveBtn = screen.getByRole('button', { name: /Save Region/i });
    await user.click(saveBtn);

    // Success feedback is displayed
    expect(await screen.findByRole('status')).toBeDefined();
    expect(screen.getByText(/Saved region "reg-saved-zone-1"/i)).toBeDefined();

    // User switches Zone to ZONE-A2
    const zoneSelect = screen.getByLabelText(/Select Zone/i);
    await user.selectOptions(zoneSelect, 'zone-2');

    // Stale success feedback is immediately cleared!
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText(/Saved region "reg-saved-zone-1"/i)).toBeNull();
  });

  // --------------------------------------------------------------------------
  // 18. WRONG CAMERA SELECTION: IMMEDIATELY CLEARS DRAWING CANVAS
  // --------------------------------------------------------------------------
  it('immediately clears drawing canvas when user switches to a different camera', async () => {
    const user = userEvent.setup();

    vi.spyOn(SmartSiteManagementClient.prototype, 'listCameras').mockResolvedValueOnce({
      items: [
        mockCamerasList.items[0]!, // cam-1
        {
          id: 'cam-other-active',
          siteId: 'site-alpha',
          externalId: 'CAM-EXT-02-ACTIVE',
          code: 'CAM-02-ACTIVE',
          name: 'Active Camera 02',
          status: 'ACTIVE',
          configurationVersion: 1,
          createdAt: '2026-09-30T00:00:00Z',
        },
      ],
      total: 2,
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ZonePpeCameraRegionPanel
          apiUrl="http://localhost:3000"
          token="mock-token-xyz"
          sessionScope="scope-01"
          credentialId={1}
          siteId="site-alpha"
          zones={mockZones}
        />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('button', { name: /Start Drawing Region/i }));
    expect(screen.getByLabelText(/Camera Region Drawing Canvas/i)).not.toBeNull();

    // User switches to different camera (wrong camera)
    const cameraSelect = screen.getByLabelText(/Select Camera/i);
    await user.selectOptions(cameraSelect, 'cam-other-active');

    // Drawing canvas is immediately revoked / cleared
    expect(screen.queryByLabelText(/Camera Region Drawing Canvas/i)).toBeNull();
  });
});
