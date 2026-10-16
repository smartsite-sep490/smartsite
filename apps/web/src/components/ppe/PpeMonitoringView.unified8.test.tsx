// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import type { Page, SiteResponse, CameraResponse } from '@smartsite/contracts/management';
import { PpeMonitoringView } from './PpeMonitoringView';
import {
  parseModelObjects,
  POSITIVE_PPE_OBJECT_CLASSES,
  type CameraPreviewModelObjects,
  type RealtimePreview,
} from '../cameras/realtimePreview';
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

const previewState = vi.hoisted(() => ({
  preview: null as DecodedPreview | null,
  status: 'LIVE' as 'LIVE' | 'REPLAY' | 'UNAVAILABLE' | 'CONNECTING',
  sourceKind: 'LIVE' as 'LIVE' | 'REPLAY' | null,
  error: null as string | null,
  errorStatus: null as number | null,
  retry: vi.fn(),
}));

vi.mock('../cameras/useScopedCameraPreview', () => ({
  useScopedCameraPreview: () => ({
    preview: previewState.preview,
    status: previewState.status,
    sourceKind: previewState.sourceKind,
    error: previewState.error,
    errorStatus: previewState.errorStatus,
    isError: false,
    isLoading: false,
    isPolling: Boolean(previewState.preview),
    retry: previewState.retry,
    cameraExternalId: previewState.preview?.frame.cameraExternalId ?? null,
    capturedAt: previewState.preview?.frame.capturedAt ?? null,
  }),
}));

