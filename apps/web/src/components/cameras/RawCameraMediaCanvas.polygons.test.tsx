// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RawCameraMediaCanvas } from './RawCameraMediaCanvas';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('paints configured geometry in raw image coordinates, then removes it on session or image loss', () => {
  const context = {
    drawImage: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  const image = { naturalWidth: 640, naturalHeight: 480 } as HTMLImageElement;
  const frame = {
    cameraExternalId: 'laptop',
    sessionId: 'capture-a',
    sequenceNumber: '10',
    capturedAt: '2026-11-22T16:00:00Z',
  };
  const geometry = {
    cameraExternalId: 'laptop',
    sessionId: 'capture-a',
    zonePolygons: [
      {
        regionId: 'region',
        geometryVersion: 1,
        coordinates: [
          [0.6, 0.55],
          [0.9, 0.55],
          [0.9, 0.9],
        ] as [number, number][],
      },
    ],
  };
  const view = render(<RawCameraMediaCanvas image={image} frame={frame} geometry={geometry} />);
  expect(context.moveTo).toHaveBeenCalledWith(384, 264);
  expect(context.lineTo).toHaveBeenCalledWith(576, 432);
  expect(context.stroke).toHaveBeenCalledTimes(1);
  context.stroke.mockClear();
  view.rerender(
    <RawCameraMediaCanvas
      image={image}
      frame={{ ...frame, sessionId: 'capture-b' }}
      geometry={geometry}
    />,
  );
  expect(context.stroke).not.toHaveBeenCalled();
  expect(context.drawImage).toHaveBeenCalledTimes(2);
  view.rerender(
    <RawCameraMediaCanvas
      image={image}
      frame={{ ...frame, cameraExternalId: 'other' }}
      geometry={geometry}
    />,
  );
  expect(context.stroke).not.toHaveBeenCalled();
  view.rerender(<RawCameraMediaCanvas image={null} frame={frame} geometry={geometry} />);
  expect(context.clearRect).toHaveBeenCalled();
  expect(context.stroke).not.toHaveBeenCalled();
});
