export const C02_MASK_GRID_SIZE = 10_000;
export const C02_MAX_MASKS = 32;
export const C02_MIN_DRAG_SPAN_BP = 100;

export interface MaskRectBp {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface BasisPoint {
  x: number;
  y: number;
}

export interface ContainedImageRect {
  left: number;
  top: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

export function computeContainedImageRect(
  containerRect: { left: number; top: number; width: number; height: number },
  naturalWidth: number,
  naturalHeight: number,
): ContainedImageRect | null {
  if (
    !Number.isFinite(containerRect.width) ||
    !Number.isFinite(containerRect.height) ||
    containerRect.width <= 0 ||
    containerRect.height <= 0 ||
    !Number.isFinite(naturalWidth) ||
    !Number.isFinite(naturalHeight) ||
    naturalWidth <= 0 ||
    naturalHeight <= 0
  ) {
    return null;
  }
  const scale = Math.min(containerRect.width / naturalWidth, containerRect.height / naturalHeight);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;
  if (width <= 0 || height <= 0) return null;
  const offsetX = (containerRect.width - width) / 2;
  const offsetY = (containerRect.height - height) / 2;
  return {
    left: containerRect.left + offsetX,
    top: containerRect.top + offsetY,
    width,
    height,
    offsetX,
    offsetY,
  };
}

export function mapPointerToBasisPoints(
  clientX: number,
  clientY: number,
  contained: ContainedImageRect,
): BasisPoint {
  const normX = Math.min(1, Math.max(0, (clientX - contained.left) / contained.width));
  const normY = Math.min(1, Math.max(0, (clientY - contained.top) / contained.height));
  return {
    x: Math.min(C02_MASK_GRID_SIZE, Math.max(0, Math.round(normX * C02_MASK_GRID_SIZE))),
    y: Math.min(C02_MASK_GRID_SIZE, Math.max(0, Math.round(normY * C02_MASK_GRID_SIZE))),
  };
}

export function normalizeMaskFromPoints(
  start: BasisPoint,
  end: BasisPoint,
  minSpanBp = C02_MIN_DRAG_SPAN_BP,
): MaskRectBp | null {
  const left = Math.max(0, Math.min(start.x, end.x));
  const right = Math.min(C02_MASK_GRID_SIZE, Math.max(start.x, end.x));
  const top = Math.max(0, Math.min(start.y, end.y));
  const bottom = Math.min(C02_MASK_GRID_SIZE, Math.max(start.y, end.y));
  if (right - left < minSpanBp || bottom - top < minSpanBp || left >= right || top >= bottom) {
    return null;
  }
  return { left, top, right, bottom };
}

export function parsePercentMaskDraft(draft: {
  left: string;
  top: string;
  right: string;
  bottom: string;
}): MaskRectBp | null {
  const { left, top, right, bottom } = draft;
  const values = [left, top, right, bottom];
  if (
    values.some((v) => !/^\d{1,3}$/.test(v) || Number(v) > 100) ||
    Number(left) >= Number(right) ||
    Number(top) >= Number(bottom)
  ) {
    return null;
  }
  return {
    left: Number(left) * 100,
    top: Number(top) * 100,
    right: Number(right) * 100,
    bottom: Number(bottom) * 100,
  };
}

export function formatMaskPercentSummary(mask: MaskRectBp): string {
  const fmt = (bp: number) => Math.round(bp / 100);
  return `${fmt(mask.left)}%–${fmt(mask.right)}% × ${fmt(mask.top)}%–${fmt(mask.bottom)}%`;
}
