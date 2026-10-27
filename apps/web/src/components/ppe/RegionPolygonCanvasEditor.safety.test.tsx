// @vitest-environment jsdom
import React, { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocaleProvider } from '../../i18n/LocaleProvider';
import { useLocale, type TranslationKey } from '../../i18n/ppe-locale';
import { RegionPolygonCanvasEditor } from './RegionPolygonCanvasEditor';
import type { NormalizedPoint } from './region-polygon-geometry';

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

interface SafetyHarnessProps {
  initialPoints?: NormalizedPoint[];
  lastSavedDraft?: string | null;
  isSaving?: boolean;
  frameWidth?: number;
  frameHeight?: number;
  onClose?: () => void;
  onSave?: (points: NormalizedPoint[]) => void;
  onPointsChange?: (points: NormalizedPoint[]) => void;
}

function SafetyEditorHarness({
  initialPoints = [],
  lastSavedDraft = null,
  isSaving = false,
  frameWidth = 640,
  frameHeight = 480,
  onClose = vi.fn(),
  onSave = vi.fn(),
  onPointsChange,
}: SafetyHarnessProps) {
  const { t } = useLocale();
  const [points, setPoints] = useState<NormalizedPoint[]>(() =>
    initialPoints.map(([x, y]) => [x, y]),
  );
  const [validationErrorKey, setValidationErrorKey] = useState<TranslationKey | null>(null);

  const handleChangePoints = (next: NormalizedPoint[]) => {
    setPoints(next);
    onPointsChange?.(next);
  };

  return (
    <div>
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
        isSaving={isSaving}
        onChangePoints={handleChangePoints}
        onValidationError={setValidationErrorKey}
        onSaveRegion={() => onSave(points)}
        onClose={onClose}
      />
    </div>
  );
}