vi.mock('../cameras/useRealtimePreview', () => ({
  useRealtimePreview: () => ({ preview: previewState.preview, connected: true, error: null }),
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
  ],
  total: 1,
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

const SESSION_UUID = '33333333-3333-3333-3333-333333333333';

function createMockFrame(modelObjects?: CameraPreviewModelObjects): RealtimePreview {
  return {
    sessionId: SESSION_UUID,
    sequenceNumber: '100',
    cameraExternalId: 'CAM-01',
    capturedAt: new Date().toISOString(),
    width: 640,
    height: 480,
    imageDataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
    zonePolygons: [],
    detections: [],
    zoneDetections: [],
    ...(modelObjects ? { modelObjects } : {}),
  };
}

function createDecodedPreview(frame: RealtimePreview): DecodedPreview {
  const image = new Image();
  return { frame, image };
}

describe('Unified8 Real Raw-Object Eight-PPE Preview & Geometry', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });
    previewState.preview = null;
    previewState.status = 'LIVE';
    previewState.sourceKind = 'LIVE';
    previewState.error = null;
    previewState.errorStatus = null;

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
      measureText: vi.fn((text: string) => ({ width: text.length * 8 } as TextMetrics)),
      font: '',
      lineWidth: 1,
      strokeStyle: '',
      fillStyle: '',
      textBaseline: 'alphabetic',
    };

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((id: string) => {
      if (id === '2d') {
        return mockContext as unknown as CanvasRenderingContext2D;
      }
      return null;
    });

    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 640,
      height: 480,
      right: 640,
      bottom: 480,
      x: 0,
      y: 0,
      toJSON: () => {},
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

  it('fake8: renders all 8 positive PPE object families with confidence and no wearer compliance claims', () => {
    const fake8ModelObjects: CameraPreviewModelObjects = {
      modelFamily: 'yolo11s',
      experimental: true,
      scope: 'OBJECT_DETECTION_ONLY',
      artifactId: 'model-unified8-weights-v1',
      artifactSha256: 'a'.repeat(64),
      detections: [
        { classId: 0, className: 'Person', confidence: 0.98, boundingBox: { x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.9, coordinateSpace: 'NORMALIZED_0_1' } },
        { classId: 1, className: 'Hardhat', confidence: 0.95, boundingBox: { x1: 0.2, y1: 0.1, x2: 0.3, y2: 0.2, coordinateSpace: 'NORMALIZED_0_1' } },
        { classId: 3, className: 'Safety Vest', confidence: 0.92, boundingBox: { x1: 0.2, y1: 0.25, x2: 0.4, y2: 0.55, coordinateSpace: 'NORMALIZED_0_1' } },
        { classId: 5, className: 'Gloves', confidence: 0.88, boundingBox: { x1: 0.15, y1: 0.5, x2: 0.25, y2: 0.6, coordinateSpace: 'NORMALIZED_0_1' } },
        { classId: 7, className: 'Boots', confidence: 0.91, boundingBox: { x1: 0.2, y1: 0.8, x2: 0.3, y2: 0.9, coordinateSpace: 'NORMALIZED_0_1' } },
        { classId: 9, className: 'Goggles', confidence: 0.85, boundingBox: { x1: 0.22, y1: 0.15, x2: 0.28, y2: 0.18, coordinateSpace: 'NORMALIZED_0_1' } },
        { classId: 11, className: 'Mask', confidence: 0.82, boundingBox: { x1: 0.22, y1: 0.18, x2: 0.28, y2: 0.22, coordinateSpace: 'NORMALIZED_0_1' } },
        { classId: 13, className: 'fullbody-Harness', confidence: 0.89, boundingBox: { x1: 0.2, y1: 0.25, x2: 0.4, y2: 0.65, coordinateSpace: 'NORMALIZED_0_1' } },
        { classId: 14, className: 'Lanyard-Hook', confidence: 0.87, boundingBox: { x1: 0.35, y1: 0.5, x2: 0.42, y2: 0.6, coordinateSpace: 'NORMALIZED_0_1' } },
      ],
    };

    const frame = createMockFrame(fake8ModelObjects);
    previewState.preview = createDecodedPreview(frame);

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView apiUrl="http://localhost:3000" sharedSession={testSharedSession} />
      </QueryClientProvider>,
    );

    const section = screen.getByTestId('experimental-objects-section');
    expect(section).not.toBeNull();
    const scoped = within(section);

    // Section header
    expect(scoped.getByText('Experimental objects')).not.toBeNull();

    // Status badge: Object detected
    const badge = scoped.getByTestId('experimental-objects-status-badge');
    expect(badge?.textContent).toContain('Object detected');

    // All 8 positive classes are rendered with their confidence
    for (const className of POSITIVE_PPE_OBJECT_CLASSES) {
      const item = scoped.getByTestId(`model-object-item-${className}`);
      expect(item).not.toBeNull();
      expect(item?.textContent).toContain(className);
    }
    expect(scoped.getByTestId('model-object-item-Hardhat')?.textContent).toContain('95%');
    expect(scoped.getByTestId('model-object-item-Mask')?.textContent).toContain('82%');
    expect(scoped.getByTestId('model-object-item-fullbody-Harness')?.textContent).toContain('89%');
    expect(scoped.getByTestId('model-object-item-Lanyard-Hook')?.textContent).toContain('87%');

    // Never PRESENT/MISSING/compliant for the three new items (Mask, Harness, Hook)
    const maskItem = scoped.getByTestId('model-object-item-Mask');
    expect(maskItem?.textContent).not.toContain('PRESENT');
    expect(maskItem?.textContent).not.toContain('MISSING');
    expect(maskItem?.textContent).not.toContain('COMPLIANT');

    const harnessItem = scoped.getByTestId('model-object-item-fullbody-Harness');
    expect(harnessItem?.textContent).not.toContain('PRESENT');
    expect(harnessItem?.textContent).not.toContain('MISSING');

    const hookItem = scoped.getByTestId('model-object-item-Lanyard-Hook');
    expect(hookItem?.textContent).not.toContain('PRESENT');
    expect(hookItem?.textContent).not.toContain('MISSING');

    // Factual disclaimer within the experimental section (scoped to avoid outer view duplicates)
    expect(
      scoped.getByText(/Raw 15-class detector observations\. Object detection only/i),
    ).not.toBeNull();
    expect(
      scoped.getByText(/Zero detections do not certify safety clearance/i),
    ).not.toBeNull();
  });

  it('rawnegative: renders negative classes separately and does not invent negative Harness/Hook', () => {
    const rawNegativeModelObjects: CameraPreviewModelObjects = {
      modelFamily: 'yolo11s',
      experimental: true,
      scope: 'OBJECT_DETECTION_ONLY',
      artifactId: 'model-unified8-weights-v1',
      artifactSha256: 'b'.repeat(64),
      detections: [
        { classId: 2, className: 'NO-Hardhat', confidence: 0.76, boundingBox: { x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.2, coordinateSpace: 'NORMALIZED_0_1' } },
        { classId: 4, className: 'NO-Safety Vest', confidence: 0.81, boundingBox: { x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.4, coordinateSpace: 'NORMALIZED_0_1' } },
        { classId: 12, className: 'NO-Mask', confidence: 0.74, boundingBox: { x1: 0.15, y1: 0.15, x2: 0.22, y2: 0.22, coordinateSpace: 'NORMALIZED_0_1' } },
      ],
    };

    const frame = createMockFrame(rawNegativeModelObjects);
    previewState.preview = createDecodedPreview(frame);

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView apiUrl="http://localhost:3000" sharedSession={testSharedSession} />
      </QueryClientProvider>,
    );

    const section = screen.getByTestId('experimental-objects-section');
    expect(section).not.toBeNull();
    const scoped = within(section);

    // Negative items rendered in separate container
    expect(scoped.getByText('Negative observations (raw detector)')).not.toBeNull();
    expect(scoped.getByTestId('model-object-negative-NO-Hardhat')?.textContent).toContain('NO-Hardhat (76%)');
    expect(scoped.getByTestId('model-object-negative-NO-Safety Vest')?.textContent).toContain('NO-Safety Vest (81%)');
    expect(scoped.getByTestId('model-object-negative-NO-Mask')?.textContent).toContain('NO-Mask (74%)');

    // Confirm no negative classes exist for Harness or Hook in the spec/UI
    expect(scoped.queryByTestId('model-object-negative-NO-Harness')).toBeNull();
    expect(scoped.queryByTestId('model-object-negative-NO-Hook')).toBeNull();

    // Since raw detector detections exist (length > 0), badge indicates "Object detected"
    expect(scoped.getByTestId('experimental-objects-status-badge')?.textContent).toContain(
      'Object detected',
    );
  });

  it('empty: renders "No object detection in this frame" when modelObjects has empty detections, without claiming safety clear', () => {
    const emptyModelObjects: CameraPreviewModelObjects = {
      modelFamily: 'yolo11s',
      experimental: true,
      scope: 'OBJECT_DETECTION_ONLY',
      artifactId: 'model-unified8-weights-v1',
      artifactSha256: 'c'.repeat(64),
      detections: [],
    };

    const frame = createMockFrame(emptyModelObjects);
    previewState.preview = createDecodedPreview(frame);

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView apiUrl="http://localhost:3000" sharedSession={testSharedSession} />
      </QueryClientProvider>,
    );

    const section = screen.getByTestId('experimental-objects-section');
    expect(section).not.toBeNull();
    const scoped = within(section);

    // Truly empty detections -> badge indicates "No object detection in this frame"
    expect(scoped.getByTestId('experimental-objects-status-badge')?.textContent).toContain(
      'No object detection in this frame',
    );
    // Explicit empty notice in positive object container
    expect(scoped.getByText('No object detection in this frame', { selector: 'p' })).not.toBeNull();

    // Do not invent affirmative safety CLEAR status
    expect(scoped.queryByText(/\bSAFETY CLEAR\b/i)).toBeNull();
    expect(scoped.queryByText(/^CLEAR$/i)).toBeNull();
  });

  it('absent: does not render experimental-objects-section when modelObjects is omitted (old model)', () => {
    // Missing optional field means old model, not zero detected objects
    const frame = createMockFrame(undefined);
    previewState.preview = createDecodedPreview(frame);

    render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView apiUrl="http://localhost:3000" sharedSession={testSharedSession} />
      </QueryClientProvider>,
    );

    expect(screen.queryByTestId('experimental-objects-section')).toBeNull();
    expect(screen.queryByText('Experimental objects')).toBeNull();
  });

  it('canvas overlay & toggle: executes accurate normalized boundingBox stroke/tag coordinates at 640x480 and clears on next frame toggle', () => {
    const frameWithModelObjects: CameraPreviewModelObjects = {
      modelFamily: 'yolo11s',
      experimental: true,
      scope: 'OBJECT_DETECTION_ONLY',
      artifactId: 'model-unified8-weights-v1',
      artifactSha256: 'd'.repeat(64),
      detections: [
        {
          classId: 1,
          className: 'Hardhat',
          confidence: 0.95,
          boundingBox: { x1: 0.25, y1: 0.1, x2: 0.75, y2: 0.6, coordinateSpace: 'NORMALIZED_0_1' },
        },
        {
          classId: 2,
          className: 'NO-Hardhat',
          confidence: 0.8,
          boundingBox: { x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.5, coordinateSpace: 'NORMALIZED_0_1' },
        },
      ],
    };

    const frame = createMockFrame(frameWithModelObjects);
    previewState.preview = createDecodedPreview(frame);

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView apiUrl="http://localhost:3000" sharedSession={testSharedSession} />
      </QueryClientProvider>,
    );

    const section = screen.getByTestId('experimental-objects-section');
    expect(section).not.toBeNull();
    const scoped = within(section);

    const toggleBtn = scoped.getByTestId('toggle-model-objects');
    expect(toggleBtn?.textContent).toContain('Boxes Off');

    // Initially with Boxes Off, no model object strokeRect or fillText on canvas
    expect(mockContext.strokeRect).not.toHaveBeenCalledWith(160, 48, 320, 240);
    expect(mockContext.strokeRect).not.toHaveBeenCalledWith(64, 96, 128, 144);

    // 1. Toggle ON -> canvas strokes bounding boxes at exact 640x480 pixel coordinates and paints tags
    fireEvent.click(toggleBtn);
    expect(toggleBtn?.textContent).toContain('Boxes On');

    // Hardhat: x1=0.25*640=160, y1=0.1*480=48, w=(0.75-0.25)*640=320, h=(0.6-0.1)*480=240
    expect(mockContext.strokeRect).toHaveBeenCalledWith(160, 48, 320, 240);
    // Hardhat tag: top=48 -> tagTop=Math.max(0, 48-14-2)=32, textY=32+7=39, textX=160+3=163
    expect(mockContext.fillText).toHaveBeenCalledWith('Hardhat 95%', 163, 39);

    // NO-Hardhat: x1=0.1*640=64, y1=0.2*480=96, w=(0.3-0.1)*640=128, h=(0.5-0.2)*480=144
    expect(mockContext.strokeRect).toHaveBeenCalledWith(64, 96, 128, 144);
    // NO-Hardhat tag: top=96 -> tagTop=96-16=80, textY=80+7=87, textX=64+3=67
    expect(mockContext.fillText).toHaveBeenCalledWith('NO-Hardhat 80%', 67, 87);

    // 2. Toggle OFF -> clears model object overlays immediately on canvas
    mockContext.strokeRect.mockClear();
    mockContext.fillText.mockClear();

    fireEvent.click(toggleBtn);
    expect(toggleBtn?.textContent).toContain('Boxes Off');

    expect(mockContext.strokeRect).not.toHaveBeenCalledWith(160, 48, 320, 240);
    expect(mockContext.strokeRect).not.toHaveBeenCalledWith(64, 96, 128, 144);
    expect(mockContext.fillText).not.toHaveBeenCalledWith('Hardhat 95%', 163, 39);
    expect(mockContext.fillText).not.toHaveBeenCalledWith('NO-Hardhat 80%', 67, 87);

    // 3. Toggle back ON with next frame arrival: updates to new frame coordinates
    fireEvent.click(toggleBtn);
    expect(toggleBtn?.textContent).toContain('Boxes On');

    const nextFrameWithModelObjects: CameraPreviewModelObjects = {
      modelFamily: 'yolo11s',
      experimental: true,
      scope: 'OBJECT_DETECTION_ONLY',
      artifactId: 'model-unified8-weights-v1',
      artifactSha256: 'd'.repeat(64),
      detections: [
        {
          classId: 3,
          className: 'Safety Vest',
          confidence: 0.9,
          boundingBox: { x1: 0.5, y1: 0.25, x2: 0.75, y2: 0.5, coordinateSpace: 'NORMALIZED_0_1' },
        },
      ],
    };
    mockContext.strokeRect.mockClear();
    mockContext.fillText.mockClear();

    const nextFrame = createMockFrame(nextFrameWithModelObjects);
    previewState.preview = createDecodedPreview(nextFrame);

    rerender(
      <QueryClientProvider client={queryClient}>
        <PpeMonitoringView apiUrl="http://localhost:3000" sharedSession={testSharedSession} />
      </QueryClientProvider>,
    );

    // Safety Vest: x1=0.5*640=320, y1=0.25*480=120, w=(0.75-0.5)*640=160, h=(0.5-0.25)*480=120
    expect(mockContext.strokeRect).toHaveBeenCalledWith(320, 120, 160, 120);
    expect(mockContext.fillText).toHaveBeenCalledWith('Safety Vest 90%', 323, 111);
  });

  it('geometry: parseModelObjects strictly validates NORMALIZED_0_1 boundingBox and classId agreement', () => {
    const validRaw = {
      modelFamily: 'yolo11s',
      experimental: true,
      scope: 'OBJECT_DETECTION_ONLY',
      artifactId: 'weights-test',
      artifactSha256: 'f'.repeat(64),
      detections: [
        {
          classId: 13,
          className: 'fullbody-Harness',
          confidence: 0.89,
          boundingBox: {
            x1: 0.1,
            y1: 0.2,
            x2: 0.4,
            y2: 0.7,
            coordinateSpace: 'NORMALIZED_0_1',
          },
        },
      ],
    };

    const parsed = parseModelObjects(validRaw);
    expect(parsed.detections[0]?.className).toBe('fullbody-Harness');
    expect(parsed.detections[0]?.boundingBox.x1).toBe(0.1);
    expect(parsed.detections[0]?.boundingBox.x2).toBe(0.4);

    // Rejection 1: classId mismatch with className
    expect(() =>
      parseModelObjects({
        ...validRaw,
        detections: [{ ...validRaw.detections[0], className: 'Hardhat' }],
      }),
    ).toThrow(/does not match/);

    // Rejection 2: inverted box coordinates (x1 >= x2)
    expect(() =>
      parseModelObjects({
        ...validRaw,
        detections: [
          {
            ...validRaw.detections[0],
            boundingBox: { ...validRaw.detections[0]!.boundingBox, x1: 0.5, x2: 0.2 },
          },
        ],
      }),
    ).toThrow(/Invalid boundingBox/);

    // Rejection 3: out-of-range coordinate (> 1)
    expect(() =>
      parseModelObjects({
        ...validRaw,
        detections: [
          {
            ...validRaw.detections[0],
            boundingBox: { ...validRaw.detections[0]!.boundingBox, x2: 1.5 },
          },
        ],
      }),
    ).toThrow(/Invalid boundingBox/);

    // Rejection 4: unexpected extraneous property (strict allowlist)
    expect(() =>
      parseModelObjects({
        ...validRaw,
        extraRTSPUri: 'rtsp://malicious',
      }),
    ).toThrow(/Unexpected modelObjects key/);
  });
});
