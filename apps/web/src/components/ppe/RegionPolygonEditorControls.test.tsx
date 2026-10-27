// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changeUiLanguage } from '../../i18n/runtime';
import { ZOOM_STEPS } from './region-polygon-geometry';
import {
  RegionPolygonEditorFooter,
  RegionPolygonEditorToolbar,
  type RegionPolygonEditorToolbarProps,
} from './RegionPolygonEditorControls';

beforeEach(async () => {
  await changeUiLanguage('en');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function createToolbarProps(
  overrides: Partial<RegionPolygonEditorToolbarProps> = {},
): RegionPolygonEditorToolbarProps {
  return {
    editingRegion: null,
    isConfirmingDiscard: false,
    isDirty: true,
    pointsCount: 4,
    canUndo: true,
    hasSelectedVertex: true,
    zoomIdx: 2,
    zoom: 2,
    pan: [0.12, -0.08],
    isPanMode: false,
    coordXInput: '0.5',
    coordYInput: '0.5',
    isSaving: false,
    onKeepEditing: vi.fn(),
    onConfirmDiscard: vi.fn(),
    onUndo: vi.fn(),
    onReset: vi.fn(),
    onDeleteSelectedVertex: vi.fn(),
    onZoomStep: vi.fn(),
    onTogglePanMode: vi.fn(),
    onResetView: vi.fn(),
    onChangeCoordX: vi.fn(),
    onChangeCoordY: vi.fn(),
    onAddCoordinatePoint: vi.fn(),
    ...overrides,
  };
}

describe('RegionPolygonEditorControls', () => {
  it('organizes controls into accessible editing and view groups with subordinate reset/delete actions and logical tab order in EN and VI', async () => {
    const props = createToolbarProps();
    render(<RegionPolygonEditorToolbar {...props} />);

    const toolbarAnchor = document.querySelector(
      '[data-tour-anchor="polygon-edit-controls"]',
    ) as HTMLElement | null;
    expect(toolbarAnchor).not.toBeNull();

    const groups = within(toolbarAnchor!).getAllByRole('group');
    expect(groups).toHaveLength(2);

    const editingGroup = within(toolbarAnchor!).getByRole('group', {
      name: 'Point editing',
    });
    const viewGroup = within(toolbarAnchor!).getByRole('group', {
      name: 'Canvas view',
    });

    expect(within(editingGroup).getByText('Points: 4 / 32')).toBeTruthy();
    expect(within(viewGroup).getByTestId('region-zoom-level').textContent).toBe('2x');

    const editingButtons = within(editingGroup).getAllByRole('button');
    expect(editingButtons.map((btn) => btn.textContent?.trim())).toEqual([
      'Undo Point',
      'Delete Point',
      'Reset Drawing',
      'Add Point',
    ]);
    expect(editingButtons[0]?.getAttribute('data-control-priority')).toBe('primary');
    expect(editingButtons[1]?.getAttribute('data-control-priority')).toBe('subordinate');
    expect(editingButtons[2]?.getAttribute('data-control-priority')).toBe('subordinate');
    expect(editingButtons[3]?.getAttribute('data-control-priority')).toBe('primary');

    const viewButtons = within(viewGroup).getAllByRole('button');
    expect(viewButtons.map((btn) => btn.textContent?.trim())).toEqual([
      'Zoom In',
      'Zoom Out',
      'Pan View',
      'Reset View',
    ]);
    expect(viewButtons[0]?.getAttribute('data-control-priority')).toBe('primary');
    expect(viewButtons[1]?.getAttribute('data-control-priority')).toBe('primary');
    expect(viewButtons[2]?.getAttribute('data-control-priority')).toBe('primary');
    expect(viewButtons[3]?.getAttribute('data-control-priority')).toBe('subordinate');

    // Verify no duplicated controls across the entire toolbar
    const allButtons = within(toolbarAnchor!).getAllByRole('button');
    expect(allButtons).toHaveLength(8);

    await act(async () => {
      await changeUiLanguage('vi');
    });

    expect(screen.getByRole('group', { name: 'Chỉnh sửa điểm' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Khung nhìn' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hoàn tác điểm' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Xóa điểm' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Đặt lại bản vẽ' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Đặt lại khung nhìn' })).toBeTruthy();
  });

  it('forwards exact zoom-step, vertex selection/delete, undo, reset, pan, coordinate, discard, and footer callbacks', () => {
    const props = createToolbarProps({
      editingRegion: { id: 'reg-7', version: 3 },
      isConfirmingDiscard: true,
      isDirty: true,
      isPanMode: true,
    });
    const onRequestCancel = vi.fn();
    const onSaveRegion = vi.fn();

    render(
      <>
        <RegionPolygonEditorToolbar {...props} />
        <RegionPolygonEditorFooter
          pointsCount={4}
          isSaving={false}
          isImageStale={false}
          onRequestCancel={onRequestCancel}
          onSaveRegion={onSaveRegion}
        />
      </>,
    );

    expect(screen.getByText('Editing Region reg-7 (v3)')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Undo Point' }));
    expect(props.onUndo).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Delete Point' }));
    expect(props.onDeleteSelectedVertex).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Reset Drawing' }));
    expect(props.onReset).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Zoom In' }));
    expect(props.onZoomStep).toHaveBeenCalledWith(1);

    fireEvent.click(screen.getByRole('button', { name: 'Zoom Out' }));
    expect(props.onZoomStep).toHaveBeenCalledWith(-1);

    const panBtn = screen.getByRole('button', { name: 'Pan View' });
    expect(panBtn.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(panBtn);
    expect(props.onTogglePanMode).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Reset View' }));
    expect(props.onResetView).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText('Point X (0–1)'), {
      target: { value: '0.25' },
    });
    expect(props.onChangeCoordX).toHaveBeenCalledWith('0.25');

    fireEvent.change(screen.getByLabelText('Point Y (0–1)'), {
      target: { value: '0.75' },
    });
    expect(props.onChangeCoordY).toHaveBeenCalledWith('0.75');

    fireEvent.click(screen.getByRole('button', { name: 'Add Point' }));
    expect(props.onAddCoordinatePoint).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Keep Editing' }));
    expect(props.onKeepEditing).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Discard Changes' }));
    expect(props.onConfirmDiscard).toHaveBeenCalledTimes(1);

    const footerAnchor = document.querySelector(
      '[data-tour-anchor="polygon-save-footer"]',
    ) as HTMLElement | null;
    expect(footerAnchor).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel Drawing' }));
    expect(onRequestCancel).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Save Region' }));
    expect(onSaveRegion).toHaveBeenCalledTimes(1);
  });

  it('preserves exact disabled, zoom-bound, saving, and stale-frame guards', () => {
    const initialProps = createToolbarProps({
      pointsCount: 0,
      canUndo: false,
      hasSelectedVertex: false,
      zoomIdx: 0,
      zoom: 1,
      pan: [0, 0],
      isSaving: false,
    });

    const { rerender } = render(
      <>
        <RegionPolygonEditorToolbar {...initialProps} />
        <RegionPolygonEditorFooter
          pointsCount={2}
          isSaving={false}
          isImageStale={false}
          onRequestCancel={vi.fn()}
          onSaveRegion={vi.fn()}
        />
      </>,
    );

    expect((screen.getByRole('button', { name: 'Undo Point' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole('button', { name: 'Delete Point' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'Reset Drawing' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByRole('button', { name: 'Zoom Out' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: 'Pan View' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: 'Reset View' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: 'Zoom In' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect((screen.getByRole('button', { name: 'Add Point' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(
      (screen.getByRole('button', { name: 'Save Region' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    // Max zoom and stale image guard
    const maxZoomProps = createToolbarProps({
      zoomIdx: ZOOM_STEPS.length - 1,
      zoom: ZOOM_STEPS[ZOOM_STEPS.length - 1]!,
      pan: [0, 0],
      isSaving: false,
    });
    rerender(
      <>
        <RegionPolygonEditorToolbar {...maxZoomProps} />
        <RegionPolygonEditorFooter
          pointsCount={3}
          isSaving={false}
          isImageStale={true}
          onRequestCancel={vi.fn()}
          onSaveRegion={vi.fn()}
        />
      </>,
    );

    expect((screen.getByRole('button', { name: 'Zoom In' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: 'Zoom Out' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect((screen.getByRole('button', { name: 'Reset View' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(
      (screen.getByRole('button', { name: 'Save Region' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    // Saving state locks editing, view, coordinate add, discard confirmation, cancel, and save controls
    const savingProps = createToolbarProps({
      isConfirmingDiscard: true,
      isDirty: true,
      isSaving: true,
    });
    rerender(
      <>
        <RegionPolygonEditorToolbar {...savingProps} />
        <RegionPolygonEditorFooter
          pointsCount={4}
          isSaving={true}
          isImageStale={false}
          onRequestCancel={vi.fn()}
          onSaveRegion={vi.fn()}
        />
      </>,
    );

    for (const label of [
      'Keep Editing',
      'Discard Changes',
      'Undo Point',
      'Delete Point',
      'Reset Drawing',
      'Add Point',
      'Zoom In',
      'Zoom Out',
      'Pan View',
      'Reset View',
      'Cancel Drawing',
      'Saving...',
    ]) {
      expect((screen.getByRole('button', { name: label }) as HTMLButtonElement).disabled).toBe(
        true,
      );
    }
    expect((screen.getByLabelText('Point X (0–1)') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Point Y (0–1)') as HTMLInputElement).disabled).toBe(true);
  });
});
