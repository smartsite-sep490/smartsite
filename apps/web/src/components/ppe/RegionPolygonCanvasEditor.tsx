import React, { useState, useRef, useEffect } from 'react';
import { IconAlertTriangle } from '../icons';
import { useRegionPointerGesture } from './useRegionPointerGesture';
import { useLocale, type TranslationKey } from '../../i18n/ppe-locale';
import {
  ZOOM_STEPS,
  clampViewportPan,
  mapClientPointToNormalized,
  validateVertexCandidate,
  type NormalizedPoint,
} from './region-polygon-geometry';
import {
  RegionPolygonEditorFooter,
  RegionPolygonEditorToolbar,
} from './RegionPolygonEditorControls';

export interface RegionPolygonCanvasEditorProps {
  points: NormalizedPoint[];
  initialPoints: NormalizedPoint[];
  lastSavedDraft: string | null;
  editingRegion?: { id: string; version: number } | null;
  frame: {
    width: number;
    height: number;
    imageDataUrl: string;
  };
  isImageStale: boolean;
  isSaving: boolean;
  onChangePoints: (next: NormalizedPoint[]) => void;
  onValidationError: (errorKey: TranslationKey | null) => void;
  onClearServerError?: () => void;
  onSaveRegion: () => void;
  onClose: () => void;
}

