import React from 'react';
import { useLocale } from '../../i18n/ppe-locale';
import { ZOOM_STEPS } from './region-polygon-geometry';

export interface RegionPolygonEditorToolbarProps {
  editingRegion?: { id: string; version: number } | null;
  isConfirmingDiscard: boolean;
  isDirty: boolean;
  pointsCount: number;
  canUndo: boolean;
  hasSelectedVertex: boolean;
  zoomIdx: number;
  zoom: number;
  pan: [number, number];
  isPanMode: boolean;
  coordXInput: string;
  coordYInput: string;
  isSaving: boolean;
  onKeepEditing: () => void;
  onConfirmDiscard: () => void;
  onUndo: () => void;
  onReset: () => void;
  onDeleteSelectedVertex: () => void;
  onZoomStep: (delta: number) => void;
  onTogglePanMode: () => void;
  onResetView: () => void;
  onChangeCoordX: (value: string) => void;
  onChangeCoordY: (value: string) => void;
  onAddCoordinatePoint: () => void;
}

export function RegionPolygonEditorToolbar({
  editingRegion,
  isConfirmingDiscard,
  isDirty,
  pointsCount,
  canUndo,
  hasSelectedVertex,
  zoomIdx,
  zoom,
  pan,
  isPanMode,
  coordXInput,
  coordYInput,
  isSaving,
  onKeepEditing,
  onConfirmDiscard,
  onUndo,
  onReset,
  onDeleteSelectedVertex,
  onZoomStep,
  onTogglePanMode,
  onResetView,
  onChangeCoordX,
  onChangeCoordY,
  onAddCoordinatePoint,
}: RegionPolygonEditorToolbarProps) {
  const { t } = useLocale();

  return (
    <>
      {editingRegion && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700">
          {t('regionSetup.drawer.editingNotice', {
            id: editingRegion.id,
            version: editingRegion.version,
          })}
        </div>
      )}

      {isConfirmingDiscard && isDirty && (
        <div
          role="region"
          aria-label={t('regionSetup.drawer.discardPrompt')}
          className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 flex flex-wrap items-center justify-between gap-2"
        >
          <span className="font-semibold">{t('regionSetup.drawer.discardPrompt')}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onKeepEditing}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              {t('regionSetup.drawer.keepEditing')}
            </button>
            <button
              type="button"
              onClick={onConfirmDiscard}
              className="rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-rose-700 cursor-pointer"
            >
              {t('regionSetup.drawer.confirmDiscard')}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo || isSaving}
            className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-40"
          >
            {t('regionSetup.drawer.undoPoint')}
          </button>
          <button
            type="button"
            onClick={onReset}
            disabled={pointsCount === 0 || isSaving}
            className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-40"
          >
            {t('regionSetup.drawer.resetDrawing')}
          </button>
          <button
            type="button"
            onClick={onDeleteSelectedVertex}
            disabled={!hasSelectedVertex || isSaving}
            className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-40"
          >
            {t('regionSetup.drawer.deletePoint')}
          </button>
          <button
            type="button"
            onClick={() => onZoomStep(1)}
            disabled={zoomIdx >= ZOOM_STEPS.length - 1 || isSaving}
            className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-40"
          >
            {t('regionSetup.drawer.zoomIn')}
          </button>
          <button
            type="button"
            onClick={() => onZoomStep(-1)}
            disabled={zoomIdx <= 0 || isSaving}
            className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-40"
          >
            {t('regionSetup.drawer.zoomOut')}
          </button>
          <button
            type="button"
            onClick={onTogglePanMode}
            disabled={zoom <= 1 || isSaving}
            aria-pressed={isPanMode}
            className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-40"
          >
            {t('regionSetup.drawer.panMode')}
          </button>
          <button
            type="button"
            onClick={onResetView}
            disabled={zoom === 1 && pan[0] === 0 && pan[1] === 0}
            className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-40"
          >
            {t('regionSetup.drawer.resetView')}
          </button>
          <span
            data-testid="region-zoom-level"
            className="text-[11px] font-mono text-slate-600 px-1"
          >
            {zoom}x
          </span>
        </div>

        <div className="text-xs text-slate-500 flex items-center gap-3">
          <span className="font-semibold text-slate-800">
            {t('regionSetup.drawer.pointsCount', { count: pointsCount })}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1 text-slate-600">
          <span>{t('regionSetup.drawer.coordXLabel')}</span>
          <input
            type="number"
            step="0.0001"
            min="0"
            max="1"
            aria-label={t('regionSetup.drawer.coordXLabel')}
            value={coordXInput}
            onChange={(e) => onChangeCoordX(e.target.value)}
            className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-800"
          />
        </label>
        <label className="flex items-center gap-1 text-slate-600">
          <span>{t('regionSetup.drawer.coordYLabel')}</span>
          <input
            type="number"
            step="0.0001"
            min="0"
            max="1"
            aria-label={t('regionSetup.drawer.coordYLabel')}
            value={coordYInput}
            onChange={(e) => onChangeCoordY(e.target.value)}
            className="w-20 rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-800"
          />
        </label>
        <button
          type="button"
          onClick={onAddCoordinatePoint}
          disabled={isSaving}
          className="rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 cursor-pointer disabled:opacity-40"
        >
          {t('regionSetup.drawer.addPoint')}
        </button>
      </div>
    </>
  );
}

export interface RegionPolygonEditorFooterProps {
  pointsCount: number;
  isSaving: boolean;
  onRequestCancel: () => void;
  onSaveRegion: () => void;
}

export function RegionPolygonEditorFooter({
  pointsCount,
  isSaving,
  onRequestCancel,
  onSaveRegion,
}: RegionPolygonEditorFooterProps) {
  const { t } = useLocale();

  return (
    <div className="flex items-center justify-between border-t border-slate-200/80 pt-3">
      <div className="text-[11px] text-slate-500">
        {t('regionSetup.drawer.shortcutsLabel')}{' '}
        <kbd className="px-1.5 py-0.5 bg-slate-100 rounded-md text-[10px] font-mono border border-slate-200">
          Z
        </kbd>{' '}
        {t('regionSetup.drawer.shortcutUndo')} ·{' '}
        <kbd className="px-1.5 py-0.5 bg-slate-100 rounded-md text-[10px] font-mono border border-slate-200">
          Esc
        </kbd>{' '}
        {t('regionSetup.drawer.shortcutCancel')}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onRequestCancel}
          disabled={isSaving}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-40"
        >
          {t('regionSetup.drawer.cancelDrawing')}
        </button>
        <button
          type="button"
          onClick={onSaveRegion}
          disabled={pointsCount < 3 || isSaving}
          className="rounded-xl bg-[#0F172A] px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-40 flex items-center gap-1.5 shadow-xs"
        >
          {isSaving ? (
            <>
              <span className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
              {t('regionSetup.drawer.saving')}
            </>
          ) : (
            t('regionSetup.drawer.saveRegion')
          )}
        </button>
      </div>
    </div>
  );
}
