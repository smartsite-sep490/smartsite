// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedPoint, RegionPolygonValidationKey } from './region-polygon-geometry';
import { useRegionPointerGesture } from './useRegionPointerGesture';

if (typeof window.PointerEvent === 'undefined') {
  class PolyfillPointerEvent extends MouseEvent {
    readonly pointerId: number;

    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
    }
  }

  Object.defineProperty(window, 'PointerEvent', {
    configurable: true,
    writable: true,
    value: PolyfillPointerEvent,
  });
}

interface PointerCaptureSpy {
  capturedIds: Set<number>;
  setPointerCapture: ReturnType<typeof vi.fn>;
  hasPointerCapture: ReturnType<typeof vi.fn>;
  releasePointerCapture: ReturnType<typeof vi.fn>;
}

function attachPointerCaptureSpy(element: Element): PointerCaptureSpy {
  const capturedIds = new Set<number>();
  const setPointerCapture = vi.fn((pointerId: number) => {
    capturedIds.add(pointerId);
  });
  const hasPointerCapture = vi.fn((pointerId: number) => capturedIds.has(pointerId));
  const releasePointerCapture = vi.fn((pointerId: number) => {
    capturedIds.delete(pointerId);
  });

  Object.defineProperty(element, 'setPointerCapture', {
    configurable: true,
    writable: true,
    value: setPointerCapture,
  });
  Object.defineProperty(element, 'hasPointerCapture', {
    configurable: true,
    writable: true,
    value: hasPointerCapture,
  });
  Object.defineProperty(element, 'releasePointerCapture', {
    configurable: true,
    writable: true,
    value: releasePointerCapture,
  });

  return {
    capturedIds,
    setPointerCapture,
    hasPointerCapture,
    releasePointerCapture,
  };
}

function mockSvgBoundingRect(svg: HTMLElement) {
  // Container 1000x500 at (100, 50) with frame 1600x1000 -> content box 800x500 at (200, 50)
  vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
    left: 100,
    top: 50,
    width: 1000,
    height: 500,
    right: 1100,
    bottom: 550,
    x: 100,
    y: 50,
    toJSON: () => ({}),
  });
}

const INITIAL_TRIANGLE: NormalizedPoint[] = [
  [0.2, 0.2],
  [0.8, 0.2],
  [0.5, 0.8],
];

interface HarnessProps {
  initialPoints?: NormalizedPoint[];
  zoom?: number;
  pan?: [number, number];
  isPanMode?: boolean;
  isSaving?: boolean;
  onSelectVertex: (index: number) => void;
  onPan: (pan: [number, number]) => void;
  onRecordUndo: (points: NormalizedPoint[]) => void;
  onChange: (points: NormalizedPoint[]) => void;
  onError: (key: RegionPolygonValidationKey | null) => void;
  onClearServerError?: () => void;
  onChanged: () => void;
  onConsumeSuppressedResult?: (suppressed: boolean) => void;
}

function GestureHarness({
  initialPoints = INITIAL_TRIANGLE,
  zoom = 1,
  pan = [0, 0],
  isPanMode = false,
  isSaving = false,
  onSelectVertex,
  onPan,
  onRecordUndo,
  onChange,
  onError,
  onClearServerError,
  onChanged,
  onConsumeSuppressedResult,
}: HarnessProps) {
  const [points, setPoints] = useState<NormalizedPoint[]>(initialPoints);

  const gesture = useRegionPointerGesture({
    points,
    frame: { width: 1600, height: 1000 },
    zoom,
    pan,
    isPanMode,
    isSaving,
    onSelectVertex,
    onPan,
    onRecordUndo,
    onChange: (nextPoints) => {
      setPoints(nextPoints);
      onChange(nextPoints);
    },
    onError,
    onClearServerError,
    onChanged,
  });

  return (
    <div>
      <svg
        data-testid="region-svg"
        onPointerDown={gesture.onPointerDown}
        onPointerMove={gesture.onPointerMove}
        onPointerUp={gesture.onPointerUp}
        onPointerCancel={gesture.onPointerCancel}
        onClick={() => {
          onConsumeSuppressedResult?.(gesture.consumeSuppressedClick());
        }}
      >
        {points.map(([x, y], index) => (
          <circle
            key={index}
            cx={x}
            cy={y}
            r={5}
            data-testid={`vertex-${index}`}
            onPointerDown={(event) => gesture.onVertexPointerDown(event, index)}
            onClick={gesture.onVertexClick}
          />
        ))}
      </svg>
    </div>
  );
}