describe('RegionPolygonCanvasEditor safety & interaction regressions', () => {
  beforeEach(() => {
    setSvgRect({ left: 0, top: 0, width: 640, height: 480 });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('blocks canvas clicks/drags, keyboard edits, coordinate add, and Escape close/discard while isSaving is true', () => {
    const onClose = vi.fn();
    const onPointsChange = vi.fn();
    const initial: NormalizedPoint[] = [
      [0.1, 0.1],
      [0.6, 0.1],
      [0.6, 0.6],
    ];

    const { rerender } = render(
      <LocaleProvider defaultLocale="en">
        <SafetyEditorHarness
          initialPoints={initial}
          isSaving={false}
          onClose={onClose}
          onPointsChange={onPointsChange}
        />
      </LocaleProvider>,
    );

    const canvas = screen.getByLabelText(/Camera Region Drawing Canvas/i);
    const vertex1 = screen.getByRole('button', { name: /Vertex 1/i });

    // Select Vertex 1 and add a 4th point so the draft has undo history and dirty state
    act(() => {
      vertex1.focus();
    });
    fireEvent.click(canvas, { clientX: 128, clientY: 360 });
    expect(screen.getByText(/Points: 4 \/ 32/i)).toBeDefined();
    onPointsChange.mockClear();

    // Enter saving state while draft is dirty
    rerender(
      <LocaleProvider defaultLocale="en">
        <SafetyEditorHarness
          initialPoints={initial}
          isSaving={true}
          onClose={onClose}
          onPointsChange={onPointsChange}
        />
      </LocaleProvider>,
    );

    // Toolbar and footer action controls reflect disabled pending state
    expect(screen.getByRole('button', { name: /Undo Point/i }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: /Reset Drawing/i }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByRole('button', { name: /Delete Point/i }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByRole('button', { name: /Add Point/i }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: /Cancel Drawing/i }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByRole('button', { name: /Saving/i }).hasAttribute('disabled')).toBe(true);

    // 1. Pointer click on canvas must NOT append a vertex while saving
    fireEvent.click(canvas, { clientX: 320, clientY: 240 });
    expect(screen.getByText(/Points: 4 \/ 32/i)).toBeDefined();
    expect(onPointsChange).not.toHaveBeenCalled();

    // 2. Pointer drag on Vertex 1 must NOT move the vertex while saving
    fireEvent.pointerDown(vertex1, { clientX: 64, clientY: 48 });
    fireEvent.pointerMove(canvas, { clientX: 160, clientY: 120 });
    fireEvent.pointerUp(canvas, { clientX: 160, clientY: 120 });
    expect(vertex1.getAttribute('cx')).toBe('64');
    expect(vertex1.getAttribute('cy')).toBe('48');
    expect(onPointsChange).not.toHaveBeenCalled();

    // 3. Keyboard arrow nudges, Delete/Backspace, and Undo ('z') must NOT mutate points while saving
    act(() => {
      vertex1.focus();
    });
    fireEvent.keyDown(vertex1, { key: 'ArrowRight' });
    fireEvent.keyDown(vertex1, { key: 'ArrowDown', shiftKey: true });
    fireEvent.keyDown(vertex1, { key: 'Delete' });
    fireEvent.keyDown(vertex1, { key: 'Backspace' });
    fireEvent.keyDown(canvas, { key: 'z' });
    expect(vertex1.getAttribute('cx')).toBe('64');
    expect(vertex1.getAttribute('cy')).toBe('48');
    expect(screen.getByText(/Points: 4 \/ 32/i)).toBeDefined();
    expect(onPointsChange).not.toHaveBeenCalled();

    // 4. Coordinate input + Add Point click must NOT append a point while saving
    fireEvent.change(screen.getByLabelText(/Point X/i), { target: { value: '0.4' } });
    fireEvent.change(screen.getByLabelText(/Point Y/i), { target: { value: '0.4' } });
    fireEvent.click(screen.getByRole('button', { name: /Add Point/i }));
    expect(screen.getByText(/Points: 4 \/ 32/i)).toBeDefined();
    expect(onPointsChange).not.toHaveBeenCalled();

    // 5. Escape on dirty draft must NOT open discard prompt or close while saving
    fireEvent.keyDown(canvas, { key: 'Escape' });
    expect(screen.queryByText(/Discard unsaved region geometry changes\?/i)).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    // 6. Escape on clean draft while saving must also NOT close the editor
    cleanup();
    render(
      <LocaleProvider defaultLocale="en">
        <SafetyEditorHarness initialPoints={initial} isSaving={true} onClose={onClose} />
      </LocaleProvider>,
    );
    fireEvent.keyDown(screen.getByLabelText(/Camera Region Drawing Canvas/i), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps focus inside the editor after deleting the last focused vertex so subsequent keyboard commands and Escape work', () => {
    const onClose = vi.fn();
    const initial: NormalizedPoint[] = [
      [0.1, 0.1],
      [0.6, 0.1],
      [0.6, 0.6],
    ];

    render(
      <LocaleProvider defaultLocale="en">
        <SafetyEditorHarness initialPoints={initial} onClose={onClose} />
      </LocaleProvider>,
    );

    const editorRoot = document.querySelector('[data-ppe-region-editor]') as HTMLElement;
    const vertex3 = screen.getByRole('button', { name: /Vertex 3/i });

    // Focus the last vertex (index 2) and delete it via keyboard
    act(() => {
      vertex3.focus();
    });
    expect(document.activeElement).toBe(vertex3);

    act(() => {
      fireEvent.keyDown(document.activeElement!, { key: 'Delete' });
    });
    expect(screen.getByText(/Points: 2 \/ 32/i)).toBeDefined();
    expect(screen.queryByRole('button', { name: /Vertex 3/i })).toBeNull();

    // Focus must remain inside the editor (never lost to document.body)
    expect(document.activeElement).not.toBe(document.body);
    expect(editorRoot.contains(document.activeElement)).toBe(true);

    // Subsequent keyboard Undo ('z') sent to current activeElement works without manual refocus
    act(() => {
      fireEvent.keyDown(document.activeElement!, { key: 'z' });
    });
    expect(screen.getByText(/Points: 3 \/ 32/i)).toBeDefined();

    // Delete all vertices down to 0 via keyboard on activeElement and verify Escape still works
    const v3Again = screen.getByRole('button', { name: /Vertex 3/i });
    act(() => {
      v3Again.focus();
    });
    act(() => {
      fireEvent.keyDown(document.activeElement!, { key: 'Backspace' });
    });
    act(() => {
      fireEvent.keyDown(document.activeElement!, { key: 'Backspace' });
    });
    act(() => {
      fireEvent.keyDown(document.activeElement!, { key: 'Backspace' });
    });
    expect(screen.getByText(/Points: 0 \/ 32/i)).toBeDefined();
    expect(document.activeElement).not.toBe(document.body);
    expect(editorRoot.contains(document.activeElement)).toBe(true);

    // Escape on activeElement triggers the dirty-draft discard confirmation inside the editor
    act(() => {
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    });
    expect(screen.getByText(/Discard unsaved region geometry changes\?/i)).toBeDefined();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('appends a point on the first distinct canvas click after selecting a vertex while still suppressing the trailing click after a drag', () => {
    const initial: NormalizedPoint[] = [
      [0.1, 0.1],
      [0.8, 0.1],
      [0.8, 0.8],
    ];

    render(
      <LocaleProvider defaultLocale="en">
        <SafetyEditorHarness initialPoints={initial} />
      </LocaleProvider>,
    );

    const canvas = screen.getByLabelText(/Camera Region Drawing Canvas/i);
    const vertex1 = screen.getByRole('button', { name: /Vertex 1/i });

    // 1. Select Vertex 1 normally (click without dragging)
    fireEvent.pointerDown(vertex1, { clientX: 64, clientY: 48 });
    fireEvent.pointerUp(vertex1, { clientX: 64, clientY: 48 });
    fireEvent.click(vertex1, { clientX: 64, clientY: 48 });
    expect(vertex1.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/Points: 3 \/ 32/i)).toBeDefined();

    // 2. Next deliberate click on a distinct canvas point must append Vertex 4 on the first click
    fireEvent.pointerDown(canvas, { clientX: 320, clientY: 240 });
    fireEvent.pointerUp(canvas, { clientX: 320, clientY: 240 });
    fireEvent.click(canvas, { clientX: 320, clientY: 240 });

    expect(screen.getByText(/Points: 4 \/ 32/i)).toBeDefined();
    const vertex4 = screen.getByRole('button', { name: /Vertex 4/i });
    expect(vertex4.getAttribute('cx')).toBe('320');
    expect(vertex4.getAttribute('cy')).toBe('240');

    // 3. Drag Vertex 1 to (128, 96): immediate trailing click after drag must be suppressed
    fireEvent.pointerDown(vertex1, { clientX: 64, clientY: 48 });
    fireEvent.pointerMove(canvas, { clientX: 128, clientY: 96 });
    fireEvent.pointerUp(canvas, { clientX: 128, clientY: 96 });
    fireEvent.click(canvas, { clientX: 128, clientY: 96 });

    expect(screen.getByText(/Points: 4 \/ 32/i)).toBeDefined();
    expect(vertex1.getAttribute('cx')).toBe('128');
    expect(vertex1.getAttribute('cy')).toBe('96');

    // 4. Subsequent deliberate click on a distinct canvas point (192, 360) appends Vertex 5 once
    fireEvent.pointerDown(canvas, { clientX: 192, clientY: 360 });
    fireEvent.pointerUp(canvas, { clientX: 192, clientY: 360 });
    fireEvent.click(canvas, { clientX: 192, clientY: 360 });

    expect(screen.getByText(/Points: 5 \/ 32/i)).toBeDefined();
    const vertex5 = screen.getByRole('button', { name: /Vertex 5/i });
    expect(vertex5.getAttribute('cx')).toBe('192');
    expect(vertex5.getAttribute('cy')).toBe('360');
  });
});
