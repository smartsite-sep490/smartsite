// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SmartSiteManagementClient } from '@smartsite/api-client';
import type { CameraResponse } from '@smartsite/contracts/management';
import type { RawCameraMediaCanvasProps } from '../cameras/RawCameraMediaCanvas';
import { FocusedCameraMedia } from './FocusedCameraMedia';
const hooks = vi.hoisted(() => ({ snapshot: vi.fn(), raw: vi.fn(), recorded: vi.fn() }));
const rawCanvasMock = vi.hoisted(() => ({
  props: vi.fn(),
  useReal: false,
}));
vi.mock('../cameras/useScopedCameraPreview', () => ({ useScopedCameraPreview: hooks.snapshot }));
vi.mock('../cameras/useScopedCameraMedia', () => ({ useScopedCameraMedia: hooks.raw }));
vi.mock('../cameras/useScopedRecordedVideo', () => ({ useScopedRecordedVideo: hooks.recorded }));
vi.mock('../cameras/ScopedRealtimePreviewCanvas', () => ({
  ScopedRealtimePreviewCanvas: () => <div data-testid="ai-overlay" />,
}));
vi.mock('../cameras/RawCameraMediaCanvas', async () => {
  const actual = await vi.importActual<typeof import('../cameras/RawCameraMediaCanvas')>(
    '../cameras/RawCameraMediaCanvas',
  );
  return {
    RawCameraMediaCanvas: (rawProps: RawCameraMediaCanvasProps) => {
      rawCanvasMock.props(rawProps);
      return rawCanvasMock.useReal ? (
        <actual.RawCameraMediaCanvas {...rawProps} />
      ) : (
        <div data-testid="raw-media" />
      );
    },
  };
});
const props = {
  apiUrl: 'https://backend.example',
  client: {} as SmartSiteManagementClient,
  token: 'private',
  sessionScope: 'scope',
  siteId: 'site',
  aiPaused: false,
  camera: { id: 'camera', externalId: 'camera-source', name: 'Camera' } as CameraResponse,
};
beforeEach(() => {
  rawCanvasMock.useReal = false;
  rawCanvasMock.props.mockReset();
  hooks.snapshot
    .mockReset()
    .mockReturnValue({ preview: {}, isLoading: false, errorStatus: null, retry: vi.fn() });
  hooks.raw
    .mockReset()
    .mockReturnValue({ image: {}, frame: {}, status: 'LIVE', errorStatus: null, retry: vi.fn() });
  hooks.recorded.mockReset().mockReturnValue({
    videoUrl: 'blob:recorded',
    isLoading: false,
    errorStatus: null,
    retry: vi.fn(),
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it('activates the selected transport, keeps snapshot metadata active only for AI/LIVE, and never overlays AI on raw video', () => {
  render(<FocusedCameraMedia {...props} />);
  expect(screen.getByTestId('ai-overlay')).toBeTruthy();
  expect(hooks.snapshot.mock.lastCall?.[0].enabled).toBe(true);
  expect(hooks.raw.mock.lastCall?.[0].enabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Live source video' }));
  expect(screen.queryByTestId('ai-overlay')).toBeNull();
  expect(screen.getByTestId('raw-media')).toBeTruthy();
  expect(hooks.snapshot.mock.lastCall?.[0].enabled).toBe(true);
  expect(hooks.raw.mock.lastCall?.[0].enabled).toBe(true);
  expect(hooks.recorded.mock.lastCall?.[0].enabled).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Recorded source video' }));
  expect(screen.queryByTestId('raw-media')).toBeNull();
  expect(document.querySelector('video')?.getAttribute('src')).toBe('blob:recorded');
  expect(document.querySelector('video')?.hasAttribute('controls')).toBe(true);
  expect(hooks.snapshot.mock.lastCall?.[0].enabled).toBe(false);
  expect(hooks.raw.mock.lastCall?.[0].enabled).toBe(false);
  expect(hooks.recorded.mock.lastCall?.[0].enabled).toBe(true);
});
it('paused state disables every transport and shows single calm paused status without duplicate footer label', () => {
  render(<FocusedCameraMedia {...props} aiPaused />);
  expect(screen.getByTestId('focused-source-state').textContent).toBe('AI paused');
  expect(screen.getByTestId('focused-people-state').textContent).toBe('Person count unavailable');
  fireEvent.click(screen.getByRole('button', { name: 'Recorded source video' }));
  for (const hook of Object.values(hooks)) expect(hook.mock.lastCall?.[0].enabled).toBe(false);
  expect(document.querySelector('video')).toBeNull();
  expect(screen.queryByTestId('ai-overlay')).toBeNull();
  expect(screen.getByRole('status').textContent).toContain('disabled');
});
it('a forbidden selected source shows unavailable without replaying the last AI snapshot', () => {
  hooks.raw.mockReturnValue({
    image: null,
    frame: null,
    status: 'HALTED',
    errorStatus: 403,
    retry: vi.fn(),
  });
  render(<FocusedCameraMedia {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Live source video' }));
  expect(screen.queryByTestId('ai-overlay')).toBeNull();
  expect(screen.getByRole('status').textContent).toContain('unavailable');
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
});

it('keeps full Camera and Site context available in the expandable details', () => {
  render(
    <FocusedCameraMedia
      {...props}
      siteCode="SITE-ALPHA"
      siteName="Long construction site context"
      camera={{ ...props.camera, name: 'Long camera context' }}
    />,
  );
  const details = screen.getByTestId('focused-technical-details');
  fireEvent.click(details.querySelector('summary')!);
  expect((details as HTMLDetailsElement).open).toBe(true);
  expect(details.textContent).toContain('SITE-ALPHA · Long construction site context');
  expect(details.textContent).toContain('Long camera context');
});

it('passes LIVE-only geometry to RawCameraMediaCanvas on matching session without painting AI boxes and drops geometry on replay or session mismatch', () => {
  rawCanvasMock.useReal = true;
  const context = {
    drawImage: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    strokeRect: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    strokeText: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );

  const rawImage = { naturalWidth: 640, naturalHeight: 480 } as HTMLImageElement;
  const rawFrame = {
    cameraExternalId: 'camera-source',
    sessionId: '11111111-1111-4111-8111-111111111111',
    sequenceNumber: '12',
    capturedAt: '2026-11-22T16:10:00Z',
  };
  const zonePolygons = [
    {
      regionId: 'region-1',
      geometryVersion: 1,
      coordinates: [
        [0.25, 0.5],
        [0.75, 0.5],
        [0.5, 0.75],
      ] as [number, number][],
    },
  ];

  hooks.raw.mockReturnValue({
    image: rawImage,
    frame: rawFrame,
    status: 'LIVE',
    errorStatus: null,
    retry: vi.fn(),
  });
  hooks.snapshot.mockReturnValue({
    sourceKind: 'LIVE',
    isLoading: false,
    errorStatus: null,
    retry: vi.fn(),
    preview: {
      image: {},
      frame: {
        cameraExternalId: 'camera-source',
        sessionId: '11111111-1111-4111-8111-111111111111',
        zonePolygons,
        detections: [
          {
            trackId: 1,
            label: 'Person',
            active: true,
            confidence: 0.9,
            boundingBox: { x1: 0.1, y1: 0.1, x2: 0.4, y2: 0.8 },
          },
        ],
        zoneDetections: [],
        modelObjects: { detections: [{ className: 'Person' }] },
      },
    },
  });

  const view = render(<FocusedCameraMedia {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'Live source video' }));

  expect(screen.queryByTestId('ai-overlay')).toBeNull();
  expect(screen.getByTestId('raw-camera-media-canvas')).toBeTruthy();

  const passedGeometry = rawCanvasMock.props.mock.lastCall?.[0]?.geometry;
  expect(passedGeometry).toEqual({
    cameraExternalId: 'camera-source',
    sessionId: '11111111-1111-4111-8111-111111111111',
    zonePolygons,
  });
  expect(Object.keys(passedGeometry ?? {})).not.toContain('detections');
  expect(Object.keys(passedGeometry ?? {})).not.toContain('modelObjects');

  expect(context.drawImage).toHaveBeenCalledWith(rawImage, 0, 0, 640, 480);
  expect(context.moveTo).toHaveBeenCalledWith(160, 240);
  expect(context.lineTo).toHaveBeenCalledWith(480, 240);
  expect(context.lineTo).toHaveBeenCalledWith(320, 360);
  expect(context.stroke).toHaveBeenCalledTimes(1);
  expect(context.strokeRect).not.toHaveBeenCalled();
  expect(context.fillRect).not.toHaveBeenCalled();
  expect(context.fillText).not.toHaveBeenCalled();
  expect(context.strokeText).not.toHaveBeenCalled();

  context.stroke.mockClear();
  context.drawImage.mockClear();
  hooks.snapshot.mockReturnValue({
    sourceKind: 'REPLAY',
    isLoading: false,
    errorStatus: null,
    retry: vi.fn(),
    preview: {
      image: {},
      frame: {
        cameraExternalId: 'camera-source',
        sessionId: '11111111-1111-4111-8111-111111111111',
        zonePolygons,
        detections: [],
        zoneDetections: [],
      },
    },
  });
  view.rerender(<FocusedCameraMedia {...props} siteCode="SITE-REPLAY" />);
  expect(rawCanvasMock.props.mock.lastCall?.[0]?.geometry).toBeNull();
  expect(context.stroke).not.toHaveBeenCalled();
  expect(context.drawImage).toHaveBeenCalledWith(rawImage, 0, 0, 640, 480);

  context.stroke.mockClear();
  hooks.snapshot.mockReturnValue({
    sourceKind: 'LIVE',
    isLoading: false,
    errorStatus: null,
    retry: vi.fn(),
    preview: {
      image: {},
      frame: {
        cameraExternalId: 'camera-source',
        sessionId: '22222222-2222-4222-8222-222222222222',
        zonePolygons,
        detections: [],
        zoneDetections: [],
      },
    },
  });
  view.rerender(<FocusedCameraMedia {...props} siteCode="SITE-MISMATCH" />);
  expect(context.stroke).not.toHaveBeenCalled();
});