describe('useRegionPointerGesture', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('drags a vertex across multiple moves with undo recorded once, quantizes coordinates, releases pointer capture, and suppresses the trailing click once', () => {
    const onSelectVertex = vi.fn();
    const onPan = vi.fn();
    const onRecordUndo = vi.fn();
    const onChange = vi.fn();
    const onError = vi.fn();
    const onClearServerError = vi.fn();
    const onChanged = vi.fn();
    const onConsumeSuppressedResult = vi.fn();

    render(
      <GestureHarness
        onSelectVertex={onSelectVertex}
        onPan={onPan}
        onRecordUndo={onRecordUndo}
        onChange={onChange}
        onError={onError}
        onClearServerError={onClearServerError}
        onChanged={onChanged}
        onConsumeSuppressedResult={onConsumeSuppressedResult}
      />,
    );

    const svg = screen.getByTestId('region-svg');
    const vertex0 = screen.getByTestId('vertex-0');
    mockSvgBoundingRect(svg);
    const vertexCapture = attachPointerCaptureSpy(vertex0);

    fireEvent.pointerDown(vertex0, { pointerId: 5, clientX: 360, clientY: 150 });
    expect(onSelectVertex).toHaveBeenCalledTimes(1);
    expect(onSelectVertex).toHaveBeenCalledWith(0);
    expect(vertexCapture.setPointerCapture).toHaveBeenCalledWith(5);

    // Zero-delta move does not record undo or mutate points
    fireEvent.pointerMove(svg, { pointerId: 5, clientX: 360, clientY: 150 });
    expect(onRecordUndo).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();

    // First real move -> (440, 200) maps to u=0.3, v=0.3
    fireEvent.pointerMove(svg, { pointerId: 5, clientX: 440, clientY: 200 });
    expect(onRecordUndo).toHaveBeenCalledTimes(1);
    expect(onRecordUndo).toHaveBeenCalledWith(INITIAL_TRIANGLE);
    expect(onChange).toHaveBeenLastCalledWith([
      [0.3, 0.3],
      [0.8, 0.2],
      [0.5, 0.8],
    ]);
    expect(onError).toHaveBeenLastCalledWith(null);
    expect(onClearServerError).toHaveBeenCalledTimes(1);
    expect(onChanged).toHaveBeenCalledTimes(1);

    // Second move in same drag -> (520, 250) maps to u=0.4, v=0.4; undo is NOT recorded again
    fireEvent.pointerMove(svg, { pointerId: 5, clientX: 520, clientY: 250 });
    expect(onRecordUndo).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith([
      [0.4, 0.4],
      [0.8, 0.2],
      [0.5, 0.8],
    ]);
    expect(onChanged).toHaveBeenCalledTimes(2);

    fireEvent.pointerUp(svg, { pointerId: 5, clientX: 520, clientY: 250 });
    expect(vertexCapture.hasPointerCapture).toHaveBeenCalledWith(5);
    expect(vertexCapture.releasePointerCapture).toHaveBeenCalledWith(5);

    // Trailing SVG click after drag is suppressed once, then cleared
    fireEvent.click(svg);
    expect(onConsumeSuppressedResult).toHaveBeenLastCalledWith(true);
    fireEvent.click(svg);
    expect(onConsumeSuppressedResult).toHaveBeenLastCalledWith(false);
  });

  it('rejects out-of-bounds letterbox moves and duplicate-vertex collisions during drag without clamping or recording undo', () => {
    const onSelectVertex = vi.fn();
    const onPan = vi.fn();
    const onRecordUndo = vi.fn();
    const onChange = vi.fn();
    const onError = vi.fn();
    const onChanged = vi.fn();

    render(
      <GestureHarness
        onSelectVertex={onSelectVertex}
        onPan={onPan}
        onRecordUndo={onRecordUndo}
        onChange={onChange}
        onError={onError}
        onChanged={onChanged}
      />,
    );

    const svg = screen.getByTestId('region-svg');
    const vertex0 = screen.getByTestId('vertex-0');
    mockSvgBoundingRect(svg);
    attachPointerCaptureSpy(vertex0);

    fireEvent.pointerDown(vertex0, { pointerId: 3, clientX: 360, clientY: 150 });

    // Move into left pillarbox bar (clientX = 150 < contentLeft = 200)
    fireEvent.pointerMove(svg, { pointerId: 3, clientX: 150, clientY: 200 });
    expect(onError).toHaveBeenLastCalledWith('regionSetup.validation.outOfBounds');
    expect(onRecordUndo).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();

    // Move onto vertex 1 at [0.8, 0.2] -> clientX = 200 + 0.8 * 800 = 840, clientY = 50 + 0.2 * 500 = 150
    fireEvent.pointerMove(svg, { pointerId: 3, clientX: 840, clientY: 150 });
    expect(onError).toHaveBeenLastCalledWith('regionSetup.validation.duplicateVertexClick');
    expect(onRecordUndo).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();

    fireEvent.pointerUp(svg, { pointerId: 3, clientX: 840, clientY: 150 });
  });

  it('pans and clamps viewport in pan mode when zoom > 1, and ignores pan gestures at zoom = 1', () => {
    const onSelectVertex = vi.fn();
    const onPan = vi.fn();
    const onRecordUndo = vi.fn();
    const onChange = vi.fn();
    const onError = vi.fn();
    const onChanged = vi.fn();

    const { rerender } = render(
      <GestureHarness
        zoom={1}
        pan={[0, 0]}
        isPanMode={true}
        onSelectVertex={onSelectVertex}
        onPan={onPan}
        onRecordUndo={onRecordUndo}
        onChange={onChange}
        onError={onError}
        onChanged={onChanged}
      />,
    );

    const svg = screen.getByTestId('region-svg');
    mockSvgBoundingRect(svg);
    const svgCapture = attachPointerCaptureSpy(svg);

    // At zoom = 1, pan drag does not start
    fireEvent.pointerDown(svg, { pointerId: 8, clientX: 600, clientY: 300 });
    fireEvent.pointerMove(svg, { pointerId: 8, clientX: 400, clientY: 200 });
    expect(svgCapture.setPointerCapture).not.toHaveBeenCalled();
    expect(onPan).not.toHaveBeenCalled();

    // At zoom = 2, pan drag updates and clamps pan within [0, 0.5]
    rerender(
      <GestureHarness
        zoom={2}
        pan={[0.2, 0.2]}
        isPanMode={true}
        onSelectVertex={onSelectVertex}
        onPan={onPan}
        onRecordUndo={onRecordUndo}
        onChange={onChange}
        onError={onError}
        onChanged={onChanged}
      />,
    );

    fireEvent.pointerDown(svg, { pointerId: 9, clientX: 600, clientY: 300 });
    expect(svgCapture.setPointerCapture).toHaveBeenCalledWith(9);

    // dx = -160 on contentWidth=800 at zoom=2 -> +0.1 => ~0.3; dy = -100 on contentHeight=500 at zoom=2 -> +0.1 => ~0.3
    fireEvent.pointerMove(svg, { pointerId: 9, clientX: 440, clientY: 200 });
    expect(onPan).toHaveBeenCalledTimes(1);
    const [pannedX, pannedY] = onPan.mock.lastCall![0] as [number, number];
    expect(pannedX).toBeCloseTo(0.3, 10);
    expect(pannedY).toBeCloseTo(0.3, 10);

    // Large drag clamps to maxPan = 0.5
    fireEvent.pointerMove(svg, { pointerId: 9, clientX: 0, clientY: 0 });
    expect(onPan).toHaveBeenLastCalledWith([0.5, 0.5]);

    fireEvent.pointerUp(svg, { pointerId: 9, clientX: 0, clientY: 0 });
    expect(svgCapture.releasePointerCapture).toHaveBeenCalledWith(9);
  });

  it('releases pointer capture on pointerCancel and on outside window pointerup without leaving suppressed clicks', () => {
    const onSelectVertex = vi.fn();
    const onPan = vi.fn();
    const onRecordUndo = vi.fn();
    const onChange = vi.fn();
    const onError = vi.fn();
    const onChanged = vi.fn();
    const onConsumeSuppressedResult = vi.fn();

    render(
      <GestureHarness
        onSelectVertex={onSelectVertex}
        onPan={onPan}
        onRecordUndo={onRecordUndo}
        onChange={onChange}
        onError={onError}
        onChanged={onChanged}
        onConsumeSuppressedResult={onConsumeSuppressedResult}
      />,
    );

    const svg = screen.getByTestId('region-svg');
    const vertex0 = screen.getByTestId('vertex-0');
    mockSvgBoundingRect(svg);
    const vertexCapture = attachPointerCaptureSpy(vertex0);

    // 1. Cancelled gesture on SVG
    fireEvent.pointerDown(vertex0, { pointerId: 11, clientX: 360, clientY: 150 });
    fireEvent.pointerMove(svg, { pointerId: 11, clientX: 440, clientY: 200 });
    fireEvent.pointerCancel(svg, { pointerId: 11 });

    expect(vertexCapture.releasePointerCapture).toHaveBeenCalledWith(11);
    fireEvent.click(svg);
    expect(onConsumeSuppressedResult).toHaveBeenLastCalledWith(false);

    // Further moves after cancel are ignored
    onChange.mockClear();
    fireEvent.pointerMove(svg, { pointerId: 11, clientX: 520, clientY: 250 });
    expect(onChange).not.toHaveBeenCalled();

    // 2. Release outside SVG via window pointerup
    fireEvent.pointerDown(vertex0, { pointerId: 12, clientX: 440, clientY: 200 });
    fireEvent.pointerMove(svg, { pointerId: 12, clientX: 520, clientY: 250 });
    expect(onChange).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new window.PointerEvent('pointerup', { pointerId: 12 }));
    expect(vertexCapture.releasePointerCapture).toHaveBeenCalledWith(12);

    onChange.mockClear();
    fireEvent.pointerMove(svg, { pointerId: 12, clientX: 600, clientY: 300 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('aborts an active gesture when isSaving becomes true and blocks new gestures while saving', () => {
    const onSelectVertex = vi.fn();
    const onPan = vi.fn();
    const onRecordUndo = vi.fn();
    const onChange = vi.fn();
    const onError = vi.fn();
    const onChanged = vi.fn();

    const { rerender } = render(
      <GestureHarness
        isSaving={false}
        onSelectVertex={onSelectVertex}
        onPan={onPan}
        onRecordUndo={onRecordUndo}
        onChange={onChange}
        onError={onError}
        onChanged={onChanged}
      />,
    );

    const svg = screen.getByTestId('region-svg');
    const vertex0 = screen.getByTestId('vertex-0');
    mockSvgBoundingRect(svg);
    const vertexCapture = attachPointerCaptureSpy(vertex0);

    fireEvent.pointerDown(vertex0, { pointerId: 21, clientX: 360, clientY: 150 });
    expect(vertexCapture.setPointerCapture).toHaveBeenCalledWith(21);

    // Transition to saving mid-gesture immediately finishes and releases pointer capture
    rerender(
      <GestureHarness
        isSaving={true}
        onSelectVertex={onSelectVertex}
        onPan={onPan}
        onRecordUndo={onRecordUndo}
        onChange={onChange}
        onError={onError}
        onChanged={onChanged}
      />,
    );

    expect(vertexCapture.releasePointerCapture).toHaveBeenCalledWith(21);

    fireEvent.pointerMove(svg, { pointerId: 21, clientX: 440, clientY: 200 });
    expect(onChange).not.toHaveBeenCalled();

    // Starting a new gesture while isSaving=true is blocked
    onSelectVertex.mockClear();
    vertexCapture.setPointerCapture.mockClear();
    fireEvent.pointerDown(vertex0, { pointerId: 22, clientX: 360, clientY: 150 });
    expect(onSelectVertex).not.toHaveBeenCalled();
    expect(vertexCapture.setPointerCapture).not.toHaveBeenCalled();
  });
});
