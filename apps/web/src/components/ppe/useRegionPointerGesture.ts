import { useCallback, useEffect, useRef } from 'react';
import type { MouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { TranslationKey } from '../../i18n/ppe-locale';
import {
  clampViewportPan,
  mapClientPointToNormalized,
  validateVertexCandidate,
  type NormalizedPoint,
} from './region-polygon-geometry';

type Drag = {
  pointerId: number;
  target: Element;
  startX: number;
  startY: number;
  moved: boolean;
} & (
  | { kind: 'pan'; startPan: [number, number] }
  | { kind: 'vertex'; index: number; original: NormalizedPoint[]; recordedUndo: boolean }
);

interface GestureOptions {
  points: NormalizedPoint[];
  frame: { width: number; height: number };
  zoom: number;
  pan: [number, number];
  isPanMode: boolean;
  isSaving: boolean;
  onSelectVertex: (index: number) => void;
  onPan: (pan: [number, number]) => void;
  onRecordUndo: (points: NormalizedPoint[]) => void;
  onChange: (points: NormalizedPoint[]) => void;
  onError: (key: TranslationKey | null) => void;
  onClearServerError?: () => void;
  onChanged: () => void;
}

const pointerIdOf = (event: { pointerId: number }) =>
  Number.isFinite(event.pointerId) ? event.pointerId : 0;

/** Owns one pointer gesture, including release outside the SVG and cancellation. */
export function useRegionPointerGesture(options: GestureOptions) {
  const dragRef = useRef<Drag | null>(null);
  const suppressClickRef = useRef(false);

  const finish = useCallback((pointerId: number | null, trailingClick: boolean) => {
    const drag = dragRef.current;
    if (!drag || (pointerId !== null && drag.pointerId !== pointerId)) return;
    dragRef.current = null;
    suppressClickRef.current = trailingClick && drag.moved;
    if (drag.target.hasPointerCapture?.(drag.pointerId)) {
      drag.target.releasePointerCapture(drag.pointerId);
    }
  }, []);

  useEffect(() => {
    const release = (event: PointerEvent) => {
      // An SVG release already finished its gesture before reaching window.
      finish(pointerIdOf(event), false);
    };
    const blur = () => finish(null, false);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      window.removeEventListener('blur', blur);
      finish(null, false);
    };
  }, [finish]);

  useEffect(() => {
    if (options.isSaving) finish(null, false);
  }, [options.isSaving, finish]);

  const capture = (event: ReactPointerEvent<SVGElement>) => {
    event.currentTarget.setPointerCapture?.(pointerIdOf(event));
  };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (options.isSaving || dragRef.current || !options.isPanMode || options.zoom <= 1) return;
    dragRef.current = {
      kind: 'pan',
      pointerId: pointerIdOf(event),
      target: event.currentTarget,
      startX: event.clientX,
      startY: event.clientY,
      startPan: options.pan,
      moved: false,
    };
    capture(event);
  };

  const onVertexPointerDown = (event: ReactPointerEvent<SVGCircleElement>, index: number) => {
    event.stopPropagation();
    if (options.isSaving || options.isPanMode || dragRef.current) return;
    options.onSelectVertex(index);
    dragRef.current = {
      kind: 'vertex',
      pointerId: pointerIdOf(event),
      target: event.currentTarget,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      index,
      original: options.points.map(([x, y]) => [x, y]),
      recordedUndo: false,
    };
    capture(event);
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (options.isSaving || !drag || pointerIdOf(event) !== drag.pointerId) return;
    if (event.clientX === drag.startX && event.clientY === drag.startY && !drag.moved) return;
    const mapped = mapClientPointToNormalized(
      event.clientX,
      event.clientY,
      event.currentTarget.getBoundingClientRect(),
      options.frame.width,
      options.frame.height,
      { zoom: options.zoom, panX: options.pan[0], panY: options.pan[1] },
    );
    if (!mapped) return;
    drag.moved = true;
    suppressClickRef.current = true;
    if (drag.kind === 'pan') {
      options.onPan(
        clampViewportPan(
          drag.startPan[0] - (event.clientX - drag.startX) / mapped.contentWidth / options.zoom,
          drag.startPan[1] - (event.clientY - drag.startY) / mapped.contentHeight / options.zoom,
          options.zoom,
        ),
      );
      return;
    }
    if (!mapped.inContentBox) {
      options.onError('regionSetup.validation.outOfBounds');
      return;
    }
    const check = validateVertexCandidate(options.points, mapped.rawX, mapped.rawY, drag.index);
    if (!check.ok) {
      options.onError(check.errorKey);
      return;
    }
    if (!drag.recordedUndo) {
      options.onRecordUndo(drag.original);
      drag.recordedUndo = true;
    }
    options.onChange(
      options.points.map((point, index) => (index === drag.index ? check.point : point)),
    );
    options.onError(null);
    options.onClearServerError?.();
    options.onChanged();
  };

  return {
    onPointerDown,
    onPointerMove,
    onVertexPointerDown,
    onPointerUp: (event: ReactPointerEvent<SVGSVGElement>) => finish(pointerIdOf(event), true),
    onPointerCancel: (event: ReactPointerEvent<SVGSVGElement>) => finish(pointerIdOf(event), false),
    onVertexClick: (event: MouseEvent<SVGCircleElement>) => {
      event.stopPropagation();
      suppressClickRef.current = false;
    },
    consumeSuppressedClick: () => {
      const suppressed = suppressClickRef.current;
      suppressClickRef.current = false;
      return suppressed;
    },
  };
}
