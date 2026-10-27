// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  SmartSiteManagementClient,
  ApiError,
  CONFIGURATION_REFERENCE_LIFETIME_MS,
} from '@smartsite/api-client';
import type {
  CameraConfigurationImageReference,
  Page,
  ReferenceRegionMutationResponse,
  ZoneResponse,
} from '@smartsite/api-client';
import type { CameraResponse, RegionResponse } from '@smartsite/contracts';
import { ZonePpeCameraRegionPanel } from './ZonePpeCameraRegionPanel';
import { confirmReferenceViewCheckbox } from './ZonePpeCameraRegionPanel.reference.fixtures';
import { PpeDialog } from './PpeDialog';
import type {
  CameraConfigurationReference,
  UseCameraConfigurationReferenceOptions,
  UseCameraConfigurationReferenceResult,
} from './useCameraConfigurationReference';

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

const refState = vi.hoisted(() => ({
  reference: null as CameraConfigurationReference | null,
  isLoading: false,
  error: null as ApiError | null,
  lastOptions: null as UseCameraConfigurationReferenceOptions | null,
  requestImpl: null as (() => Promise<void>) | null,
  requestSpy: vi.fn<() => Promise<void>>(),
}));

vi.mock('./useCameraConfigurationReference', () => ({
  useCameraConfigurationReference: (
    options: UseCameraConfigurationReferenceOptions,
  ): UseCameraConfigurationReferenceResult => {
    refState.lastOptions = options;
    return {
      reference: options.enabled ? refState.reference : null,
      isLoading: refState.isLoading,
      error: refState.error,
      request: refState.requestSpy,
    };
  },
}));

const DEFAULT_REF_ID = '00000000-0000-4000-8000-000000000099';
const DEFAULT_ACTOR_ID = '00000000-0000-4000-8000-000000000077';

function mockConfigurationReference(
  overrides: Partial<
    Omit<CameraConfigurationReference, 'frame' | 'image' | 'issuedReference'>
  > = {},
  frameOverrides: Partial<CameraConfigurationReference['frame']> = {},
  issuedOverrides: Partial<CameraConfigurationImageReference> = {},
): CameraConfigurationReference {
  const nowMs = Date.now();
  const capturedAt = frameOverrides.capturedAt ?? new Date(nowMs).toISOString();
  const capturedMs = Date.parse(capturedAt);
  const referenceExpiresAt =
    overrides.referenceExpiresAt ??
    new Date(
      (Number.isFinite(capturedMs) ? capturedMs : nowMs) + CONFIGURATION_REFERENCE_LIFETIME_MS,
    ).toISOString();
  const siteId = overrides.siteId ?? 'site-alpha';
  const cameraId = overrides.cameraId ?? 'cam-1';
  const configurationVersion = overrides.configurationVersion ?? 3;
  const sourceKind = overrides.sourceKind ?? 'LIVE';
  const frame = {
    sessionId: '00000000-0000-4000-8000-000000000001',
    sequenceNumber: '1',
    cameraExternalId: 'CAM-EXT-01',
    capturedAt,
    width: 640,
    height: 480,
    imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
    imageSha256: 'a'.repeat(64),
    ...frameOverrides,
  };
  return {
    schemaVersion: 1,
    purpose: 'REGION_CONFIGURATION',
    siteId,
    cameraId,
    configurationVersion,
    sourceKind,
    referenceExpiresAt,
    ...overrides,
    frame,
    issuedReference: {
      schemaVersion: '1.0.0',
      purpose: 'REGION_CONFIGURATION',
      sourceKind,
      referenceId: DEFAULT_REF_ID,
      siteId,
      cameraId,
      sessionId: frame.sessionId,
      imageSha256: frame.imageSha256,
      width: frame.width,
      height: frame.height,
      capturedAt: frame.capturedAt,
      issuedAt: frame.capturedAt,
      expiresAt: referenceExpiresAt,
      configurationVersion,
      viewRevision: 1,
      ...issuedOverrides,
    },
    image: {} as HTMLImageElement,
  };
}

