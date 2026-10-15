import type { TranslationKey } from '../../i18n/ppe-locale';

export type NormalizedPoint = [number, number];

export interface ViewportTransform {
  zoom: number;
  panX: number;
  panY: number;
}

export const ZOOM_STEPS = [1, 1.5, 2, 3, 4] as const;

export function quantizeCoord(value: number): number {
  return Number(value.toFixed(4));
}

// Draft coordinates are quantized to 4 decimals by toFixed(4); use integer shoelace to avoid floating-point cancellation.
export function calculatePolygonArea(coords: NormalizedPoint[]): number {
  let crossSum = 0;
  const n = coords.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = coords[i]!;
    const [x2, y2] = coords[(i + 1) % n]!;
    const ix1 = Math.round(x1 * 10000);
    const iy1 = Math.round(y1 * 10000);
    const ix2 = Math.round(x2 * 10000);
    const iy2 = Math.round(y2 * 10000);
    crossSum += ix1 * iy2 - ix2 * iy1;
  }
  return Math.abs(crossSum) / (2 * 10000 * 10000);
}

function orientation(p: NormalizedPoint, q: NormalizedPoint, r: NormalizedPoint): number {
  const val = (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]);
  if (Math.abs(val) < 1e-9) return 0; // Collinear
  return val > 0 ? 1 : 2; // 1: Clockwise, 2: Counterclockwise
}

function onSegment(p: NormalizedPoint, q: NormalizedPoint, r: NormalizedPoint): boolean {
  return (
    q[0] <= Math.max(p[0], r[0]) + 1e-9 &&
    q[0] >= Math.min(p[0], r[0]) - 1e-9 &&
    q[1] <= Math.max(p[1], r[1]) + 1e-9 &&
    q[1] >= Math.min(p[1], r[1]) - 1e-9
  );
}

function segmentsIntersectOrOverlap(
  p1: NormalizedPoint,
  q1: NormalizedPoint,
  p2: NormalizedPoint,
  q2: NormalizedPoint,
  isAdjacent: boolean,
): boolean {
  const o1 = orientation(p1, q1, p2);
  const o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1);
  const o4 = orientation(p2, q2, q1);

  if (isAdjacent) {
    // Adjacent edges share an endpoint. Check if they fold back on each other (180 degree overlap).
    if (o1 === 0 && o2 === 0) {
      if (
        onSegment(p1, q2, q1) &&
        (Math.abs(q2[0] - q1[0]) > 1e-6 || Math.abs(q2[1] - q1[1]) > 1e-6)
      ) {
        return true;
      }
      if (
        onSegment(p2, p1, q2) &&
        (Math.abs(p1[0] - p2[0]) > 1e-6 || Math.abs(p1[1] - p2[1]) > 1e-6)
      ) {
        return true;
      }
    }
    return false;
  }

  // Non-adjacent edges:
  // 1. General proper crossing:
  if (o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0) {
    return true;
  }

  // 2. Collinear overlaps or point touches non-adjacent edge:
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;

  return false;
}

export function validatePolygonGeometry(coords: NormalizedPoint[]): TranslationKey | null {
  const n = coords.length;
  if (n < 3) return 'regionSetup.validation.minPoints';
  if (n > 32) return 'regionSetup.validation.maxPoints';

  // Reject any repeated vertex (not just consecutive)
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (
        Math.abs(coords[i]![0] - coords[j]![0]) < 1e-6 &&
        Math.abs(coords[i]![1] - coords[j]![1]) < 1e-6
      ) {
        return 'regionSetup.validation.duplicateVertices';
      }
    }
  }

  // Zero degenerate area only (no arbitrary threshold)
  const area = calculatePolygonArea(coords);
  if (area <= 0) {
    return 'regionSetup.validation.zeroArea';
  }

  // Check self-intersections and collinear overlaps
  for (let i = 0; i < n; i++) {
    const p1 = coords[i]!;
    const q1 = coords[(i + 1) % n]!;

    for (let j = i + 1; j < n; j++) {
      const isAdjacent = j === i + 1 || (i === 0 && j === n - 1);
      const p2 = coords[j]!;
      const q2 = coords[(j + 1) % n]!;

      // Put the shared endpoint at q1 === p2 for the closing adjacent pair too.
      const intersects =
        i === 0 && j === n - 1
          ? segmentsIntersectOrOverlap(p2, q2, p1, q1, true)
          : segmentsIntersectOrOverlap(p1, q1, p2, q2, isAdjacent);
      if (intersects) {
        return 'regionSetup.validation.selfIntersect';
      }
    }
  }

  return null;
}