export function RegionPolygonCanvasEditor({
  points,
  initialPoints,
  lastSavedDraft,
  editingRegion,
  frame,
  isImageStale,
  isSaving,
  onChangePoints,
  onValidationError,
  onClearServerError,
  onSaveRegion,
  onClose,
}: RegionPolygonCanvasEditorProps) {
  const { t } = useLocale();
  const svgRef = useRef<SVGSVGElement | null>(null);

  const [undoStack, setUndoStack] = useState<NormalizedPoint[][]>([]);
  const [selectedVertexIndex, setSelectedVertexIndex] = useState<number | null>(null);
  const [zoomIdx, setZoomIdx] = useState(0);
  const [pan, setPan] = useState<[number, number]>([0, 0]);
  const [isPanMode, setIsPanMode] = useState(false);
  const [coordXInput, setCoordXInput] = useState('0.5');
  const [coordYInput, setCoordYInput] = useState('0.5');
  const [isConfirmingDiscard, setIsConfirmingDiscard] = useState(false);

  const isEditingLocked = isSaving || isImageStale;
  const zoom = ZOOM_STEPS[zoomIdx] ?? 1;
  const currentDraftKey = JSON.stringify(points);
  const initialDraftKey = JSON.stringify(initialPoints);
  const isDirty = currentDraftKey !== initialDraftKey && currentDraftKey !== lastSavedDraft;
  const activeSelectedIdx =
    selectedVertexIndex !== null && selectedVertexIndex < points.length
      ? selectedVertexIndex
      : null;

  useEffect(() => {
    const returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    svgRef.current?.focus();
    return () => {
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, []);

  const commitPoints = (next: NormalizedPoint[]) => {
    if (isEditingLocked) return;
    setUndoStack((prev) => [...prev.slice(-49), points]);
    onChangePoints(next);
    onValidationError(null);
    onClearServerError?.();
    setIsConfirmingDiscard(false);
  };

  const handleUndo = () => {
    if (isEditingLocked) return;
    if (undoStack.length > 0) {
      const previous = undoStack[undoStack.length - 1]!;
      setUndoStack((prev) => prev.slice(0, -1));
      onChangePoints(previous);
    }
    onValidationError(null);
    onClearServerError?.();
    setIsConfirmingDiscard(false);
  };

  const handleReset = () => {
    if (isEditingLocked || points.length === 0) return;
    commitPoints([]);
    setSelectedVertexIndex(null);
    svgRef.current?.focus();
  };

  const handleDeleteSelectedVertex = () => {
    if (isEditingLocked || activeSelectedIdx === null) return;
    const next = points.filter((_, idx) => idx !== activeSelectedIdx);
    commitPoints(next);
    setSelectedVertexIndex(next.length > 0 ? Math.min(activeSelectedIdx, next.length - 1) : null);
    svgRef.current?.focus();
  };

  const handleAddCoordinatePoint = () => {
    const trimmedX = coordXInput.trim();
    const trimmedY = coordYInput.trim();
    const rawX = trimmedX === '' ? Number.NaN : Number(trimmedX);
    const rawY = trimmedY === '' ? Number.NaN : Number(trimmedY);
    const check = validateVertexCandidate(points, rawX, rawY);
    if (!check.ok) {
      onValidationError(check.errorKey);
      return;
    }
    const nextIdx = points.length;
    commitPoints([...points, check.point]);
    setSelectedVertexIndex(nextIdx);
  };

  const handleZoomStep = (delta: number) => {
    const nextIdx = Math.min(ZOOM_STEPS.length - 1, Math.max(0, zoomIdx + delta));
    const nextZoom = ZOOM_STEPS[nextIdx] ?? 1;
    setZoomIdx(nextIdx);
    setPan((prev) => clampViewportPan(prev[0], prev[1], nextZoom));
    if (nextZoom === 1) setIsPanMode(false);
  };

  const handleResetView = () => {
    setZoomIdx(0);
    setPan([0, 0]);
    setIsPanMode(false);
  };

  const handleRequestCancel = () => {
    if (!isDirty) {
      onClose();
      return;
    }
    setIsConfirmingDiscard(true);
  };

  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (isSaving) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (!isDirty) {
        onClose();
      } else if (isConfirmingDiscard) {
        // Second Escape means Keep Editing / cancel confirmation, never discard
        setIsConfirmingDiscard(false);
      } else {
        setIsConfirmingDiscard(true);
      }
      return;
    }

    if (isImageStale) return;

    const target = e.target as HTMLElement | null;
    const tagName = target?.tagName?.toLowerCase();
    if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
      return;
    }

    if (e.key.toLowerCase() === 'z' && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      handleUndo();
      return;
    }
    if ((e.key === '[' || e.key === ']') && points.length > 0) {
      e.preventDefault();
      const step = e.key === ']' ? 1 : -1;
      const base = activeSelectedIdx ?? (step > 0 ? -1 : 0);
      setSelectedVertexIndex((base + step + points.length) % points.length);
      return;
    }
    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      handleZoomStep(1);
      return;
    }
    if (e.key === '-') {
      e.preventDefault();
      handleZoomStep(-1);
      return;
    }
    if (e.key === '0') {
      e.preventDefault();
      handleResetView();
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && activeSelectedIdx !== null) {
      e.preventDefault();
      handleDeleteSelectedVertex();
      return;
    }
    if (
      ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) &&
      activeSelectedIdx !== null
    ) {
      e.preventDefault();
      const pixelStep = e.shiftKey ? 10 : 1;
      const deltaX =
        e.key === 'ArrowRight'
          ? pixelStep / frame.width
          : e.key === 'ArrowLeft'
            ? -pixelStep / frame.width
            : 0;
      const deltaY =
        e.key === 'ArrowDown'
          ? pixelStep / frame.height
          : e.key === 'ArrowUp'
            ? -pixelStep / frame.height
            : 0;
      const [curX, curY] = points[activeSelectedIdx]!;
      const check = validateVertexCandidate(
        points,
        curX + deltaX,
        curY + deltaY,
        activeSelectedIdx,
      );
      if (!check.ok) {
        onValidationError(check.errorKey);
        return;
      }
      commitPoints(points.map((pt, idx) => (idx === activeSelectedIdx ? check.point : pt)));
    }
  };

  const gesture = useRegionPointerGesture({
    points,
    frame,
    zoom,
    pan,
    isPanMode,
    isSaving: isEditingLocked,
    onSelectVertex: setSelectedVertexIndex,
    onPan: setPan,
    onRecordUndo: (previous) => setUndoStack((stack) => [...stack.slice(-49), previous]),
    onChange: onChangePoints,
    onError: onValidationError,
    onClearServerError,
    onChanged: () => setIsConfirmingDiscard(false),
  });
  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (isEditingLocked || gesture.consumeSuppressedClick()) return;
    if (isPanMode || (e.target as Element | null)?.closest?.('[data-vertex-index]')) {
      return;
    }
    if (points.length >= 32) {
      onValidationError('regionSetup.validation.maxPointsClick');
      return;
    }
    const mapped = mapClientPointToNormalized(
      e.clientX,
      e.clientY,
      e.currentTarget.getBoundingClientRect(),
      frame.width,
      frame.height,
      { zoom, panX: pan[0], panY: pan[1] },
    );
    if (!mapped) return;
    if (!mapped.inContentBox) {
      onValidationError('regionSetup.validation.outOfBounds');
      return;
    }
    const check = validateVertexCandidate(points, mapped.rawX, mapped.rawY);
    if (!check.ok) {
      onValidationError(check.errorKey);
      return;
    }
    const nextIdx = points.length;
    commitPoints([...points, check.point]);
    setSelectedVertexIndex(nextIdx);
  };

  const viewBox = `${pan[0] * frame.width} ${pan[1] * frame.height} ${frame.width / zoom} ${frame.height / zoom}`;

  return (
    <div className="space-y-3" data-ppe-region-editor onKeyDown={handleEditorKeyDown}>
      <RegionPolygonEditorToolbar
        editingRegion={editingRegion}
        isConfirmingDiscard={isConfirmingDiscard}
        isDirty={isDirty}
        pointsCount={points.length}
        canUndo={undoStack.length > 0}
        hasSelectedVertex={activeSelectedIdx !== null}
        zoomIdx={zoomIdx}
        zoom={zoom}
        pan={pan}
        isPanMode={isPanMode}
        coordXInput={coordXInput}
        coordYInput={coordYInput}
        isSaving={isEditingLocked}
        onKeepEditing={() => {
          setIsConfirmingDiscard(false);
          svgRef.current?.focus();
        }}
        onConfirmDiscard={onClose}
        onUndo={handleUndo}
        onReset={handleReset}
        onDeleteSelectedVertex={handleDeleteSelectedVertex}
        onZoomStep={handleZoomStep}
        onTogglePanMode={() => setIsPanMode((prev) => !prev)}
        onResetView={handleResetView}
        onChangeCoordX={setCoordXInput}
        onChangeCoordY={setCoordYInput}
        onAddCoordinatePoint={handleAddCoordinatePoint}
      />

      {/* SVG Drawing Canvas on Frozen Frame */}
      <div
        className="relative w-full border border-slate-800 rounded-xl overflow-hidden bg-slate-950 select-none shadow-inner"
        style={{ aspectRatio: `${frame.width} / ${frame.height}` }}
      >
        {isImageStale && (
          <div
            data-testid="stale-image-notice"
            className="absolute top-2 right-2 z-10 rounded-xl bg-amber-950/80 border border-amber-600/50 px-2.5 py-1 text-[11px] text-amber-200 pointer-events-none flex items-center gap-1.5 backdrop-blur-xs"
          >
            <IconAlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
            <span>{t('regionSetup.drawer.stalePixelsNotice')}</span>
          </div>
        )}

        <svg
          ref={svgRef}
          role="region"
          aria-label={t('regionSetup.drawer.canvasAria')}
          tabIndex={0}
          viewBox={viewBox}
          preserveAspectRatio="xMidYMid meet"
          onPointerDown={gesture.onPointerDown}
          onPointerMove={gesture.onPointerMove}
          onPointerUp={gesture.onPointerUp}
          onPointerCancel={gesture.onPointerCancel}
          onLostPointerCapture={gesture.onPointerCancel}
          onClick={handleSvgClick}
          className="absolute inset-0 w-full h-full cursor-crosshair touch-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-3px] focus-visible:outline-white"
        >
          {!isImageStale && (
            <image href={frame.imageDataUrl} width={frame.width} height={frame.height} />
          )}

          {points.length >= 2 && (
            <polyline
              points={points.map(([x, y]) => `${x * frame.width},${y * frame.height}`).join(' ')}
              fill={points.length >= 3 ? 'rgba(59, 130, 246, 0.25)' : 'none'}
              stroke="#3B82F6"
              strokeWidth="2.5"
              strokeDasharray={points.length >= 3 ? 'none' : '4 2'}
            />
          )}

          {points.map(([x, y], idx) => {
            const isSelected = activeSelectedIdx === idx;
            return (
              <g key={idx}>
                <circle
                  role="button"
                  tabIndex={0}
                  data-vertex-index={idx}
                  aria-label={t('regionSetup.drawer.vertexAria', { index: idx + 1, x, y })}
                  aria-pressed={isSelected}
                  cx={x * frame.width}
                  cy={y * frame.height}
                  r={isSelected ? '7' : '5'}
                  fill={isSelected ? '#F59E0B' : '#3B82F6'}
                  stroke="#FFFFFF"
                  strokeWidth="2"
                  onFocus={() => setSelectedVertexIndex(idx)}
                  onClick={(e) => {
                    gesture.onVertexClick(e);
                    setSelectedVertexIndex(idx);
                  }}
                  onPointerDown={(e) => gesture.onVertexPointerDown(e, idx)}
                />
                <text
                  x={x * frame.width + 7}
                  y={y * frame.height - 7}
                  fill="#FFFFFF"
                  fontSize="11"
                  fontWeight="bold"
                  filter="drop-shadow(0px 1px 2px rgba(0,0,0,0.8))"
                >
                  {idx + 1}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <RegionPolygonEditorFooter
        pointsCount={points.length}
        isSaving={isSaving}
        isImageStale={isImageStale}
        onRequestCancel={handleRequestCancel}
        onSaveRegion={onSaveRegion}
      />
    </div>
  );
}