function mockConfirmedMutation(
  id: string,
  coordinates: [number, number][],
  configurationVersion = 4,
  regionOverrides: Partial<ReferenceRegionMutationResponse['region']> = {},
): ReferenceRegionMutationResponse {
  return {
    region: {
      id,
      cameraId: 'cam-1',
      zoneId: 'zone-1',
      polygon: { coordinates },
      coordinateSpace: 'NORMALIZED_0_1',
      version: 1,
      isActive: true,
      createdAt: '2026-10-07T12:00:00Z',
      geometryConfirmation: {
        status: 'MANUALLY_CONFIRMED',
        referenceId: DEFAULT_REF_ID,
        viewRevision: 1,
        confirmedByUserId: DEFAULT_ACTOR_ID,
        confirmedAt: '2026-10-07T12:00:00.000Z',
      },
      ...regionOverrides,
    },
    configurationVersion,
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
    refState.reference = mockConfigurationReference();
    refState.isLoading = false;
    refState.error = null;
    refState.lastOptions = null;
    refState.requestImpl = null;
    refState.requestSpy = vi.fn(async () => {
      await refState.requestImpl?.();
    });

    vi.spyOn(SmartSiteManagementClient.prototype, 'listCameras').mockResolvedValue(mockCamerasList);
    vi.spyOn(SmartSiteManagementClient.prototype, 'getCamera').mockResolvedValue(
      mockCamerasList.items[0]!,
    );
    vi.spyOn(SmartSiteManagementClient.prototype, 'listRegions').mockResolvedValue(mockRegionsList);
  });

  afterEach(() => {
    cleanup();
    queryClient.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    refState.reference = null;
    refState.isLoading = false;
    refState.error = null;
    refState.lastOptions = null;
    refState.requestImpl = null;
  });

  it('keeps region metadata and explicit configuration reference request usable without auto-fetching or making preview/AI calls while AI is paused', async () => {
    vi.stubEnv('VITE_AI_WORK_PAUSED', 'true');
    const user = userEvent.setup();
    refState.reference = null;

    const previewSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'getCameraPreview');
    const streamSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'streamCameraVideo');
    const recordSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'readRecordedCameraVideo');
    const demoStatusSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'getMf05DemoStatus');
    const demoApplySpy = vi.spyOn(SmartSiteManagementClient.prototype, 'applyMf05DemoRegion');

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
    await waitFor(() => {
      expect(refState.lastOptions).toEqual({
        client: expect.any(SmartSiteManagementClient),
        apiUrl: 'http://localhost:3000',
        token: 'mock-token-xyz',
        sessionScope: 'scope-01',
        credentialId: 1,
        siteId: 'site-alpha',
        cameraId: 'cam-1',
        cameraExternalId: 'CAM-EXT-01',
        enabled: true,
      });
    });
    expect(refState.requestSpy).not.toHaveBeenCalled();
    expect((start as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByLabelText(/Camera Region Drawing Canvas/i)).toBeNull();
    expect(SmartSiteManagementClient.prototype.listCameras).toHaveBeenCalled();
    await waitFor(() => expect(SmartSiteManagementClient.prototype.listRegions).toHaveBeenCalled());

    const getRefBtn = screen.getByRole('button', { name: /Get configuration image/i });
    expect((getRefBtn as HTMLButtonElement).disabled).toBe(false);
    await user.click(getRefBtn);
    expect(refState.requestSpy).toHaveBeenCalledTimes(1);
    expect(previewSpy).not.toHaveBeenCalled();
    expect(streamSpy).not.toHaveBeenCalled();
    expect(recordSpy).not.toHaveBeenCalled();
    expect(demoStatusSpy).not.toHaveBeenCalled();
    expect(demoApplySpy).not.toHaveBeenCalled();
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
    expect(screen.getByText(/Discard unsaved region geometry changes\?/i)).toBeDefined();
    // Second Escape cancels confirmation (Keep Editing) and never discards or closes parent dialog
    fireEvent.keyDown(canvas, { key: 'Escape' });
    expect(closeConfiguration).not.toHaveBeenCalled();
    expect(screen.queryByText(/Discard unsaved region geometry changes\?/i)).toBeNull();
    expect(screen.getByLabelText(/Camera Region Drawing Canvas/i)).toBeDefined();
    // Explicit Discard Changes closes inline editor and restores focus to Start Drawing Region
    fireEvent.keyDown(canvas, { key: 'Escape' });
    await user.click(screen.getByRole('button', { name: /Discard Changes/i }));
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
    refState.reference = mockConfigurationReference({ sourceKind: 'REPLAY' });

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
  // 2. REFERENCE GUARD: UNAVAILABLE OR MISMATCHED CAMERA PREVENTS DRAWING
  // --------------------------------------------------------------------------
  it('disables drawing when camera configuration reference is unavailable or externalId mismatches', async () => {
    // 2A: Reference source UNAVAILABLE (503)
    refState.reference = null;
    refState.error = new ApiError('http', 'Source unavailable', 503);

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
    expect(
      screen.getByText(/Camera configuration image source is currently unavailable/i),
    ).toBeDefined();
    unmount();

    // 2B: Reference belongs to a different camera externalId (CAM-EXT-MISMATCH !== CAM-EXT-01)
    refState.reference = mockConfigurationReference({}, { cameraExternalId: 'CAM-EXT-MISMATCH' });
    refState.error = new ApiError('invalid-response', 'Invalid configuration reference');

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
    expect(screen.getByText(/Could not load camera configuration image/i)).toBeDefined();
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
    const createRegionSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'createReferenceRegion');

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
    await confirmReferenceViewCheckbox(user);
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

    await confirmReferenceViewCheckbox(user);
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

    // 5E: Keyboard 'Escape' on dirty draft opens confirmation; explicit Discard Changes exits drawing mode
    fireEvent.keyDown(svgCanvas, { key: 'Escape' });
    expect(screen.getByText(/Discard unsaved region geometry changes\?/i)).toBeDefined();
    await user.click(screen.getByRole('button', { name: /Discard Changes/i }));
    expect(screen.queryByLabelText(/Camera Region Drawing Canvas/i)).toBeNull();
    expect(screen.getByRole('button', { name: /Start Drawing Region/i })).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // 6. FRESH CAMERA QUERY, ACTIVE STATUS GUARD & VISIBLE REGION ID / VERSION
  // --------------------------------------------------------------------------
  it('checks fresh getCamera active status before POST, invalidates queries and displays regionId and version', async () => {
    const user = userEvent.setup();
    refState.reference = mockConfigurationReference({ configurationVersion: 7 });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listCameras').mockResolvedValue({
      ...mockCamerasList,
      items: mockCamerasList.items.map((camera) =>
        camera.id === 'cam-1' ? { ...camera, configurationVersion: 7 } : camera,
      ),
    });

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    // 6A: If fresh camera returns INACTIVE, abort POST
    vi.spyOn(SmartSiteManagementClient.prototype, 'getCamera').mockResolvedValueOnce({
      ...mockCamerasList.items[0]!,
      status: 'INACTIVE', // Inactive camera!
      configurationVersion: 7,
    });
    const createRegionSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'createReferenceRegion');
    const legacyCreateSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'createRegion');

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

    await confirmReferenceViewCheckbox(user);
    const saveBtn = screen.getByRole('button', { name: /Save Region/i });
    await user.click(saveBtn);

    // Blocked before POST
    expect(createRegionSpy).not.toHaveBeenCalled();
    expect(legacyCreateSpy).not.toHaveBeenCalled();
    expect(await screen.findByText(/Camera metadata changed or became inactive/i)).toBeDefined();

    // 6B: Valid fresh camera matching frozen reference revision 7 saves and shows regionId and version
    vi.spyOn(SmartSiteManagementClient.prototype, 'getCamera').mockResolvedValueOnce({
      ...mockCamerasList.items[0]!,
      status: 'ACTIVE',
      configurationVersion: 7,
    });
    createRegionSpy.mockResolvedValueOnce(
      mockConfirmedMutation(
        'reg-new-99',
        [
          [0.1, 0.1],
          [0.8, 0.1],
          [0.8, 0.8],
        ],
        8,
      ),
    );

    await user.click(saveBtn);

    expect(createRegionSpy).toHaveBeenCalledTimes(1);
    expect(legacyCreateSpy).not.toHaveBeenCalled();
    expect(createRegionSpy).toHaveBeenCalledWith(
      'mock-token-xyz',
      'site-alpha',
      'cam-1',
      {
        zoneId: 'zone-1',
        expectedConfigurationVersion: 7,
        referenceId: DEFAULT_REF_ID,
        viewRevision: 1,
        confirmReferenceView: true,
        polygon: {
          coordinates: [
            [0.1, 0.1],
            [0.8, 0.1],
            [0.8, 0.8],
          ],
        },
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

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
      .spyOn(SmartSiteManagementClient.prototype, 'createReferenceRegion')
      .mockResolvedValue(
        mockConfirmedMutation('reg-dup', [
          [0.1, 0.1],
          [0.8, 0.1],
          [0.8, 0.8],
        ]),
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

    // Displays existing region reg-1
    expect(await screen.findByText(/Existing Regions for this Camera & Zone/i)).toBeDefined();
    expect(await screen.findByText('reg-1')).toBeDefined();

    // Save first time
    await user.click(await screen.findByRole('button', { name: /Start Drawing Region/i }));
    const svgCanvas = screen.getByLabelText(/Camera Region Drawing Canvas/i);

    fireEvent.click(svgCanvas, { clientX: 64, clientY: 48 });
    fireEvent.click(svgCanvas, { clientX: 512, clientY: 48 });
    fireEvent.click(svgCanvas, { clientX: 512, clientY: 384 });

    await confirmReferenceViewCheckbox(user);
    const saveBtn = screen.getByRole('button', { name: /Save Region/i });
    await user.click(saveBtn);

    expect(createRegionSpy).toHaveBeenCalledTimes(1);

    // Save second time with same draft points -> blocked
    await screen.findByText(/Saved region "reg-dup" \(v1\)/i);
    await confirmReferenceViewCheckbox(user);
    await user.click(screen.getByRole('button', { name: /Save Region/i }));
    expect(await screen.findByText(/This polygon draft has already been saved/i)).toBeDefined();
    expect(createRegionSpy).toHaveBeenCalledTimes(1);
  });

  // --------------------------------------------------------------------------
  // 8. DOUBLE SUBMIT PREVENTION WHILE MUTATION IS PENDING
  // --------------------------------------------------------------------------
  it('prevents double submissions while region creation mutation is in-flight', async () => {
    const user = userEvent.setup();

    let resolveMutation!: (value: ReferenceRegionMutationResponse) => void;
    const createRegionSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'createReferenceRegion')
      .mockReturnValue(
        new Promise<ReferenceRegionMutationResponse>((resolve) => {
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

    await confirmReferenceViewCheckbox(user);
    const saveBtn = screen.getByRole('button', { name: /Save Region/i });
    await user.click(saveBtn);

    expect(createRegionSpy).toHaveBeenCalledTimes(1);
    expect((saveBtn as HTMLButtonElement).disabled).toBe(true);

    // Second click ignored
    await user.click(saveBtn);
    expect(createRegionSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveMutation(
        mockConfirmedMutation('reg-inflight', [
          [0.1, 0.1],
          [0.8, 0.1],
          [0.8, 0.8],
        ]),
      );
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

    // User switches Zone
    const zoneSelect = screen.getByLabelText(/Select Zone/i);
    await user.selectOptions(zoneSelect, 'zone-2');

    // Drawing canvas is synchronously unmounted / cleared
    expect(screen.queryByLabelText(/Camera Region Drawing Canvas/i)).toBeNull();
  });

  // --------------------------------------------------------------------------
  // 10. TRANSIENT SOURCE FAILURE: PRESERVES VALID FROZEN REFERENCE & DRAFT POINTS
  // --------------------------------------------------------------------------
  it('preserves valid frozen reference image, numeric draft points, and save capability during transient source failure (503)', async () => {
    const user = userEvent.setup();
    const createRegionSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'createReferenceRegion')
      .mockResolvedValueOnce(
        mockConfirmedMutation('reg-transient-1', [
          [0.1, 0.1],
          [0.8, 0.1],
          [0.8, 0.8],
        ]),
      );

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

    // Transient source failure (503) while frozen reference is still within 5-minute referenceExpiresAt
    refState.reference = null;
    refState.error = new ApiError('http', 'Configuration reference source unavailable', 503);

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

    // Canvas is NOT reset; valid frozen reference and numeric draft points are retained
    expect(screen.getByLabelText(/Camera Region Drawing Canvas/i)).not.toBeNull();
    expect(screen.getByText(/Points: 3 \/ 32/i)).toBeDefined();
    expect(svgCanvas.querySelector('image')).not.toBeNull();
    expect(
      screen.getByText(/Camera configuration image source is currently unavailable/i),
    ).toBeDefined();

    // User can still save region against the unexpired frozen reference
    await confirmReferenceViewCheckbox(user);
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
      .spyOn(SmartSiteManagementClient.prototype, 'createReferenceRegion')
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

    await confirmReferenceViewCheckbox(user);
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
    vi.spyOn(SmartSiteManagementClient.prototype, 'createReferenceRegion').mockResolvedValueOnce(
      mockConfirmedMutation(
        'reg-wrong',
        [
          [0.1, 0.1],
          [0.8, 0.1],
          [0.8, 0.8],
        ],
        4,
        { cameraId: 'cam-WRONG' },
      ),
    );

    async function openDraft() {
      const view = render(
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
      await confirmReferenceViewCheckbox(user);

      return {
        saveBtn: screen.getByRole('button', { name: /Save Region/i }),
        unmount: view.unmount,
      };
    }
    let { saveBtn, unmount } = await openDraft();
    await user.click(saveBtn);

    expect(screen.queryByText(/Saved region/i)).toBeNull();
    expect(
      await screen.findByText(/Region was created with an unexpected camera or zone scope/i),
    ).toBeDefined();

    // 12B: 401 Unauthorized safe text
    vi.spyOn(SmartSiteManagementClient.prototype, 'createReferenceRegion').mockRejectedValueOnce(
      new ApiError('http', 'Secret auth token leak: eyJhbGciOi...', 401),
    );
    await user.click(saveBtn);
    expect(
      await screen.findByText(/Session expired or unauthorized\. Please sign in again\./i),
    ).toBeDefined();
    expect(screen.queryByText(/Secret auth token leak/i)).toBeNull();

    unmount();
    ({ saveBtn, unmount } = await openDraft());
    // 12C: 403 Forbidden safe text
    vi.spyOn(SmartSiteManagementClient.prototype, 'createReferenceRegion').mockRejectedValueOnce(
      new ApiError('http', 'Secret RBAC denial trace at internal/auth', 403),
    );
    await user.click(saveBtn);
    expect(
      await screen.findByText('You do not have permission to perform this action.'),
    ).toBeDefined();
    expect(screen.queryByText(/Secret RBAC denial trace/i)).toBeNull();

    unmount();
    ({ saveBtn } = await openDraft());
    // 12D: Network raw error leakage prevented
    vi.spyOn(SmartSiteManagementClient.prototype, 'createReferenceRegion').mockRejectedValueOnce(
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
    refState.reference = null;
    refState.error = new ApiError('http', 'Unauthorized', 401);

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
    refState.error = null;
    refState.reference = mockConfigurationReference();

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

    refState.reference = null;
    refState.error = new ApiError('http', 'Forbidden', 403);
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
    refState.error = null;
    refState.reference = mockConfigurationReference();
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

    refState.reference = null;
    refState.error = new ApiError('http', 'Not found', 404);
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
  it('preserves drawing mode when second Start Drawing is initiated despite transient loading state', async () => {
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

    // Transient loading state while candidate reference is being requested
    refState.isLoading = true;

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
  // 15. EXPIRED FROZEN PIXELS (referenceExpiresAt) HIDDEN WHILE RETAINING DRAFT
  // --------------------------------------------------------------------------
  it('hides expired frozen reference pixels after referenceExpiresAt while retaining safe vector draft points and disabling Save Region', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const baseNow = Date.parse('2026-10-15T09:00:00.000Z');
    vi.setSystemTime(baseNow);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });

    refState.reference = mockConfigurationReference(
      { referenceExpiresAt: '2026-10-15T09:05:00.000Z' },
      { capturedAt: '2026-10-15T09:00:00.000Z' },
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
    expect(svgCanvas).not.toBeNull();

    fireEvent.click(svgCanvas, { clientX: 64, clientY: 48 });
    fireEvent.click(svgCanvas, { clientX: 512, clientY: 48 });
    fireEvent.click(svgCanvas, { clientX: 512, clientY: 384 });
    expect(screen.getByText(/Points: 3 \/ 32/i)).toBeDefined();
    await confirmReferenceViewCheckbox(user);

    // Still valid after 10s (beyond 5s monitoring preview TTL, within 5-minute referenceExpiresAt)
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(svgCanvas.querySelector('image')).not.toBeNull();
    expect(
      (screen.getByRole('button', { name: /Save Region/i }) as HTMLButtonElement).disabled,
    ).toBe(false);

    // Advance past 5-minute referenceExpiresAt
    act(() => {
      vi.advanceTimersByTime(CONFIGURATION_REFERENCE_LIFETIME_MS);
    });

    // Image must NOT be displayed once referenceExpiresAt has passed
    expect(svgCanvas.querySelector('image')).toBeNull();
    expect(
      (screen.getByRole('button', { name: /Save Region/i }) as HTMLButtonElement).disabled,
    ).toBe(true);

    // Vector geometry draft points are retained
    expect(screen.getByText(/Points: 3 \/ 32/i)).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // 16. WRONG SOURCE WHILE DRAWING: IMMEDIATE REVOCATION ON EXTERNAL ID MISMATCH
  // --------------------------------------------------------------------------
  it('immediately revokes drawing scope and unmounts drawer when camera externalId changes and mismatches frozen reference', async () => {
    const user = userEvent.setup();

    let currentCamerasPage: Page<CameraResponse> = mockCamerasList;
    vi.spyOn(SmartSiteManagementClient.prototype, 'listCameras').mockImplementation(
      async () => currentCamerasPage,
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
    expect(svgCanvas).not.toBeNull();

    // User draws 2 points
    fireEvent.click(svgCanvas, { clientX: 64, clientY: 48 });
    fireEvent.click(svgCanvas, { clientX: 512, clientY: 48 });
    expect(screen.getByText(/Points: 2 \/ 32/i)).toBeDefined();

    // Camera externalId changes on backend (CAM-EXT-WRONG !== frozen CAM-EXT-01)
    currentCamerasPage = {
      items: [
        {
          ...mockCamerasList.items[0]!,
          externalId: 'CAM-EXT-WRONG',
        },
      ],
      total: 1,
    };

    await act(async () => {
      await queryClient.refetchQueries({
        predicate: (query) => query.queryKey.includes('cameras-for-region'),
      });
    });

    // Query notifications must deliver the changed metadata before the DOM assertion.
    await waitFor(() =>
      expect(screen.queryByLabelText(/Camera Region Drawing Canvas/i)).toBeNull(),
    );
  });

  // --------------------------------------------------------------------------
  // 17. SELECTION CHANGE CLEARS STALE SUCCESS FEEDBACK AND LAST SAVED DRAFT
  // --------------------------------------------------------------------------
  it('immediately clears stale success feedback and lastSavedDraft when zone or camera selection changes', async () => {
    const user = userEvent.setup();

    vi.spyOn(SmartSiteManagementClient.prototype, 'createReferenceRegion').mockResolvedValue(
      mockConfirmedMutation('reg-saved-zone-1', [
        [0.1, 0.1],
        [0.8, 0.1],
        [0.8, 0.8],
      ]),
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

    await confirmReferenceViewCheckbox(user);
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

  // --------------------------------------------------------------------------
  // 19. REOPEN EXISTING REGION, UPDATE POLYGON WITHOUT CREATE FALLBACK & ROUND-TRIP
  // --------------------------------------------------------------------------
  it('reopens existing region geometry, updates via updateReferencePolygon without create/legacy fallback on 409, and round-trips saved coordinates', async () => {
    const user = userEvent.setup();
    const createRegionSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'createReferenceRegion');
    const legacyCreateSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'createRegion');
    const legacyUpdateSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'updatePolygon');
    const updatePolygonSpy = vi.spyOn(
      SmartSiteManagementClient.prototype,
      'updateReferencePolygon',
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

    const editBtn = await screen.findByRole('button', { name: /Edit Geometry/i });
    await user.click(editBtn);

    const svgCanvas = screen.getByLabelText(/Camera Region Drawing Canvas/i);
    expect(screen.getByText(/Points: 4 \/ 32/i)).toBeDefined();
    expect(screen.getByText(/Editing Region reg-1 \(v2\)/i)).toBeDefined();

    // Clean reopened draft closes immediately on single Escape
    fireEvent.keyDown(svgCanvas, { key: 'Escape' });
    expect(screen.queryByLabelText(/Camera Region Drawing Canvas/i)).toBeNull();

    // Reopen again and nudge Vertex 1 right by 10px (64 -> 74 => 74/640 = 0.1156)
    await user.click(screen.getByRole('button', { name: /Edit Geometry/i }));
    const vertex1 = screen.getByRole('button', { name: /Vertex 1/i });
    act(() => vertex1.focus());
    fireEvent.keyDown(vertex1, { key: 'ArrowRight', shiftKey: true });
    expect(vertex1.getAttribute('cx')).toBe('73.984'); // 0.1156 * 640

    // 19A: 409 conflict on updateReferencePolygon refreshes camera version without auto-retry and NEVER falls back
    updatePolygonSpy.mockRejectedValueOnce(
      new ApiError('http', 'Configuration version conflict', 409),
    );
    await confirmReferenceViewCheckbox(user);
    const saveBtn = screen.getByRole('button', { name: /Save Region/i });
    await user.click(saveBtn);

    expect(updatePolygonSpy).toHaveBeenCalledTimes(1);
    expect(createRegionSpy).not.toHaveBeenCalled();
    expect(legacyCreateSpy).not.toHaveBeenCalled();
    expect(legacyUpdateSpy).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/Configuration version conflict\. Camera configuration was updated/i),
    ).toBeDefined();

    // 19B: Successful updateReferencePolygon updates region version and round-trips new geometry on reopen
    const updatedCoords: [number, number][] = [
      [0.1156, 0.1],
      [0.5, 0.1],
      [0.5, 0.5],
      [0.1, 0.5],
    ];
    vi.spyOn(SmartSiteManagementClient.prototype, 'listRegions').mockResolvedValue({
      items: [
        {
          ...mockRegionsList.items[0]!,
          polygon: { coordinates: updatedCoords },
          version: 3,
        },
      ],
      total: 1,
    });
    updatePolygonSpy.mockResolvedValueOnce(
      mockConfirmedMutation('reg-1', updatedCoords, 4, { version: 3 }),
    );

    await user.click(saveBtn);
    expect(updatePolygonSpy).toHaveBeenCalledTimes(2);
    expect(updatePolygonSpy).toHaveBeenLastCalledWith(
      'mock-token-xyz',
      'site-alpha',
      'cam-1',
      'reg-1',
      {
        expectedConfigurationVersion: 3,
        referenceId: DEFAULT_REF_ID,
        viewRevision: 1,
        confirmReferenceView: true,
        polygon: { coordinates: updatedCoords },
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(createRegionSpy).not.toHaveBeenCalled();
    expect(legacyCreateSpy).not.toHaveBeenCalled();
    expect(legacyUpdateSpy).not.toHaveBeenCalled();
    expect(await screen.findByText(/Saved region "reg-1" \(v3\)/i)).toBeDefined();

    // Close clean saved editor and reopen to verify round-tripped v3 coordinates
    fireEvent.keyDown(screen.getByLabelText(/Camera Region Drawing Canvas/i), { key: 'Escape' });
    expect(screen.queryByLabelText(/Camera Region Drawing Canvas/i)).toBeNull();
    await user.click(await screen.findByRole('button', { name: /Edit Geometry/i }));
    expect(screen.getByText(/Editing Region reg-1 \(v3\)/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /Vertex 1/i }).getAttribute('cx')).toBe('73.984');
  });

  // --------------------------------------------------------------------------
  // 20. EXISTING-REGION OPTIMISTIC REVISION: PREFLIGHT STALE CFG VERSION BLOCK
  // --------------------------------------------------------------------------
  it('existing-region optimistic revision: blocks updateReferencePolygon and shows safe 409 conflict while retaining draft when getCamera preflight returns cfg2 after opening at cfg1', async () => {
    vi.stubEnv('VITE_AI_WORK_PAUSED', 'false');
    const user = userEvent.setup();
    refState.reference = mockConfigurationReference({ configurationVersion: 1 });

    const camCfg1: CameraResponse = {
      ...mockCamerasList.items[0]!,
      configurationVersion: 1,
    };
    const camCfg2: CameraResponse = {
      ...camCfg1,
      configurationVersion: 2,
    };

    vi.spyOn(SmartSiteManagementClient.prototype, 'listCameras').mockResolvedValue({
      items: [camCfg1],
      total: 1,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listRegions').mockResolvedValue({
      items: [{ ...mockRegionsList.items[0]!, version: 1 }],
      total: 1,
    });

    const getCameraSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'getCamera')
      .mockResolvedValue(camCfg2);
    const updatePolygonSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'updateReferencePolygon')
      .mockRejectedValue(new ApiError('http', 'Configuration version conflict', 409));
    const createRegionSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'createReferenceRegion')
      .mockRejectedValue(new Error('Unexpected create fallback in isolated fixture'));
    const legacyUpdateSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'updatePolygon');
    const legacyCreateSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'createRegion');

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

    const editBtn = await screen.findByRole('button', { name: /Edit Geometry/i });
    await user.click(editBtn);

    expect(screen.getByText(/Editing Region reg-1 \(v1\)/i)).toBeDefined();
    const vertex1 = screen.getByRole('button', { name: /Vertex 1/i });
    act(() => vertex1.focus());
    fireEvent.keyDown(vertex1, { key: 'ArrowRight', shiftKey: true });
    expect(vertex1.getAttribute('cx')).toBe('73.984');

    await confirmReferenceViewCheckbox(user);
    const saveBtn = screen.getByRole('button', { name: /Save Region/i });
    await user.click(saveBtn);

    expect(
      await screen.findByText(
        /Configuration version conflict\. Camera configuration was updated by another operator/i,
      ),
    ).toBeDefined();
    expect(getCameraSpy).toHaveBeenCalledTimes(1);
    expect(updatePolygonSpy).not.toHaveBeenCalled();
    expect(createRegionSpy).not.toHaveBeenCalled();
    expect(legacyUpdateSpy).not.toHaveBeenCalled();
    expect(legacyCreateSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(/Saved region/i)).toBeNull();
    expect(screen.getByLabelText(/Camera Region Drawing Canvas/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /Vertex 1/i }).getAttribute('cx')).toBe('73.984');
  });

  // --------------------------------------------------------------------------
  // 21. EXISTING-REGION OPTIMISTIC REVISION: CONCURRENT WRITE 409 AFTER GET
  // --------------------------------------------------------------------------
  it('existing-region optimistic revision: sends expectedConfigurationVersion 1 on updateReferencePolygon and does not auto-retry or fallback when PATCH rejects with 409 and refetch sees cfg2', async () => {
    vi.stubEnv('VITE_AI_WORK_PAUSED', 'false');
    const user = userEvent.setup();
    refState.reference = mockConfigurationReference({ configurationVersion: 1 });

    const camCfg1: CameraResponse = {
      ...mockCamerasList.items[0]!,
      configurationVersion: 1,
    };
    const camCfg2: CameraResponse = {
      ...camCfg1,
      configurationVersion: 2,
    };

    const listCamerasSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listCameras')
      .mockResolvedValueOnce({ items: [camCfg1], total: 1 })
      .mockResolvedValue({ items: [camCfg2], total: 1 });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listRegions').mockResolvedValue({
      items: [{ ...mockRegionsList.items[0]!, version: 1 }],
      total: 1,
    });

    const getCameraSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'getCamera')
      .mockResolvedValue(camCfg1);
    const updatePolygonSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'updateReferencePolygon')
      .mockRejectedValue(new ApiError('http', 'Configuration version conflict', 409));
    const createRegionSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'createReferenceRegion')
      .mockRejectedValue(new Error('Unexpected create fallback in isolated fixture'));
    const legacyUpdateSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'updatePolygon');
    const legacyCreateSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'createRegion');

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

    const editBtn = await screen.findByRole('button', { name: /Edit Geometry/i });
    await user.click(editBtn);

    expect(screen.getByText(/Editing Region reg-1 \(v1\)/i)).toBeDefined();
    const vertex1 = screen.getByRole('button', { name: /Vertex 1/i });
    act(() => vertex1.focus());
    fireEvent.keyDown(vertex1, { key: 'ArrowRight', shiftKey: true });
    expect(vertex1.getAttribute('cx')).toBe('73.984');

    await confirmReferenceViewCheckbox(user);
    const saveBtn = screen.getByRole('button', { name: /Save Region/i });
    await user.click(saveBtn);

    expect(
      await screen.findByText(
        /Configuration version conflict\. Camera configuration was updated by another operator/i,
      ),
    ).toBeDefined();
    await waitFor(() => {
      expect(listCamerasSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    expect(getCameraSpy).toHaveBeenCalledTimes(1);
    expect(updatePolygonSpy).toHaveBeenCalledTimes(1);
    expect(updatePolygonSpy).toHaveBeenCalledWith(
      'mock-token-xyz',
      'site-alpha',
      'cam-1',
      'reg-1',
      {
        expectedConfigurationVersion: 1,
        referenceId: DEFAULT_REF_ID,
        viewRevision: 1,
        confirmReferenceView: true,
        polygon: {
          coordinates: [
            [0.1156, 0.1],
            [0.5, 0.1],
            [0.5, 0.5],
            [0.1, 0.5],
          ],
        },
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(createRegionSpy).not.toHaveBeenCalled();
    expect(legacyUpdateSpy).not.toHaveBeenCalled();
    expect(legacyCreateSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(/Saved region/i)).toBeNull();
    expect(screen.getByLabelText(/Camera Region Drawing Canvas/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /Vertex 1/i }).getAttribute('cx')).toBe('73.984');
  });

  // --------------------------------------------------------------------------
  // 22. POST-SAVE STALE CONFIG REVISION ON ZONE SWITCH: KEEP OLD REFERENCE UNMODIFIED,
  //     KEEP DRAWING DISABLED, SHOW LOCALIZED FRESH-IMAGE HINT, RESTORE ON FRESH V4 REQUEST
  // --------------------------------------------------------------------------
  it('keeps old reference unmodified, blocks second save without a newly issued v4 reference, keeps drawing disabled on Zone switch with fresh-image hint, and restores drawing after requesting a fresh v4 reference', async () => {
    const user = userEvent.setup();
    const initialRefV3 = mockConfigurationReference({ configurationVersion: 3 });
    refState.reference = initialRefV3;
    refState.requestImpl = async () => {
      refState.reference = mockConfigurationReference(
        { configurationVersion: 4 },
        {},
        { referenceId: '00000000-0000-4000-8000-000000000104', viewRevision: 2 },
      );
    };

    const camV3: CameraResponse = {
      ...mockCamerasList.items[0]!,
      configurationVersion: 3,
    };
    const camV4: CameraResponse = {
      ...camV3,
      configurationVersion: 4,
    };

    const listCamerasSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'listCameras')
      .mockResolvedValueOnce({ items: [camV3], total: 1 })
      .mockResolvedValue({ items: [camV4], total: 1 });
    const getCameraSpy = vi
      .spyOn(SmartSiteManagementClient.prototype, 'getCamera')
      .mockResolvedValueOnce(camV3)
      .mockResolvedValue(camV4);
    vi.spyOn(SmartSiteManagementClient.prototype, 'createReferenceRegion').mockResolvedValueOnce(
      mockConfirmedMutation('reg-zone-1-saved', [
        [0.1, 0.1],
        [0.8, 0.1],
        [0.8, 0.8],
      ]),
    );
    const updatePolygonSpy = vi.spyOn(
      SmartSiteManagementClient.prototype,
      'updateReferencePolygon',
    );

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <ZonePpeCameraRegionPanel
          apiUrl="http://localhost:3000"
          token="mock-token-xyz"
          sessionScope="scope-01"
          credentialId={1}
          siteId="site-alpha"
          initialCameraId="cam-1"
          zones={mockZones}
        />
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole('button', { name: /Start Drawing Region/i }));
    const svgCanvas = screen.getByLabelText(/Camera Region Drawing Canvas/i);
    fireEvent.click(svgCanvas, { clientX: 64, clientY: 48 });
    fireEvent.click(svgCanvas, { clientX: 512, clientY: 48 });
    fireEvent.click(svgCanvas, { clientX: 512, clientY: 384 });

    await confirmReferenceViewCheckbox(user);
    await user.click(screen.getByRole('button', { name: /Save Region/i }));
    expect(await screen.findByText(/Saved region "reg-zone-1-saved" \(v1\)/i)).toBeDefined();
    await waitFor(() => {
      expect(listCamerasSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    expect(screen.getByText('Config v3')).toBeDefined();
    expect(screen.queryByText('Config v4')).toBeNull();

    // One reference authorizes one versioned save: attempting a second save while frozenReference is still v3 conflicts closed
    expect(screen.getByText(/Editing Region reg-zone-1-saved \(v1\)/i)).toBeDefined();
    const vertex1 = screen.getByRole('button', { name: /Vertex 1/i });
    act(() => vertex1.focus());
    fireEvent.keyDown(vertex1, { key: 'ArrowRight', shiftKey: true });
    await confirmReferenceViewCheckbox(user);
    await user.click(screen.getByRole('button', { name: /Save Region/i }));
    expect(
      await screen.findByText(/Configuration version conflict\. Camera configuration was updated/i),
    ).toBeDefined();
    expect(getCameraSpy).toHaveBeenCalledTimes(2);
    expect(updatePolygonSpy).not.toHaveBeenCalled();
    expect(screen.getByText('Config v3')).toBeDefined();
    expect(screen.queryByText('Config v4')).toBeNull();

    // Operator switches to second Zone on the same camera after save bumped camera config 3 -> 4
    await user.selectOptions(screen.getByLabelText(/Select Zone/i), 'zone-2');

    // Old hook reference must remain unmodified at v3 (never relabeled to v4 without a fresh server reference)
    expect(refState.reference).toBe(initialRefV3);
    expect(refState.reference?.configurationVersion).toBe(3);
    expect(screen.getByText('Config v3')).toBeDefined();
    expect(screen.queryByText('Config v4')).toBeNull();

    // Drawing stays disabled while loaded reference (v3) lags camera configurationVersion (v4)
    const startDrawingForZone2 = screen.getByRole('button', {
      name: /Start Drawing Region/i,
    }) as HTMLButtonElement;
    expect(startDrawingForZone2.disabled).toBe(true);

    // Visible localized hint explains that a fresh configuration image must be requested
    expect(screen.getByText(/Request a (?:fresh )?configuration image/i)).toBeDefined();

    // Operator explicitly requests a fresh v4 configuration image from the server
    await user.click(screen.getByRole('button', { name: /Get configuration image/i }));
    expect(refState.requestSpy).toHaveBeenCalledTimes(1);

    rerender(
      <QueryClientProvider client={queryClient}>
        <ZonePpeCameraRegionPanel
          apiUrl="http://localhost:3000"
          token="mock-token-xyz"
          sessionScope="scope-01"
          credentialId={1}
          siteId="site-alpha"
          initialCameraId="cam-1"
          zones={mockZones}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText('Config v4')).toBeDefined();
    expect(screen.queryByText(/Request a (?:fresh )?configuration image/i)).toBeNull();
    expect(
      (screen.getByRole('button', { name: /Start Drawing Region/i }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});
