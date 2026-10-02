// @vitest-environment jsdom
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { RealtimePreviewCanvas } from './RealtimePreviewCanvas';
import type { DecodedPreview } from './useRealtimePreview';

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

function createMockDecodedPreview(overrides?: Partial<DecodedPreview['frame']>): DecodedPreview {
  const mockImage = {
    width: 640,
    height: 480,
  } as unknown as HTMLImageElement;

  return {
    frame: {
      sessionId: '00000000-0000-4000-8000-000000000001',
      sequenceNumber: '100',
      cameraExternalId: 'CAM-01',
      capturedAt: '2026-10-02T10:00:00Z',
      width: 640,
      height: 480,
      imageDataUrl: 'data:image/jpeg;base64,mock',
      zonePolygons: [
        {
          regionId: 'zone-1',
          geometryVersion: 1,
          coordinates: [
            [0.1, 0.1],
            [0.5, 0.1],
            [0.5, 0.5],
            [0.1, 0.5],
          ],
        },
      ],
      detections: [
        {
          active: false,
          alertState: 'COMPLIANT',
          boundingBox: { x1: 0.2, y1: 0.2, x2: 0.4, y2: 0.7 },
          cameraExternalId: 'CAM-01',
          confidence: 0.95,
          confirmedMissingItems: [],
          eventId: 'EVENT-1',
          label: 'MF04 PPE COMPLIANT',
          ppeStatus: { HARD_HAT: 'PRESENT', SAFETY_VEST: 'PRESENT' },
          timecode: 'LIVE',
          trackId: 10,
        },
      ],
      zoneDetections: [
        {
          active: true,
          alertState: 'UNKNOWN',
          boundingBox: { x1: 0.2, y1: 0.2, x2: 0.4, y2: 0.7 },
          cameraExternalId: 'CAM-01',
          confidence: 0.95,
          eventId: 'ZONE-EVENT-1',
          label: 'MF05 IN RESTRICTED ZONE',
          ppeStatus: { HARD_HAT: 'UNKNOWN', SAFETY_VEST: 'UNKNOWN' },
          timecode: 'LIVE',
          trackId: 10,
          regionId: 'zone-1',
        },
      ],
      ...overrides,
    },
    image: mockImage,
  };
}