export function validateVertexCandidate(
  coords: NormalizedPoint[],
  rawX: number,
  rawY: number,
  ignoreIndex?: number,
): { ok: true; point: NormalizedPoint } | { ok: false; errorKey: TranslationKey } {
  if (ignoreIndex === undefined && coords.length >= 32) {
    return { ok: false, errorKey: 'regionSetup.validation.maxPointsClick' };
  }

  // Strictly reject out-of-bounds coordinates for add, drag, and nudge; never silently clamp.
  if (
    !Number.isFinite(rawX) ||
    !Number.isFinite(rawY) ||
    rawX < 0 ||
    rawX > 1 ||
    rawY < 0 ||
    rawY > 1
  ) {
    return { ok: false, errorKey: 'regionSetup.validation.outOfBounds' };
  }

  const normX = quantizeCoord(rawX);
  const normY = quantizeCoord(rawY);

  for (let i = 0; i < coords.length; i++) {
    if (i === ignoreIndex) continue;
    const [px, py] = coords[i]!;
    if (Math.abs(px - normX) < 1e-6 && Math.abs(py - normY) < 1e-6) {
      return { ok: false, errorKey: 'regionSetup.validation.duplicateVertexClick' };
    }
  }

  return { ok: true, point: [normX, normY] };
}

export function clampViewportPan(panX: number, panY: number, zoom: number): [number, number] {
  const safeZoom = Number.isFinite(zoom) && zoom >= 1 ? zoom : 1;
  const maxPan = Math.max(0, 1 - 1 / safeZoom);
  const clampedX = Math.min(maxPan, Math.max(0, Number.isFinite(panX) ? panX : 0));
  const clampedY = Math.min(maxPan, Math.max(0, Number.isFinite(panY) ? panY : 0));
  return [clampedX, clampedY];
}

export function mapClientPointToNormalized(
  clientX: number,
  clientY: number,
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  frameWidth: number,
  frameHeight: number,
  viewport: ViewportTransform,
): {
  rawX: number;
  rawY: number;
  inContentBox: boolean;
  contentWidth: number;
  contentHeight: number;
} | null {
  if (
    rect.width <= 0 ||
    rect.height <= 0 ||
    frameWidth <= 0 ||
    frameHeight <= 0 ||
    viewport.zoom <= 0
  ) {
    return null;
  }

  const scale = Math.min(rect.width / frameWidth, rect.height / frameHeight);
  const contentWidth = frameWidth * scale;
  const contentHeight = frameHeight * scale;
  const contentLeft = rect.left + (rect.width - contentWidth) / 2;
  const contentTop = rect.top + (rect.height - contentHeight) / 2;

  const u = (clientX - contentLeft) / contentWidth;
  const v = (clientY - contentTop) / contentHeight;
  const inContentBox = u >= 0 && u <= 1 && v >= 0 && v <= 1;

  const rawX = viewport.panX + u / viewport.zoom;
  const rawY = viewport.panY + v / viewport.zoom;

  return {
    rawX,
    rawY,
    inContentBox,
    contentWidth,
    contentHeight,
  };
}

export function extractRegionPolygonCoordinates(polygon: unknown): NormalizedPoint[] | null {
  if (typeof polygon !== 'object' || polygon === null || Array.isArray(polygon)) {
    return null;
  }
  const rawCoords = (polygon as { coordinates?: unknown }).coordinates;
  if (!Array.isArray(rawCoords) || rawCoords.length < 3 || rawCoords.length > 32) {
    return null;
  }

  const parsed: NormalizedPoint[] = [];
  for (const item of rawCoords) {
    if (!Array.isArray(item) || item.length !== 2) {
      return null;
    }
    const [x, y] = item as [unknown, unknown];
    if (
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      x < 0 ||
      x > 1 ||
      y < 0 ||
      y > 1
    ) {
      return null;
    }
    parsed.push([quantizeCoord(x), quantizeCoord(y)]);
  }

  if (validatePolygonGeometry(parsed) !== null) {
    return null;
  }

  return parsed;
}
