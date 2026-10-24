// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RawCameraMediaCanvas } from './RawCameraMediaCanvas';

describe('RawCameraMediaCanvas', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      clearRect: vi.fn(),
      strokeRect: vi.fn(),
      fillRect: vi.fn(),
      fillText: vi.fn(),
      strokeText: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });
  it('renders canvas element with accessible label and data-testid', () => {
    render(<RawCameraMediaCanvas image={null} />);

    const canvas = screen.getByTestId('raw-camera-media-canvas');
    expect(canvas).not.toBeNull();
    expect(canvas.getAttribute('role')).toBe('img');
    expect(canvas.getAttribute('aria-label')).toContain('Raw unanalyzed camera live video stream');
  });

  it('draws image on canvas context when image is provided', () => {
    const drawImageMock = vi.fn();
    const clearRectMock = vi.fn();

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: drawImageMock,
      clearRect: clearRectMock,
    } as unknown as CanvasRenderingContext2D);

    const mockImage = {
      naturalWidth: 640,
      naturalHeight: 480,
    } as HTMLImageElement;

    render(<RawCameraMediaCanvas image={mockImage} width={640} height={480} />);

    const canvas = screen.getByTestId('raw-camera-media-canvas') as HTMLCanvasElement;
    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(480);
    expect(drawImageMock).toHaveBeenCalledWith(mockImage, 0, 0, 640, 480);
    expect(clearRectMock).not.toHaveBeenCalled();
  });

  it('clears canvas when image is null', () => {
    const drawImageMock = vi.fn();
    const clearRectMock = vi.fn();

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: drawImageMock,
      clearRect: clearRectMock,
    } as unknown as CanvasRenderingContext2D);

    render(<RawCameraMediaCanvas image={null} width={640} height={480} />);

    const canvas = screen.getByTestId('raw-camera-media-canvas') as HTMLCanvasElement;
    expect(clearRectMock).toHaveBeenCalledWith(0, 0, canvas.width, canvas.height);
    expect(drawImageMock).not.toHaveBeenCalled();
  });

  it('strictly NEVER calls text or rectangle drawing methods (no AI boxes/overlays)', () => {
    const strokeRectMock = vi.fn();
    const fillRectMock = vi.fn();
    const fillTextMock = vi.fn();
    const strokeTextMock = vi.fn();

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      clearRect: vi.fn(),
      strokeRect: strokeRectMock,
      fillRect: fillRectMock,
      fillText: fillTextMock,
      strokeText: strokeTextMock,
    } as unknown as CanvasRenderingContext2D);

    const mockImage = {
      naturalWidth: 640,
      naturalHeight: 480,
    } as HTMLImageElement;

    render(<RawCameraMediaCanvas image={mockImage} />);

    expect(strokeRectMock).not.toHaveBeenCalled();
    expect(fillRectMock).not.toHaveBeenCalled();
    expect(fillTextMock).not.toHaveBeenCalled();
    expect(strokeTextMock).not.toHaveBeenCalled();
  });

  it('exposes browser lineage data attributes when frame metadata is provided', () => {
    const mockFrame = {
      cameraExternalId: 'tapo-core5-live',
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      sequenceNumber: '1042',
      capturedAt: '2026-10-08T12:00:00.000Z',
    };

    render(<RawCameraMediaCanvas image={null} frame={mockFrame} />);

    const canvas = screen.getByTestId('raw-camera-media-canvas');
    expect(canvas.getAttribute('data-media-camera')).toBe('tapo-core5-live');
    expect(canvas.getAttribute('data-media-session')).toBe('550e8400-e29b-41d4-a716-446655440000');
    expect(canvas.getAttribute('data-media-sequence')).toBe('1042');
    expect(canvas.getAttribute('data-media-captured-at')).toBe('2026-10-08T12:00:00.000Z');

    // Confirm no sensitive or AI attributes are exposed
    expect(canvas.getAttribute('data-image-data-url')).toBeNull();
    expect(canvas.getAttribute('data-media-token')).toBeNull();
    expect(canvas.getAttribute('data-ai-boxes')).toBeNull();
  });

  it('omits lineage data attributes when frame is undefined or null', () => {
    render(<RawCameraMediaCanvas image={null} frame={null} />);

    const canvas = screen.getByTestId('raw-camera-media-canvas');
    expect(canvas.getAttribute('data-media-camera')).toBeNull();
    expect(canvas.getAttribute('data-media-session')).toBeNull();
    expect(canvas.getAttribute('data-media-sequence')).toBeNull();
    expect(canvas.getAttribute('data-media-captured-at')).toBeNull();
  });
});