describe('RealtimePreviewCanvas - Exact Synchronization & Deterministic Overlay', () => {
  let mockContext: MockCanvasContext2D;
  let fontsDuringMeasure: string[];

  beforeEach(() => {
    fontsDuringMeasure = [];

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
      measureText: vi.fn((text: string) => {
        fontsDuringMeasure.push(mockContext.font);
        return { width: text.length * 8 } as TextMetrics;
      }),
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
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('1. Enforces canvas.font is set to actual rendering font BEFORE measureText is called', () => {
    const preview = createMockDecodedPreview();

    render(<RealtimePreviewCanvas preview={preview} mode="ppe" />);

    // Must have measured at least one label
    expect(fontsDuringMeasure.length).toBeGreaterThan(0);
    // Every call to measureText must have occurred with the actual rendering font
    for (const font of fontsDuringMeasure) {
      expect(font).toBe('bold 11px sans-serif');
    }
  });

  it('2. Draws exact synchronized frame and person boxes without interpolation', () => {
    const preview = createMockDecodedPreview();

    render(<RealtimePreviewCanvas preview={preview} mode="ppe" />);

    // 1. Exact raw image drawn with full frame dimensions
    expect(mockContext.drawImage).toHaveBeenCalledWith(preview.image, 0, 0, 640, 480);

    // 2. Exact bounding box of Person drawn (x1=0.2*640=128, y1=0.2*480=96, w=128, h=240)
    const strokeCalls = mockContext.strokeRect.mock.calls as Array<
      [number, number, number, number]
    >;
    expect(strokeCalls.length).toBeGreaterThan(0);
    const personBox = strokeCalls[0]!;
    expect(personBox[0]).toBeCloseTo(128);
    expect(personBox[1]).toBeCloseTo(96);
    expect(personBox[2]).toBeCloseTo(128);
    expect(personBox[3]).toBeCloseTo(240);

    // 3. Compact neutral text rendered without emoji
    expect(mockContext.fillText).toHaveBeenCalledWith(
      expect.stringContaining('Track #10 · Mũ & Áo: Có'),
      expect.any(Number),
      expect.any(Number),
    );

    // 4. Accessible list and visible details include technical evidence summary
    expect(
      screen.getAllByText(/Bằng chứng kỹ thuật ghi nhận có Mũ bảo hộ và Áo phản quang/i).length,
    ).toBeGreaterThanOrEqual(1);

    // 5. Visible compact details dropdown exists and is default collapsed
    const detailsSummary = screen.getByText(/Khung hình \(1 quan sát\)/i);
    expect(detailsSummary).toBeTruthy();
    const detailsElement = detailsSummary.closest('details');
    expect(detailsElement).toBeTruthy();
    expect(detailsElement?.open).toBe(false);
  });

  it('3. Preserves Zone preview behavior in zone mode', () => {
    const preview = createMockDecodedPreview();

    render(<RealtimePreviewCanvas preview={preview} mode="zone" />);

    // Zone polygon path rendered
    expect(mockContext.beginPath).toHaveBeenCalled();
    expect(mockContext.fill).toHaveBeenCalled();
    expect(mockContext.stroke).toHaveBeenCalled();

    // Zone active detection box rendered in red
    expect(mockContext.fillText).toHaveBeenCalledWith(
      expect.stringContaining('MF05 IN RESTRICTED ZONE · #10'),
      expect.any(Number),
      expect.any(Number),
    );
  });

  it('4. Flips label inside when Person bounding box touches top edge', () => {
    const preview = createMockDecodedPreview({
      detections: [
        {
          active: false,
          boundingBox: { x1: 0.1, y1: 0.01, x2: 0.3, y2: 0.4 }, // y1 = 4.8px (< 24px)
          cameraExternalId: 'CAM-01',
          confidence: 0.9,
          eventId: 'E-TOP',
          label: 'MF04 PPE UNKNOWN',
          ppeStatus: { HARD_HAT: 'UNKNOWN', SAFETY_VEST: 'UNKNOWN' },
          timecode: 'LIVE',
          trackId: 1,
        },
      ],
    });

    render(<RealtimePreviewCanvas preview={preview} mode="ppe" />);

    // Label background fillRect must be placed INSIDE the box (y >= 4.8px) rather than above 0
    const fillCalls = mockContext.fillRect.mock.calls as Array<[number, number, number, number]>;
    expect(fillCalls.length).toBeGreaterThan(0);
    const badgeY = fillCalls[0]![1];
    expect(badgeY).toBeGreaterThanOrEqual(4); // inside box
  });

  it('5. Strictly prevents label collision in crowded scenes and retains box strokes for all persons', () => {
    // 4 persons clustered closely
    const preview = createMockDecodedPreview({
      detections: [
        {
          trackId: 1,
          boundingBox: { x1: 0.2, y1: 0.3, x2: 0.35, y2: 0.8 },
          confidence: 0.9,
          active: false,
          label: 'MF04 PPE COMPLIANT',
          ppeStatus: { HARD_HAT: 'PRESENT', SAFETY_VEST: 'PRESENT' },
          timecode: 'LIVE',
          eventId: 'E-1',
        },
        {
          trackId: 2,
          boundingBox: { x1: 0.22, y1: 0.31, x2: 0.37, y2: 0.75 },
          confidence: 0.88,
          active: false,
          label: 'MF04 PPE COMPLIANT',
          ppeStatus: { HARD_HAT: 'PRESENT', SAFETY_VEST: 'PRESENT' },
          timecode: 'LIVE',
          eventId: 'E-2',
        },
        {
          trackId: 3,
          boundingBox: { x1: 0.24, y1: 0.32, x2: 0.39, y2: 0.72 },
          confidence: 0.85,
          active: false,
          label: 'MF04 PPE COMPLIANT',
          ppeStatus: { HARD_HAT: 'PRESENT', SAFETY_VEST: 'PRESENT' },
          timecode: 'LIVE',
          eventId: 'E-3',
        },
        {
          trackId: 4,
          boundingBox: { x1: 0.26, y1: 0.33, x2: 0.41, y2: 0.7 },
          confidence: 0.82,
          active: false,
          label: 'MF04 PPE COMPLIANT',
          ppeStatus: { HARD_HAT: 'PRESENT', SAFETY_VEST: 'PRESENT' },
          timecode: 'LIVE',
          eventId: 'E-4',
        },
      ],
    });

    render(<RealtimePreviewCanvas preview={preview} mode="ppe" />);

    // 1. ALL 4 person boxes MUST be stroked (no box omitted)
    // Canvas calls strokeRect for person boxes (plus possibly for badges)
    expect(mockContext.strokeRect.mock.calls.length).toBeGreaterThanOrEqual(4);

    // 2. All rendered badge pills must be geometrically nonintersecting
    const fillCalls = mockContext.fillRect.mock.calls as Array<[number, number, number, number]>;
    const renderedBadges = fillCalls.map(([left, top, width, height]) => ({
      left,
      top,
      width,
      height,
    }));

    for (let i = 0; i < renderedBadges.length; i++) {
      for (let j = i + 1; j < renderedBadges.length; j++) {
        const b1 = renderedBadges[i]!;
        const b2 = renderedBadges[j]!;
        const intersects = !(
          b1.left + b1.width <= b2.left ||
          b1.left >= b2.left + b2.width ||
          b1.top + b1.height <= b2.top ||
          b1.top >= b2.top + b2.height
        );
        expect(intersects).toBe(false);
      }
    }

    // 3. Accessible list has entries for all 4 tracks, and visible details list reflects all 4 tracks
    const listItems = screen.getAllByRole('listitem');
    expect(listItems.length).toBe(4);
    expect(screen.getByText(/Khung hình \(4 quan sát\)/i)).toBeTruthy();
  });

  it('6. Regression: supports multiple zone observations for same trackId across distinct regions', () => {
    const preview = createMockDecodedPreview({
      zoneDetections: [
        {
          active: true,
          alertState: 'UNKNOWN',
          boundingBox: { x1: 0.2, y1: 0.2, x2: 0.4, y2: 0.7 },
          cameraExternalId: 'CAM-01',
          confidence: 0.95,
          eventId: 'SHARED-ZONE-EVENT',
          label: 'MF05 IN RESTRICTED ZONE',
          ppeStatus: { HARD_HAT: 'UNKNOWN', SAFETY_VEST: 'UNKNOWN' },
          timecode: 'LIVE',
          trackId: 10,
          regionId: 'zone-north',
        },
        {
          active: true,
          alertState: 'UNKNOWN',
          boundingBox: { x1: 0.2, y1: 0.2, x2: 0.4, y2: 0.7 },
          cameraExternalId: 'CAM-01',
          confidence: 0.95,
          eventId: 'SHARED-ZONE-EVENT',
          label: 'MF05 IN RESTRICTED ZONE',
          ppeStatus: { HARD_HAT: 'UNKNOWN', SAFETY_VEST: 'UNKNOWN' },
          timecode: 'LIVE',
          trackId: 10,
          regionId: 'zone-south',
        },
      ],
    });

    render(<RealtimePreviewCanvas preview={preview} mode="zone" />);

    // Header accurately states observations, not unique people
    expect(screen.getByText(/Khung hình \(2 quan sát\)/i)).toBeTruthy();

    // Renders distinct region context for each row
    expect(screen.getAllByText(/Khu vực: zone-north/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Khu vực: zone-south/i).length).toBeGreaterThanOrEqual(1);

    // Accessible list exposes both observations with their respective regions
    const items = screen.getAllByRole('listitem');
    expect(items.length).toBe(2);
    expect(items[0]!.textContent).toContain('Khu vực: zone-north');
    expect(items[1]!.textContent).toContain('Khu vực: zone-south');
  });
});
