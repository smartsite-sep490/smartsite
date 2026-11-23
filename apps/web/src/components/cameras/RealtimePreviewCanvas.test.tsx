// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { parseRealtimePreview } from './realtimePreview';
import { RealtimePreviewCanvas } from './RealtimePreviewCanvas';
import type { DecodedPreview } from './useRealtimePreview';

interface MockCanvasContext {
  font: string;
  strokeStyle: string;
  fillStyle: string;
  lineWidth: number;
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
}

function createMockCanvasContext(): MockCanvasContext {
  return {
    font: '',
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
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
    measureText: vi.fn((text: string) => ({ width: text.length * 6 })),
  };
}

function makePreview(zoneAnchor?: 'BOTTOM_CENTER' | 'BOX_CENTER'): DecodedPreview {
  const width = 640;
  const height = 480;
  const image = document.createElement('img');
  image.width = width;
  image.height = height;

  const frame = parseRealtimePreview({
    type: 'frame',
    previewVersion: 1,
    sessionId: '11111111-1111-4111-8111-111111111111',
    sequenceNumber: '12',
    cameraExternalId: 'cam-demo-01',
    capturedAt: '2026-11-23T04:00:00.000Z',
    width,
    height,
    imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
    ...(zoneAnchor !== undefined ? { zoneAnchor } : {}),
    zonePolygons: [
      {
        regionId: 'region-alpha',
        geometryVersion: 1,
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
        label: 'Person',
        regionId: 'region-alpha',
        boundingBox: { x1: 0.2, y1: 0.2, x2: 0.4, y2: 0.7 },
        ppeStatus: { HARD_HAT: 'UNKNOWN', SAFETY_VEST: 'UNKNOWN' },
      },
    ],
    zoneDetections: [],
  });

  return { frame, image };
}

describe('RealtimePreviewCanvas zone anchor rendering', () => {
  let mockCtx: MockCanvasContext;

  beforeEach(async () => {
    await i18n.changeLanguage('en');
    mockCtx = createMockCanvasContext();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => mockCtx as unknown as CanvasRenderingContext2D,
    );
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('en');
    vi.restoreAllMocks();
  });

  it('defaults omitted zoneAnchor to bottom-center marker and matching EN/VI help copy', async () => {
    render(<RealtimePreviewCanvas preview={makePreview()} mode="zone" />);
    // Person #7 box: x=[0.2, 0.4], y=[0.2, 0.7] on 640x480 -> bottom-center (192, 336)
    expect(mockCtx.fillRect).toHaveBeenCalledWith(189, 333, 6, 6);
    expect(screen.getByText(/Bottom-center marker/)).toBeTruthy();

    await act(async () => {
      await i18n.changeLanguage('vi');
    });
    expect(screen.getByText(/Điểm xanh giữa đáy khung/)).toBeTruthy();
  });

  it('draws box-center marker and matching EN/VI help copy when zoneAnchor is BOX_CENTER', async () => {
    const { rerender } = render(
      <RealtimePreviewCanvas preview={makePreview('BOX_CENTER')} mode="zone" />,
    );
    // Person #7 box: x=[0.2, 0.4], y=[0.2, 0.7] on 640x480 -> box-center (192, 216)
    expect(mockCtx.fillRect).toHaveBeenCalledWith(189, 213, 6, 6);
    expect(mockCtx.fillRect).not.toHaveBeenCalledWith(189, 333, 6, 6);
    expect(screen.getByText(/Box-center marker/)).toBeTruthy();

    await act(async () => {
      await i18n.changeLanguage('vi');
    });
    expect(screen.getByText(/Điểm xanh tâm khung/)).toBeTruthy();

    mockCtx.fillRect.mockClear();
    rerender(<RealtimePreviewCanvas preview={makePreview('BOTTOM_CENTER')} mode="zone" />);
    expect(mockCtx.fillRect).toHaveBeenCalledWith(189, 333, 6, 6);
    expect(mockCtx.fillRect).not.toHaveBeenCalledWith(189, 213, 6, 6);
    expect(screen.getByText(/Điểm xanh giữa đáy khung/)).toBeTruthy();
  });
});
