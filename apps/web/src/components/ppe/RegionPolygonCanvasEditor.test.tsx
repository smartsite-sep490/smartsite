// @vitest-environment jsdom
import React, { useState } from 'react';
import { act, render, screen, cleanup, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { useLocale, type TranslationKey } from '../../i18n/ppe-locale';
import { LocaleProvider } from '../../i18n/LocaleProvider';
import { RegionPolygonCanvasEditor } from './RegionPolygonCanvasEditor';
import {
  extractRegionPolygonCoordinates,
  clampViewportPan,
  validatePolygonGeometry,
  mapClientPointToNormalized,
  type NormalizedPoint,
} from './region-polygon-geometry';

function setSvgRect(rect: Partial<DOMRect>) {
  const fullRect: DOMRect = {
    x: rect.left ?? 0,
    y: rect.top ?? 0,
    left: rect.left ?? 0,
    top: rect.top ?? 0,
    width: rect.width ?? 640,
    height: rect.height ?? 480,
    right: (rect.left ?? 0) + (rect.width ?? 640),
    bottom: (rect.top ?? 0) + (rect.height ?? 480),
    toJSON: () => ({}),
  };
  SVGElement.prototype.getBoundingClientRect = vi.fn().mockReturnValue(fullRect);
}

interface HarnessProps {
  initialPoints?: NormalizedPoint[];
  lastSavedDraft?: string | null;
  frameWidth?: number;
  frameHeight?: number;
  onClose?: () => void;
  onSave?: (points: NormalizedPoint[]) => void;
}

function EditorTestHarness({
  initialPoints = [],
  lastSavedDraft = null,
  frameWidth = 640,
  frameHeight = 480,
  onClose = vi.fn(),
  onSave = vi.fn(),
}: HarnessProps) {
  const { t } = useLocale();
  const [points, setPoints] = useState<NormalizedPoint[]>(() =>
    initialPoints.map(([x, y]) => [x, y]),
  );
  const [validationErrorKey, setValidationErrorKey] = useState<TranslationKey | null>(null);

  return (
    <div>
      <button type="button" data-testid="launcher-btn">
        Launcher
      </button>
      {validationErrorKey && <div role="alert">{t(validationErrorKey)}</div>}
      <RegionPolygonCanvasEditor
        points={points}
        initialPoints={initialPoints}
        lastSavedDraft={lastSavedDraft}
        frame={{
          width: frameWidth,
          height: frameHeight,
          imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
        }}
        isImageStale={false}
        isSaving={false}
        onChangePoints={setPoints}
        onValidationError={setValidationErrorKey}
        onSaveRegion={() => onSave(points)}
        onClose={onClose}
      />
    </div>
  );
}

describe('RegionPolygonCanvasEditor & region-polygon-geometry', () => {
  beforeEach(() => {
    setSvgRect({ left: 0, top: 0, width: 640, height: 480 });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it.each(['X', 'Y'])(
    'rejects an empty %s coordinate without silently adding a zero coordinate',
    (axis) => {
      render(
        <LocaleProvider defaultLocale="en">
          <EditorTestHarness />
        </LocaleProvider>,
      );
      fireEvent.change(screen.getByLabelText(new RegExp(`Point ${axis}`)), {
        target: { value: '' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Add Point/i }));
      expect(screen.getByText(/Points: 0 \/ 32/i)).toBeDefined();
      expect(screen.getByRole('alert')).toBeDefined();
      fireEvent.change(screen.getByLabelText(new RegExp(`Point ${axis}`)), {
        target: { value: '0' },
      });
      fireEvent.click(screen.getByRole('button', { name: /Add Point/i }));
      expect(screen.getByText(/Points: 1 \/ 32/i)).toBeDefined();
    },
  );

  it('keeps the entire viewport inside the image at a non-terminating pan boundary', () => {
    const [panX, panY] = clampViewportPan(1, 1, 3);
    expect(panX + 1 / 3).toBeLessThanOrEqual(1);
    expect(panY + 1 / 3).toBeLessThanOrEqual(1);
    expect(panX).toBeGreaterThan(0);
    expect(clampViewportPan(-1, Number.NaN, 3)).toEqual([0, 0]);
  });

  it.each(['cancel', 'release-outside'])(
    'ends a vertex drag after %s instead of moving it on later hover',
    (ending) => {
      render(
        <LocaleProvider defaultLocale="en">
          <EditorTestHarness
            initialPoints={[
              [0.1, 0.1],
              [0.5, 0.1],
              [0.5, 0.5],
              [0.1, 0.5],
            ]}
          />
        </LocaleProvider>,
      );
      const canvas = screen.getByLabelText(/Camera Region Drawing Canvas/i);
      const vertex = screen.getByRole('button', { name: /Vertex 1/i });
      fireEvent.pointerDown(vertex, { clientX: 64, clientY: 48 });
      fireEvent.pointerMove(canvas, { clientX: 128, clientY: 96 });
      expect(vertex.getAttribute('cx')).toBe('128');
      if (ending === 'cancel') fireEvent.pointerCancel(canvas);
      else fireEvent.pointerUp(window);
      fireEvent.pointerMove(canvas, { clientX: 256, clientY: 144 });
      expect(vertex.getAttribute('cx')).toBe('128');
      expect(vertex.getAttribute('cy')).toBe('96');
    },
  );

  it('accepts an inline boundary vertex for every cyclic starting point without permitting foldbacks', () => {
    const polygon: NormalizedPoint[] = [
      [0.5, 0.1],
      [0.8, 0.1],
      [0.8, 0.8],
      [0.1, 0.8],
      [0.1, 0.1],
    ];
    for (let start = 0; start < polygon.length; start++) {
      expect(
        validatePolygonGeometry([...polygon.slice(start), ...polygon.slice(0, start)]),
      ).toBeNull();
    }
    expect(
      validatePolygonGeometry([
        [0.1, 0.1],
        [0.8, 0.1],
        [0.5, 0.1],
        [0.8, 0.8],
        [0.1, 0.8],
      ]),
    ).toBe('regionSetup.validation.selfIntersect');
  });

  it('does not undo unchanged saved geometry when there is no edit history', () => {
    render(
      <LocaleProvider defaultLocale="en">
        <EditorTestHarness
          initialPoints={[
            [0.1, 0.1],
            [0.5, 0.1],
            [0.5, 0.5],
            [0.1, 0.5],
          ]}
        />
      </LocaleProvider>,
    );
    const canvas = screen.getByLabelText(/Camera Region Drawing Canvas/i);
    expect(
      (screen.getByRole('button', { name: /Undo Point/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.keyDown(canvas, { key: 'z' });
    expect(screen.getByText(/Points: 4 \/ 32/i)).toBeDefined();
  });

  it('computes exact normalized coordinates under zoom, pan, resize, and letterboxing and rejects letterbox margin clicks', () => {
    // Letterboxed container: 800x480 for a 640x480 frame -> 80px horizontal pillarbox on left and right
    setSvgRect({ left: 10, top: 20, width: 800, height: 480 });

    const letterboxMiss = mapClientPointToNormalized(
      50, // Inside left 80px letterbox bar (content starts at 10 + 80 = 90)
      260,
      { left: 10, top: 20, width: 800, height: 480 },
      640,
      480,
      { zoom: 1, panX: 0, panY: 0 },
    );
    expect(letterboxMiss?.inContentBox).toBe(false);

    render(
      <LocaleProvider defaultLocale="en">
        <EditorTestHarness />
      </LocaleProvider>,
    );

    const canvas = screen.getByLabelText(/Camera Region Drawing Canvas/i);

    // Clicking inside the left letterbox bar must strictly reject as out-of-bounds
    fireEvent.click(canvas, { clientX: 50, clientY: 260 });
    expect(screen.getByText(/Clicked coordinates are outside the camera frame/i)).toBeDefined();
    expect(screen.getByText(/Points: 0 \/ 32/i)).toBeDefined();

    // Zoom in twice: 1x -> 1.5x -> 2x
    const zoomInBtn = screen.getByRole('button', { name: /Zoom In/i });
    fireEvent.click(zoomInBtn);
    fireEvent.click(zoomInBtn);
    expect(screen.getByTestId('region-zoom-level').textContent).toBe('2x');

    // Pan viewport in Pan Mode (panX = 0.25, panY = 0.25)
    const panModeBtn = screen.getByRole('button', { name: /Pan View/i });
    fireEvent.click(panModeBtn);
    // Drag pan by -320px horizontally and -240px vertically in 640x480 content box (deltaU = -0.5 -> +0.25 at 2x zoom)
    fireEvent.pointerDown(canvas, { clientX: 410, clientY: 260 });
    fireEvent.pointerMove(canvas, { clientX: 90, clientY: 20 });
    fireEvent.pointerUp(canvas, { clientX: 90, clientY: 20 });
    fireEvent.click(canvas, { clientX: 90, clientY: 20 });
    // Pan gesture release must NOT add a vertex
    expect(screen.getByText(/Points: 0 \/ 32/i)).toBeDefined();

    // Exit Pan Mode and click at center of active content box:
    // contentLeft = 90, contentW = 640 -> center clientX = 90 + 320 = 410 (u = 0.5)
    // contentTop = 20, contentH = 480 -> center clientY = 20 + 240 = 260 (v = 0.5)
    // With zoom = 2 and pan = [0.25, 0.25]: rawX = 0.25 + 0.5 / 2 = 0.5, rawY = 0.25 + 0.5 / 2 = 0.5
    fireEvent.click(panModeBtn);
    fireEvent.click(canvas, { clientX: 410, clientY: 260 });
    expect(screen.getByText(/Points: 1 \/ 32/i)).toBeDefined();
    const vertex1 = screen.getByRole('button', { name: /Vertex 1/i });
    expect(vertex1.getAttribute('cx')).toBe('320');
    expect(vertex1.getAttribute('cy')).toBe('240');
  });

  it('edits an existing vertex by pointer drag without adding a spurious point on release and strictly rejects out-of-bounds or duplicate drag', () => {
    const initial: NormalizedPoint[] = [
      [0.1, 0.1],
      [0.8, 0.1],
      [0.8, 0.8],
    ];
    render(
      <LocaleProvider defaultLocale="en">
        <EditorTestHarness initialPoints={initial} />
      </LocaleProvider>,
    );

    const canvas = screen.getByLabelText(/Camera Region Drawing Canvas/i);
    const vertex1 = screen.getByRole('button', { name: /Vertex 1/i });

    // Drag Vertex 1 from (64, 48) to (128, 96) -> [0.2, 0.2]
    fireEvent.pointerDown(vertex1, { clientX: 64, clientY: 48 });
    fireEvent.pointerMove(canvas, { clientX: 128, clientY: 96 });
    fireEvent.pointerUp(canvas, { clientX: 128, clientY: 96 });
    // Browser dispatches click after pointerup
    fireEvent.click(canvas, { clientX: 128, clientY: 96 });

    // Must still have exactly 3 points (no 4th point added!)
    expect(screen.getByText(/Points: 3 \/ 32/i)).toBeDefined();
    expect(vertex1.getAttribute('cx')).toBe('128');
    expect(vertex1.getAttribute('cy')).toBe('96');

    // Attempt to drag Vertex 1 out-of-bounds (-50, 96): must strictly reject and preserve last valid point (128, 96)
    fireEvent.pointerDown(vertex1, { clientX: 128, clientY: 96 });
    fireEvent.pointerMove(canvas, { clientX: -50, clientY: 96 });
    fireEvent.pointerUp(canvas, { clientX: -50, clientY: 96 });

    expect(screen.getByText(/Clicked coordinates are outside the camera frame/i)).toBeDefined();
    expect(vertex1.getAttribute('cx')).toBe('128');
    expect(vertex1.getAttribute('cy')).toBe('96');

    // Attempt to drag Vertex 1 onto Vertex 2 at (512, 48): must reject duplicate vertex and preserve (128, 96)
    fireEvent.pointerDown(vertex1, { clientX: 128, clientY: 96 });
    fireEvent.pointerMove(canvas, { clientX: 512, clientY: 48 });
    fireEvent.pointerUp(canvas, { clientX: 512, clientY: 48 });

    expect(screen.getByText(/A vertex with identical coordinates already exists/i)).toBeDefined();
    expect(vertex1.getAttribute('cx')).toBe('128');
    expect(vertex1.getAttribute('cy')).toBe('96');
  });

  it('supports keyboard-only point creation, vertex selection, 1px and Shift 10px nudge, strict out-of-bounds reject, delete, and undo', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();

    render(
      <LocaleProvider defaultLocale="en">
        <EditorTestHarness frameWidth={500} frameHeight={400} onSave={onSave} />
      </LocaleProvider>,
    );

    const xInput = screen.getByLabelText(/Point X/i);
    const yInput = screen.getByLabelText(/Point Y/i);
    const addBtn = screen.getByRole('button', { name: /Add Point/i });

    // Out-of-bounds coordinate entry (X = 1.2) -> strictly rejected
    await user.clear(xInput);
    await user.type(xInput, '1.2');
    await user.clear(yInput);
    await user.type(yInput, '0.2');
    await user.click(addBtn);
    expect(screen.getByText(/Clicked coordinates are outside the camera frame/i)).toBeDefined();
    expect(screen.getByText(/Points: 0 \/ 32/i)).toBeDefined();

    // Add 3 valid points via keyboard coordinate entry
    await user.clear(xInput);
    await user.type(xInput, '0');
    await user.clear(yInput);
    await user.type(yInput, '0.1');
    await user.click(addBtn); // Vertex 1 at [0, 0.1]

    await user.clear(xInput);
    await user.type(xInput, '0.6');
    await user.clear(yInput);
    await user.type(yInput, '0.1');
    await user.click(addBtn); // Vertex 2 at [0.6, 0.1]

    await user.clear(xInput);
    await user.type(xInput, '0.6');
    await user.clear(yInput);
    await user.type(yInput, '0.7');
    await user.click(addBtn); // Vertex 3 at [0.6, 0.7]

    expect(screen.getByText(/Points: 3 \/ 32/i)).toBeDefined();

    // Focus Vertex 1 (at x=0, y=0.1 on 500x400 frame -> 1px X = 0.002, 10px Y = 0.025)
    const vertex1 = screen.getByRole('button', { name: /Vertex 1/i });
    act(() => vertex1.focus());

    // Nudge left from x=0 -> out of bounds (< 0), strictly rejected and stays at x=0
    fireEvent.keyDown(vertex1, { key: 'ArrowLeft' });
    expect(screen.getByText(/Clicked coordinates are outside the camera frame/i)).toBeDefined();
    expect(vertex1.getAttribute('cx')).toBe('0');

    // Nudge right by 1 actual pixel: 0 + 1/500 = 0.002 -> cx = 1
    fireEvent.keyDown(vertex1, { key: 'ArrowRight' });
    expect(vertex1.getAttribute('cx')).toBe('1');

    // Shift + ArrowDown nudges by 10 actual pixels: 0.1 + 10/400 = 0.125 -> cy = 50
    fireEvent.keyDown(vertex1, { key: 'ArrowDown', shiftKey: true });
    expect(vertex1.getAttribute('cy')).toBe('50');

    // Undo ('z') restores Vertex 1 cy back to 40 (0.1 * 400)
    fireEvent.keyDown(vertex1, { key: 'z' });
    expect(vertex1.getAttribute('cy')).toBe('40');

    // Delete Vertex 3 with Delete key, then Undo ('z') to bring it back
    const vertex3 = screen.getByRole('button', { name: /Vertex 3/i });
    act(() => vertex3.focus());
    fireEvent.keyDown(vertex3, { key: 'Delete' });
    expect(screen.getByText(/Points: 2 \/ 32/i)).toBeDefined();

    const canvas = screen.getByLabelText(/Camera Region Drawing Canvas/i);
    fireEvent.keyDown(canvas, { key: 'z' });
    expect(screen.getByText(/Points: 3 \/ 32/i)).toBeDefined();

    await user.click(screen.getByRole('button', { name: /Save Region/i }));
    expect(onSave).toHaveBeenCalledWith([
      [0.002, 0.1],
      [0.6, 0.1],
      [0.6, 0.7],
    ]);
  });

  it('opens confirmation on Escape for dirty draft, cancels confirmation on second Escape, and only discards on explicit Discard action', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <LocaleProvider defaultLocale="en">
        <EditorTestHarness onClose={onClose} />
      </LocaleProvider>,
    );

    const canvas = screen.getByLabelText(/Camera Region Drawing Canvas/i);

    // Add 1 point -> draft is now dirty
    fireEvent.click(canvas, { clientX: 64, clientY: 48 });
    expect(screen.getByText(/Points: 1 \/ 32/i)).toBeDefined();

    // First Escape opens confirmation, does NOT close editor
    fireEvent.keyDown(canvas, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/Discard unsaved region geometry changes\?/i)).toBeDefined();

    // Second Escape means Keep Editing / cancel confirmation, NEVER discard!
    fireEvent.keyDown(canvas, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByText(/Discard unsaved region geometry changes\?/i)).toBeNull();
    expect(screen.getByText(/Points: 1 \/ 32/i)).toBeDefined();

    // Open confirmation again via Cancel Drawing button, then click Keep Editing
    await user.click(screen.getByRole('button', { name: /Cancel Drawing/i }));
    expect(screen.getByText(/Discard unsaved region geometry changes\?/i)).toBeDefined();
    await user.click(screen.getByRole('button', { name: /Keep Editing/i }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/Points: 1 \/ 32/i)).toBeDefined();

    // Open confirmation and click explicit Discard Changes -> calls onClose
    fireEvent.keyDown(canvas, { key: 'Escape' });
    await user.click(screen.getByRole('button', { name: /Discard Changes/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('validates RegionResponse unknown polygon shape safely via extractRegionPolygonCoordinates', () => {
    expect(extractRegionPolygonCoordinates(null)).toBeNull();
    expect(
      extractRegionPolygonCoordinates({
        coordinates: [
          [0.1, 0.1],
          [0.5, 0.5],
        ],
      }),
    ).toBeNull();
    expect(
      extractRegionPolygonCoordinates({
        coordinates: [
          [0.1, 0.1],
          [1.2, 0.1],
          [0.5, 0.5],
        ],
      }),
    ).toBeNull();
    expect(
      extractRegionPolygonCoordinates({
        coordinates: [
          [0.1, 0.1],
          [0.8, 0.1],
          [0.8, 0.8],
        ],
      }),
    ).toEqual([
      [0.1, 0.1],
      [0.8, 0.1],
      [0.8, 0.8],
    ]);
  });
});
