// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  POSITIVE_PPE_OBJECT_CLASSES,
  NEGATIVE_PPE_OBJECT_CLASSES,
  parseScopedRealtimePreview,
  type ScopedDecodedPreview,
} from './scopedRealtimePreview';
import { ScopedRealtimePreviewCanvas } from './ScopedRealtimePreviewCanvas';

interface MockCanvasContext {
  font: string;
  textBaseline: string;
  strokeStyle: string;
  fillStyle: string;
  lineWidth: number;
  drawImage: ReturnType<typeof vi.fn>;
  beginPath: ReturnType<typeof vi.fn>;
  moveTo: ReturnType<typeof vi.fn>;
  lineTo: ReturnType<typeof vi.fn>;
  closePath: ReturnType<typeof vi.fn>;
  stroke: ReturnType<typeof vi.fn>;
  strokeRect: ReturnType<typeof vi.fn>;
  fillRect: ReturnType<typeof vi.fn>;
  fillText: ReturnType<typeof vi.fn>;
  measureText: ReturnType<typeof vi.fn>;
}

function createMockCanvasContext(): MockCanvasContext {
  return {
    font: '',
    textBaseline: 'alphabetic',
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    drawImage: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 6 })),
  };
}

function makePreviewFixture(overrides?: {
  sessionId?: string;
  sequenceNumber?: string;
  cameraExternalId?: string;
  width?: number;
  height?: number;
}): ScopedDecodedPreview {
  const width = overrides?.width ?? 640;
  const height = overrides?.height ?? 480;
  const image = document.createElement('img');
  image.width = width;
  image.height = height;

  const frame = parseScopedRealtimePreview({
    type: 'frame',
    previewVersion: 1,
    sessionId: overrides?.sessionId ?? '11111111-1111-4111-8111-111111111111',
    sequenceNumber: overrides?.sequenceNumber ?? '10',
    cameraExternalId: overrides?.cameraExternalId ?? 'cam-north-01',
    capturedAt: '2026-11-03T10:00:00.000Z',
    width,
    height,
    imageDataUrl: 'data:image/jpeg;base64,AA==',
    zonePolygons: [
      {
        regionId: 'region-alpha',
        geometryVersion: 2,
        coordinates: [
          [0.1, 0.1],
          [0.5, 0.1],
          [0.5, 0.5],
        ],
      },
    ],
    detections: [
      {
        trackId: 7,
        confidence: 0.94,
        active: true,
        label: 'Person #7',
        regionId: 'region-alpha',
        boundingBox: {
          x1: 0.2,
          y1: 0.2,
          x2: 0.4,
          y2: 0.7,
          coordinateSpace: 'NORMALIZED_0_1',
        },
        ppeStatus: {
          HARD_HAT: 'UNKNOWN',
          SAFETY_VEST: 'UNKNOWN',
          GLOVES: 'UNKNOWN',
        },
        alertState: 'UNKNOWN',
      },
    ],
    zoneDetections: [
      {
        trackId: 9,
        confidence: 0.91,
        active: true,
        label: 'Zone entry observed',
        regionId: 'region-alpha',
        boundingBox: {
          x1: 0.25,
          y1: 0.25,
          x2: 0.45,
          y2: 0.75,
          coordinateSpace: 'NORMALIZED_0_1',
        },
        ppeStatus: {
          HARD_HAT: 'UNKNOWN',
          SAFETY_VEST: 'UNKNOWN',
        },
        alertState: 'UNKNOWN',
      },
    ],
    modelObjects: {
      modelFamily: 'yolo11s',
      experimental: true,
      scope: 'OBJECT_DETECTION_ONLY',
      artifactId: 'yolo11s-ppe-v1',
      artifactSha256: 'a'.repeat(64),
      detections: [
        {
          classId: 1,
          className: POSITIVE_PPE_OBJECT_CLASSES[0], // 'Hardhat'
          confidence: 0.92,
          boundingBox: {
            x1: 0.22,
            y1: 0.21,
            x2: 0.3,
            y2: 0.3,
            coordinateSpace: 'NORMALIZED_0_1',
          },
        },
        {
          classId: 3,
          className: POSITIVE_PPE_OBJECT_CLASSES[1], // 'Safety Vest'
          confidence: 0.85,
          boundingBox: {
            x1: 0.22,
            y1: 0.32,
            x2: 0.36,
            y2: 0.52,
            coordinateSpace: 'NORMALIZED_0_1',
          },
        },
        {
          classId: 2,
          className: NEGATIVE_PPE_OBJECT_CLASSES[0], // 'NO-Hardhat'
          confidence: 0.88,
          boundingBox: {
            x1: 0.6,
            y1: 0.2,
            x2: 0.7,
            y2: 0.32,
            coordinateSpace: 'NORMALIZED_0_1',
          },
        },
        {
          classId: 0,
          className: 'Person',
          confidence: 0.96,
          boundingBox: {
            x1: 0.58,
            y1: 0.18,
            x2: 0.75,
            y2: 0.78,
            coordinateSpace: 'NORMALIZED_0_1',
          },
        },
      ],
    },
  });

  return { frame, image };
}

