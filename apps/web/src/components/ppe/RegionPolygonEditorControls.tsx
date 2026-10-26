import React from 'react';
import { useTranslation } from 'react-i18next';
import { registerFeatureCatalog } from '../../i18n/feature-catalog-registry';
import { useLocale } from '../../i18n/ppe-locale';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import { ZOOM_STEPS } from './region-polygon-geometry';

registerFeatureCatalog({
  en: {
    'regionSetup.drawer.editingGroup': 'Point editing',
    'regionSetup.drawer.viewGroup': 'Canvas view',
  },
  vi: {
    'regionSetup.drawer.editingGroup': 'Chỉnh sửa điểm',
    'regionSetup.drawer.viewGroup': 'Khung nhìn',
  },
});

const PRIMARY_CONTROL_BUTTON_CLASS =
  'rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 shadow-2xs hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F172A]';

const SUBORDINATE_DESTRUCTIVE_BUTTON_CLASS =
  'rounded-lg border border-transparent bg-transparent px-2 py-1 text-xs font-medium text-slate-600 hover:border-rose-200 hover:bg-rose-50/70 hover:text-rose-800 transition-colors cursor-pointer disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F172A]';

const SUBORDINATE_VIEW_RESET_BUTTON_CLASS =
  'rounded-lg border border-transparent bg-transparent px-2 py-1 text-xs font-medium text-slate-600 hover:border-slate-200 hover:bg-white hover:text-slate-900 transition-colors cursor-pointer disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F172A]';

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
  const { t: tFeature } = useTranslation(SAFETY_NAMESPACE);
  const editingGroupLabel = tFeature('regionSetup.drawer.editingGroup');
  const viewGroupLabel = tFeature('regionSetup.drawer.viewGroup');

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
              disabled={isSaving}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F172A]"
            >
              {t('regionSetup.drawer.keepEditing')}
            </button>
            <button
              type="button"
              onClick={onConfirmDiscard}
              disabled={isSaving}
              className="rounded-lg bg-rose-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-rose-700 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-700"
            >
              {t('regionSetup.drawer.confirmDiscard')}
            </button>
          </div>
        </div>
      )}

      <div
        data-tour-anchor="polygon-edit-controls"
        className="grid grid-cols-1 gap-2.5 md:grid-cols-2"
      >
        <div
          role="group"
          aria-label={editingGroupLabel}
          className="rounded-xl border border-slate-200/90 bg-slate-50/70 p-2.5 space-y-2"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {editingGroupLabel}
              </span>
              <span className="rounded-md border border-slate-200/80 bg-white px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-800">
                {t('regionSetup.drawer.pointsCount', { count: pointsCount })}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={onUndo}
                disabled={!canUndo || isSaving}
                data-control-priority="primary"
                className={PRIMARY_CONTROL_BUTTON_CLASS}
              >
                {t('regionSetup.drawer.undoPoint')}
              </button>
              <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-slate-200/90" />
              <button
                type="button"
                onClick={onDeleteSelectedVertex}
                disabled={!hasSelectedVertex || isSaving}
                data-control-priority="subordinate"
                className={SUBORDINATE_DESTRUCTIVE_BUTTON_CLASS}
              >
                {t('regionSetup.drawer.deletePoint')}
              </button>
              <button
                type="button"
                onClick={onReset}
                disabled={pointsCount === 0 || isSaving}
                data-control-priority="subordinate"
                className={SUBORDINATE_DESTRUCTIVE_BUTTON_CLASS}
              >
                {t('regionSetup.drawer.resetDrawing')}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-slate-200/70 pt-2 text-xs">
            <label className="flex items-center gap-1 text-slate-600">
              <span>{t('regionSetup.drawer.coordXLabel')}</span>
              <input
                type="number"
                step="0.0001"
                min="0"
                max="1"
                disabled={isSaving}
                aria-label={t('regionSetup.drawer.coordXLabel')}
                value={coordXInput}
                onChange={(e) => onChangeCoordX(e.target.value)}
                className="w-20 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-mono tabular-nums text-slate-800 disabled:opacity-40 focus-visible:border-[#0F172A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F172A]"
              />
            </label>
            <label className="flex items-center gap-1 text-slate-600">
              <span>{t('regionSetup.drawer.coordYLabel')}</span>
              <input
                type="number"
                step="0.0001"
                min="0"
                max="1"
                disabled={isSaving}
                aria-label={t('regionSetup.drawer.coordYLabel')}
                value={coordYInput}
                onChange={(e) => onChangeCoordY(e.target.value)}
                className="w-20 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-mono tabular-nums text-slate-800 disabled:opacity-40 focus-visible:border-[#0F172A] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F172A]"
              />
            </label>
            <button
              type="button"
              onClick={onAddCoordinatePoint}
              disabled={isSaving}
              data-control-priority="primary"
              className={PRIMARY_CONTROL_BUTTON_CLASS}
            >
              {t('regionSetup.drawer.addPoint')}
            </button>
          </div>
        </div>

        <div
          role="group"
          aria-label={viewGroupLabel}
          className="rounded-xl border border-slate-200/90 bg-slate-50/70 p-2.5 flex flex-col justify-between gap-2"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              {viewGroupLabel}
            </span>
            <span
              data-testid="region-zoom-level"
              className="rounded-md border border-slate-200/80 bg-white px-2 py-0.5 text-[11px] font-mono font-semibold tabular-nums text-slate-700"
            >
              {zoom}x
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-1.5 border-t border-slate-200/70 pt-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => onZoomStep(1)}
                disabled={zoomIdx >= ZOOM_STEPS.length - 1 || isSaving}
                data-control-priority="primary"
                className={PRIMARY_CONTROL_BUTTON_CLASS}
              >
                {t('regionSetup.drawer.zoomIn')}
              </button>
              <button
                type="button"
                onClick={() => onZoomStep(-1)}
                disabled={zoomIdx <= 0 || isSaving}
                data-control-priority="primary"
                className={PRIMARY_CONTROL_BUTTON_CLASS}
              >
                {t('regionSetup.drawer.zoomOut')}
              </button>
              <button
                type="button"
                onClick={onTogglePanMode}
                disabled={zoom <= 1 || isSaving}
                aria-pressed={isPanMode}
                data-control-priority="primary"
                className={`rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F172A] ${
                  isPanMode
                    ? 'border-[#0F172A] bg-[#0F172A] text-white hover:bg-slate-800'
                    : 'border-slate-200 bg-white text-slate-800 shadow-2xs hover:bg-slate-50'
                }`}
              >
                {t('regionSetup.drawer.panMode')}
              </button>
            </div>

            <div className="flex items-center gap-1">
              <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-slate-200/90" />
              <button
                type="button"
                onClick={onResetView}
                disabled={(zoom === 1 && pan[0] === 0 && pan[1] === 0) || isSaving}
                data-control-priority="subordinate"
                className={SUBORDINATE_VIEW_RESET_BUTTON_CLASS}
              >
                {t('regionSetup.drawer.resetView')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export interface RegionPolygonEditorFooterProps {
  pointsCount: number;
  isSaving: boolean;
  isImageStale?: boolean;
  canSave?: boolean;
  onRequestCancel: () => void;
  onSaveRegion: () => void;
}

export function RegionPolygonEditorFooter({
  pointsCount,
  isSaving,
  isImageStale = false,
  canSave = true,
  onRequestCancel,
  onSaveRegion,
}: RegionPolygonEditorFooterProps) {
  const { t } = useLocale();

  return (
    <div
      data-tour-anchor="polygon-save-footer"
      className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/80 pt-3"
    >
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
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onRequestCancel}
          disabled={isSaving}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F172A]"
        >
          {t('regionSetup.drawer.cancelDrawing')}
        </button>
        <button
          type="button"
          onClick={onSaveRegion}
          disabled={pointsCount < 3 || isSaving || isImageStale || !canSave}
          className="rounded-xl bg-[#0F172A] px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 shadow-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0F172A]"
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