describe('ScopedRealtimePreviewCanvas software draw-call and accessible DOM boundaries', () => {
  let mockCtx: MockCanvasContext;

  beforeEach(() => {
    mockCtx = createMockCanvasContext();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => mockCtx as unknown as CanvasRenderingContext2D,
    );
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('resets canvas dimensions per frame, draws synchronized image and person overlays, and strokes zone polygons only in zone mode', () => {
    const firstPreview = makePreviewFixture();
    const { rerender } = render(<ScopedRealtimePreviewCanvas preview={firstPreview} mode="ppe" />);

    const canvas = screen.getByRole('region') as HTMLCanvasElement;
    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(480);
    expect(canvas.getAttribute('data-frame-id')).toBe('11111111-1111-4111-8111-111111111111:10');
    expect(mockCtx.drawImage).toHaveBeenCalledWith(firstPreview.image, 0, 0, 640, 480);
    expect(mockCtx.beginPath).not.toHaveBeenCalled();
    expect(screen.queryByText('Observation boundaries · access policy is not shown')).toBeNull();

    // Person bounding box (0.2*640=128, 0.2*480=96, 0.2*640=128, 0.5*480=240)
    const personBox = mockCtx.strokeRect.mock.calls[0]!;
    expect(personBox.slice(0, 3)).toEqual([128, 96, 128]);
    expect(personBox[3]).toBeCloseTo(240, 10);

    // Switch to a second camera frame in zone mode with new dimensions (800x600)
    const secondPreview = makePreviewFixture({
      sessionId: '22222222-2222-4222-8222-222222222222',
      sequenceNumber: '11',
      cameraExternalId: 'cam-south-02',
      width: 800,
      height: 600,
    });

    rerender(<ScopedRealtimePreviewCanvas preview={secondPreview} mode="zone" />);

    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
    expect(canvas.getAttribute('data-frame-id')).toBe('22222222-2222-4222-8222-222222222222:11');
    expect(mockCtx.drawImage).toHaveBeenLastCalledWith(secondPreview.image, 0, 0, 800, 600);
    expect(mockCtx.beginPath).toHaveBeenCalledTimes(1);
    expect(mockCtx.moveTo).toHaveBeenCalledWith(80, 60);
    expect(mockCtx.lineTo).toHaveBeenCalledWith(400, 60);
    expect(mockCtx.lineTo).toHaveBeenCalledWith(400, 300);
    expect(mockCtx.closePath).toHaveBeenCalledTimes(1);
    expect(mockCtx.stroke).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Observation boundaries · access policy is not shown')).toBeTruthy();
  });

  it('respects showModelObjects off/on and filterClasses presets without turning raw detector boxes into wearer verdicts', () => {
    const positiveClassPrimary = POSITIVE_PPE_OBJECT_CLASSES[0];
    const positiveClassSecondary = POSITIVE_PPE_OBJECT_CLASSES[1];
    const negativeClassPrimary = NEGATIVE_PPE_OBJECT_CLASSES[0];
    const preview = makePreviewFixture();

    const { rerender } = render(
      <ScopedRealtimePreviewCanvas preview={preview} mode="ppe" showModelObjects={false} />,
    );

    const textsWhenOff = mockCtx.fillText.mock.calls.map((call) => String(call[0]));
    expect(textsWhenOff).toContain('Track #7 · Chưa rõ');
    expect(textsWhenOff.some((t) => t.includes(`${positiveClassPrimary} 92%`))).toBe(false);
    expect(textsWhenOff.some((t) => t.includes(`${negativeClassPrimary} 88%`))).toBe(false);

    mockCtx.fillText.mockClear();
    mockCtx.strokeRect.mockClear();

    rerender(<ScopedRealtimePreviewCanvas preview={preview} mode="ppe" showModelObjects={true} />);

    const textsWhenOn = mockCtx.fillText.mock.calls.map((call) => String(call[0]));
    expect(textsWhenOn).toContain(`${positiveClassPrimary} 92%`);
    expect(textsWhenOn).toContain(`${positiveClassSecondary} 85%`);
    expect(textsWhenOn).toContain(`${negativeClassPrimary} 88%`);
    expect(textsWhenOn).toContain('Person 96%');

    mockCtx.fillText.mockClear();

    // Filter to only positiveClassPrimary: secondary positive PPE class is hidden, while negative & Person still render
    rerender(
      <ScopedRealtimePreviewCanvas
        preview={preview}
        mode="ppe"
        showModelObjects={true}
        filterClasses={[positiveClassPrimary]}
      />,
    );

    const textsWhenFiltered = mockCtx.fillText.mock.calls.map((call) => String(call[0]));
    expect(textsWhenFiltered).toContain(`${positiveClassPrimary} 92%`);
    expect(textsWhenFiltered).not.toContain(`${positiveClassSecondary} 85%`);
    expect(textsWhenFiltered).toContain(`${negativeClassPrimary} 88%`);
    expect(textsWhenFiltered).toContain('Person 96%');
    // Wearer badge remains UNKNOWN ('Track #7 · Chưa rõ') despite raw positive object detection
    expect(textsWhenFiltered).toContain('Track #7 · Chưa rõ');
  });

  it('renders accessible current-frame summaries, preserves UNKNOWN wearer states, and exposes frame observation details', () => {
    const positiveClassPrimary = POSITIVE_PPE_OBJECT_CLASSES[0];
    const preview = makePreviewFixture();

    const { rerender } = render(<ScopedRealtimePreviewCanvas preview={preview} mode="ppe" />);

    const srList = screen.getByRole('list', { name: 'Current frame observations' });
    expect(srList.textContent).toContain(
      'Track #7: Chưa đủ bằng chứng kỹ thuật để xác định trang bị bảo hộ trong khung hình này.',
    );
    expect(srList.textContent).toContain(`Experimental object: ${positiveClassPrimary} (92%).`);
    expect(srList.textContent).not.toMatch(/worker/i);

    const detailsRegion = screen.getByLabelText('Frame observation details');
    expect(detailsRegion.textContent).toContain('Frame (1 observation(s))');
    expect(detailsRegion.textContent).toContain('Track #7');
    expect(detailsRegion.textContent).toContain('(Region: region-alpha)');
    expect(detailsRegion.textContent).toContain('Box px: [128, 96, 128×240]');

    rerender(<ScopedRealtimePreviewCanvas preview={preview} mode="zone" />);
    expect(srList.textContent).toContain('Track #9 · Region: region-alpha: Zone entry observed.');
  });
});
