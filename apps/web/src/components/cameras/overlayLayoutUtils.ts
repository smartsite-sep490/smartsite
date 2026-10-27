import { PPE_ITEMS, type PpeItem } from '@smartsite/contracts/ppe-items';
import type { VideoTestDetection } from './videoTestFixture';

export interface BoundingBoxPixels {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface VisualStyle {
  boxStroke: string;
  badgeBg: string;
  badgeBorder: string;
  badgeText: string;
  lineWidth: number;
}

export type LabelSlot =
  | 'top-left-outside'
  | 'top-left-inside'
  | 'top-right-outside'
  | 'top-right-inside'
  | 'bottom-left-outside'
  | 'bottom-left-inside';

export interface PlacedBadge {
  text: string;
  isShort: boolean;
  rect: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  slot: LabelSlot;
}

export interface PlacedDetectionOverlay {
  trackId: number | null;
  detection: VideoTestDetection;
  boxPx: BoundingBoxPixels;
  badge: PlacedBadge | null; // null when crowded or narrow frame prevents collision-free placement
  style: VisualStyle;
  accessibleSummary: string;
}

export interface LabelPlacementOptions {
  canvasWidth: number;
  canvasHeight: number;
  measureTextWidth: (text: string) => number;
  badgeHeight?: number;
  paddingX?: number;
  margin?: number;
}

function formatItemName(item: PpeItem): string {
  switch (item) {
    case 'HARD_HAT':
      return 'Mũ';
    case 'SAFETY_VEST':
      return 'Áo';
    case 'GLOVES':
      return 'Găng';
    case 'BOOTS':
      return 'Ủng';
    case 'GOGGLES':
      return 'Kính';
  }
}

/**
 * Formats a clean, compact, neutral label without emoji, default icon clutter,
 * or false claims of absolute safety.
 *
 * Semantic Rules:
 * 1. Current missing evidence must rely ONLY on current ppeStatus === 'MISSING'.
 *    - `detection.active` is temporal tracking metadata, NOT proof of current missing evidence.
 * 2. Confirmed vs pending is strictly per-item:
 *    - A current missing item is confirmed only if it intersects `confirmedMissingItems`.
 *    - Otherwise, it is pending confirmation.
 *    - `alertState === 'CONFIRMED'` is aggregate metadata and does not promote a different item's pending evidence.
 * 3. If an item is UNKNOWN or PRESENT in current frame but present in `confirmedMissingItems`,
 *    it is reported as a separate historical note, NEVER as fresh "Thiếu".
 * 4. Technical language: Uses "bằng chứng kỹ thuật / cảnh báo kỹ thuật", avoids "vi phạm".
 */
export function formatPpeCompactLabel(detection: VideoTestDetection): {
  full: string;
  short: string;
  accessibleSummary: string;
} {
  const trackText =
    detection.trackId !== null && detection.trackId !== undefined
      ? `Track #${detection.trackId}`
      : 'Track #?';
  const shortText =
    detection.trackId !== null && detection.trackId !== undefined ? `#${detection.trackId}` : '#?';

  const confirmedList = detection.confirmedMissingItems ?? [];

  // Determine current frame missing, present, and unknown items strictly from defined entries in ppeStatus
  const currentMissingItems: PpeItem[] = [];
  const currentPresentItems: PpeItem[] = [];
  const currentUnknownItems: PpeItem[] = [];

  for (const item of PPE_ITEMS) {
    const status = detection.ppeStatus?.[item];
    if (status === 'MISSING') currentMissingItems.push(item);
    else if (status === 'PRESENT') currentPresentItems.push(item);
    else if (status === 'UNKNOWN') currentUnknownItems.push(item);
  }

  const confirmedCurrentMissing = currentMissingItems.filter((item) =>
    confirmedList.includes(item),
  );
  const pendingCurrentMissing = currentMissingItems.filter((item) => !confirmedList.includes(item));

  // Historical confirmed items: in confirmedList but NOT currently missing in frame
  const historicalConfirmedItems = confirmedList.filter(
    (item) => detection.ppeStatus?.[item] !== 'MISSING',
  );

  // 1. Current frame has missing item(s)
  if (currentMissingItems.length > 0) {
    let missingDesc: string;
    if (confirmedCurrentMissing.length > 0 && pendingCurrentMissing.length === 0) {
      missingDesc = `Thiếu ${confirmedCurrentMissing.map(formatItemName).join(' & ')}`;
    } else if (pendingCurrentMissing.length > 0 && confirmedCurrentMissing.length === 0) {
      missingDesc = `Chờ xác nhận (${pendingCurrentMissing.map(formatItemName).join(' & ')})`;
    } else {
      missingDesc = `Thiếu ${confirmedCurrentMissing.map(formatItemName).join(' & ')} · Chờ ${pendingCurrentMissing.map(formatItemName).join(' & ')}`;
    }

    if (historicalConfirmedItems.length > 0) {
      const historyStr = `Cảnh báo cũ: ${historicalConfirmedItems.map(formatItemName).join(' & ')}`;
      const full = `${trackText} · ${missingDesc} · ${historyStr}`;
      return {
        full,
        short: shortText,
        accessibleSummary: `${trackText}: Bằng chứng kỹ thuật khung hình hiện tại: ${missingDesc}; lưu ý ${historyStr}.`,
      };
    }

    const full = `${trackText} · ${missingDesc}`;
    return {
      full,
      short: shortText,
      accessibleSummary: `${trackText}: Bằng chứng kỹ thuật khung hình hiện tại: ${missingDesc}.`,
    };
  }

  // 2. Current frame has NO missing item, but has historical confirmed items
  if (historicalConfirmedItems.length > 0) {
    const historyNote = 'Có cảnh báo kỹ thuật đã xác nhận';
    if (currentPresentItems.length > 0 && currentUnknownItems.length === 0) {
      const full = `${trackText} · ${currentPresentItems.map(formatItemName).join(' & ')}: Có · ${historyNote}`;
      return {
        full,
        short: shortText,
        accessibleSummary: `${trackText}: Ghi nhận có ${currentPresentItems.map(formatItemName).join(' và ')} trong khung hình; có cảnh báo kỹ thuật đã xác nhận trước đó.`,
      };
    }

    if (currentPresentItems.length > 0) {
      const presentName = `${currentPresentItems.map(formatItemName).join(' & ')}: Có`;
      const full = `${trackText} · ${presentName} · ${historyNote}`;
      return {
        full,
        short: shortText,
        accessibleSummary: `${trackText}: Ghi nhận ${presentName}; trang bị còn lại chưa rõ; có cảnh báo kỹ thuật đã xác nhận trước đó.`,
      };
    }

    const full = `${trackText} · Chưa rõ · ${historyNote}`;
    return {
      full,
      short: shortText,
      accessibleSummary: `${trackText}: Bằng chứng kỹ thuật khung hình hiện tại chưa rõ; có cảnh báo kỹ thuật đã xác nhận trước đó.`,
    };
  }

  // 3. Current frame observed all items PRESENT (note: alertState COMPLIANT alone is NOT proof)
  if (currentPresentItems.length > 0 && currentUnknownItems.length === 0) {
    const full = `${trackText} · ${currentPresentItems.map(formatItemName).join(' & ')}: Có`;
    return {
      full,
      short: shortText,
      accessibleSummary: `${trackText}: Bằng chứng kỹ thuật ghi nhận có ${currentPresentItems.map(formatItemName).join(' và ')} trong khung hình này.`,
    };
  }

  // 4. Partial observations
  if (currentPresentItems.length > 0 && currentUnknownItems.length > 0) {
    if (
      currentPresentItems.length === 1 &&
      currentUnknownItems.length === 1 &&
      currentPresentItems[0] === 'HARD_HAT' &&
      currentUnknownItems[0] === 'SAFETY_VEST'
    ) {
      const full = `${trackText} · Mũ: Có · Áo: Chưa rõ`;
      return {
        full,
        short: shortText,
        accessibleSummary: `${trackText}: Ghi nhận có Mũ bảo hộ; Áo phản quang chưa rõ trong khung hình này.`,
      };
    }
    if (
      currentPresentItems.length === 1 &&
      currentUnknownItems.length === 1 &&
      currentPresentItems[0] === 'SAFETY_VEST' &&
      currentUnknownItems[0] === 'HARD_HAT'
    ) {
      const full = `${trackText} · Mũ: Chưa rõ · Áo: Có`;
      return {
        full,
        short: shortText,
        accessibleSummary: `${trackText}: Ghi nhận có Áo phản quang; Mũ bảo hộ chưa rõ trong khung hình này.`,
      };
    }
    const full = `${trackText} · ${currentPresentItems.map(formatItemName).join(' & ')}: Có · ${currentUnknownItems.map(formatItemName).join(' & ')}: Chưa rõ`;
    return {
      full,
      short: shortText,
      accessibleSummary: `${trackText}: Ghi nhận có ${currentPresentItems.map(formatItemName).join(' và ')}; ${currentUnknownItems.map(formatItemName).join(' và ')} chưa rõ trong khung hình này.`,
    };
  }

  // 5. Default Unknown
  const full = `${trackText} · Chưa rõ`;
  return {
    full,
    short: shortText,
    accessibleSummary: `${trackText}: Chưa đủ bằng chứng kỹ thuật để xác định trang bị bảo hộ trong khung hình này.`,
  };
}

/**
 * Determines neutral palette colors and stroke widths.
 * Minimalist stone/zinc/amber/orange theme; no bright green full-safe assertions.
 */
export function resolveDetectionVisualStyle(
  detection: VideoTestDetection,
  mode: 'ppe' | 'zone',
): VisualStyle {
  if (mode === 'zone') {
    if (detection.active) {
      return {
        boxStroke: '#DF2225',
        badgeBg: '#1C1917',
        badgeBorder: '#DF2225',
        badgeText: '#FFFFFF',
        lineWidth: 2,
      };
    }
    return {
      boxStroke: '#78716C',
      badgeBg: '#1C1917',
      badgeBorder: '#44403C',
      badgeText: '#A8A29E',
      lineWidth: 2,
    };
  }

  // PPE Mode
  const confirmedList = detection.confirmedMissingItems ?? [];

  const currentMissingItems: PpeItem[] = [];
  for (const item of PPE_ITEMS) {
    if (detection.ppeStatus?.[item] === 'MISSING') currentMissingItems.push(item);
  }

  const hasConfirmedCurrent = currentMissingItems.some((item) => confirmedList.includes(item));
  const hasPendingCurrent = currentMissingItems.some((item) => !confirmedList.includes(item));
  const hasConfirmedHistory = confirmedList.length > 0;

  if (hasConfirmedCurrent) {
    return {
      boxStroke: '#EA580C', // Amber-Orange warning
      badgeBg: '#1C1917',
      badgeBorder: '#EA580C',
      badgeText: '#F5F5F4',
      lineWidth: 2,
    };
  }

  if (hasPendingCurrent) {
    return {
      boxStroke: '#D97706', // Muted Amber
      badgeBg: '#1C1917',
      badgeBorder: '#D97706',
      badgeText: '#FDE68A',
      lineWidth: 2,
    };
  }

  if (hasConfirmedHistory) {
    return {
      boxStroke: '#EA580C', // History warning indicator
      badgeBg: '#1C1917',
      badgeBorder: '#EA580C',
      badgeText: '#F5F5F4',
      lineWidth: 2,
    };
  }

  // Observed present or Unknown: neutral stone outline and dark badge
  return {
    boxStroke: '#78716C',
    badgeBg: '#1C1917',
    badgeBorder: '#44403C',
    badgeText: '#E7E5E4',
    lineWidth: 2,
  };
}

export function doRectanglesIntersect(
  r1: { left: number; top: number; width: number; height: number },
  r2: { left: number; top: number; width: number; height: number },
): boolean {
  return !(
    r1.left + r1.width <= r2.left ||
    r1.left >= r2.left + r2.width ||
    r1.top + r1.height <= r2.top ||
    r1.top >= r2.top + r2.height
  );
}

function clamp(value: number, min: number, max: number): number {
  if (min > max) return min;
  return Math.max(min, Math.min(value, max));
}

/**
 * Computes deterministic, collision-avoiding label placements on exact-frame coordinates.
 *
 * Constraints:
 * - Does NOT lerp or interpolate bounding boxes between frames.
 * - Does NOT fabricate component child boxes for helmet or vest.
 * - Does NOT make physical depth claims or sort by foot y2; preserves stable deterministic order.
 * - Preserves exact original box floats for painting (no rounding geometry changes).
 * - Enforces complete rect inside frame boundaries (badgeW <= width, badgeHeight <= height).
 * - Fallback MUST NOT knowingly overlap prior label: if crowded, hides badge (badge: null)
 *   while keeping the exact PERSON box stroke intact.
 */
export function computeOverlayLabels(
  detections: VideoTestDetection[],
  mode: 'ppe' | 'zone',
  options: LabelPlacementOptions,
): PlacedDetectionOverlay[] {
  const {
    canvasWidth,
    canvasHeight,
    measureTextWidth,
    badgeHeight = 18,
    paddingX = 6,
    margin = 4,
  } = options;

  const validDetections = detections.filter(
    (d) =>
      d.boundingBox &&
      Number.isFinite(d.boundingBox.x1) &&
      Number.isFinite(d.boundingBox.y1) &&
      Number.isFinite(d.boundingBox.x2) &&
      Number.isFinite(d.boundingBox.y2) &&
      d.boundingBox.x1 < d.boundingBox.x2 &&
      d.boundingBox.y1 < d.boundingBox.y2,
  );

  // Stable deterministic order without physical-depth claims
  const orderedDetections = [...validDetections];

  const occupiedRects: Array<{ left: number; top: number; width: number; height: number }> = [];
  const results: PlacedDetectionOverlay[] = [];

  for (const det of orderedDetections) {
    const box = det.boundingBox!;
    // Preserve exact original floating-point coordinates for accurate painting
    const boxPx: BoundingBoxPixels = {
      left: box.x1 * canvasWidth,
      top: box.y1 * canvasHeight,
      right: box.x2 * canvasWidth,
      bottom: box.y2 * canvasHeight,
      width: (box.x2 - box.x1) * canvasWidth,
      height: (box.y2 - box.y1) * canvasHeight,
    };

    const style = resolveDetectionVisualStyle(det, mode);

    let fullText: string;
    let shortText: string;
    let accessibleSummary: string;

    if (mode === 'zone') {
      const regionSuffix = det.regionId ? ` · Khu vực: ${det.regionId}` : '';
      fullText = `${det.label} · #${det.trackId ?? '?'}`;
      shortText = `MF05 #${det.trackId ?? '?'}`;
      accessibleSummary = `Track #${det.trackId ?? '?'}${regionSuffix}: ${det.label}.`;
    } else {
      const ppeLabel = formatPpeCompactLabel(det);
      fullText = ppeLabel.full;
      shortText = ppeLabel.short;
      accessibleSummary = ppeLabel.accessibleSummary;
    }

    const badgeWFull = Math.ceil(measureTextWidth(fullText) + paddingX * 2);
    const badgeWShort = Math.ceil(measureTextWidth(shortText) + paddingX * 2);

    interface CandidateSlot {
      slot: LabelSlot;
      rect: { left: number; top: number; width: number; height: number };
      valid: boolean;
    }

    const generateSlots = (badgeW: number): CandidateSlot[] => {
      // If badge width exceeds available frame width or height exceeds frame height, no slot can fit
      if (badgeW > canvasWidth - margin * 2 || badgeHeight > canvasHeight - margin * 2) {
        return [];
      }

      // 1. Top-Left Outside
      const topOutY = boxPx.top - badgeHeight - margin;
      const slotTopLeftOut: CandidateSlot = {
        slot: 'top-left-outside',
        rect: {
          left: clamp(boxPx.left, margin, canvasWidth - badgeW - margin),
          top: topOutY,
          width: badgeW,
          height: badgeHeight,
        },
        valid: topOutY >= margin,
      };

      // 2. Top-Left Inside (Boundary flip when touching top border)
      const topInY = boxPx.top + margin;
      const slotTopLeftIn: CandidateSlot = {
        slot: 'top-left-inside',
        rect: {
          left: clamp(boxPx.left + margin, margin, canvasWidth - badgeW - margin),
          top: topInY,
          width: badgeW,
          height: badgeHeight,
        },
        valid:
          topInY + badgeHeight <= boxPx.bottom - margin &&
          topInY >= margin &&
          topInY + badgeHeight <= canvasHeight - margin,
      };

      // 3. Top-Right Outside
      const slotTopRightOut: CandidateSlot = {
        slot: 'top-right-outside',
        rect: {
          left: clamp(boxPx.right - badgeW, margin, canvasWidth - badgeW - margin),
          top: topOutY,
          width: badgeW,
          height: badgeHeight,
        },
        valid: topOutY >= margin,
      };

      // 4. Top-Right Inside
      const slotTopRightIn: CandidateSlot = {
        slot: 'top-right-inside',
        rect: {
          left: clamp(boxPx.right - badgeW - margin, margin, canvasWidth - badgeW - margin),
          top: topInY,
          width: badgeW,
          height: badgeHeight,
        },
        valid:
          topInY + badgeHeight <= boxPx.bottom - margin &&
          topInY >= margin &&
          topInY + badgeHeight <= canvasHeight - margin,
      };

      // 5. Bottom-Left Outside
      const botOutY = boxPx.bottom + margin;
      const slotBottomLeftOut: CandidateSlot = {
        slot: 'bottom-left-outside',
        rect: {
          left: clamp(boxPx.left, margin, canvasWidth - badgeW - margin),
          top: botOutY,
          width: badgeW,
          height: badgeHeight,
        },
        valid: botOutY + badgeHeight <= canvasHeight - margin,
      };

      // 6. Bottom-Left Inside
      const botInY = boxPx.bottom - badgeHeight - margin;
      const slotBottomLeftIn: CandidateSlot = {
        slot: 'bottom-left-inside',
        rect: {
          left: clamp(boxPx.left + margin, margin, canvasWidth - badgeW - margin),
          top: botInY,
          width: badgeW,
          height: badgeHeight,
        },
        valid:
          botInY >= boxPx.top + margin &&
          botInY >= margin &&
          botInY + badgeHeight <= canvasHeight - margin,
      };

      // Order of candidate evaluation: prefer inside if box touches top border
      if (boxPx.top - badgeHeight - margin < margin) {
        return [
          slotTopLeftIn,
          slotTopRightIn,
          slotBottomLeftOut,
          slotBottomLeftIn,
          slotTopLeftOut,
          slotTopRightOut,
        ];
      }

      return [
        slotTopLeftOut,
        slotTopRightOut,
        slotTopLeftIn,
        slotTopRightIn,
        slotBottomLeftOut,
        slotBottomLeftIn,
      ];
    };

    // Helper: strictly enforce complete rect inside frame boundaries
    const isStrictlyInFrame = (r: { left: number; top: number; width: number; height: number }) =>
      r.left >= 0 &&
      r.top >= 0 &&
      r.left + r.width <= canvasWidth &&
      r.top + r.height <= canvasHeight;

    // Step A: Attempt to place FULL label
    const fullCandidates = generateSlots(badgeWFull);
    let chosenBadge: PlacedBadge | null = null;

    for (const cand of fullCandidates) {
      if (!cand.valid || !isStrictlyInFrame(cand.rect)) continue;
      const collides = occupiedRects.some((r) => doRectanglesIntersect(cand.rect, r));
      if (!collides) {
        chosenBadge = {
          text: fullText,
          isShort: false,
          rect: cand.rect,
          slot: cand.slot,
        };
        break;
      }
    }

    // Step B: If all full slots collide or overflow, try SHORT label
    if (!chosenBadge) {
      const shortCandidates = generateSlots(badgeWShort);
      for (const cand of shortCandidates) {
        if (!cand.valid || !isStrictlyInFrame(cand.rect)) continue;
        const collides = occupiedRects.some((r) => doRectanglesIntersect(cand.rect, r));
        if (!collides) {
          chosenBadge = {
            text: shortText,
            isShort: true,
            rect: cand.rect,
            slot: cand.slot,
          };
          break;
        }
      }
    }

    // Step C: Fallback MUST NOT knowingly overlap prior label.
    // If crowded or narrow, hide badge (badge = null) while keeping the exact PERSON box stroke intact.
    if (chosenBadge) {
      occupiedRects.push(chosenBadge.rect);
    }

    results.push({
      trackId: det.trackId,
      detection: det,
      boxPx,
      badge: chosenBadge,
      style,
      accessibleSummary: chosenBadge
        ? `${accessibleSummary} [Nhãn: ${chosenBadge.text}]`
        : `${accessibleSummary} [Nhãn bị ẩn do mật độ cao hoặc khung hình hẹp]`,
    });
  }

  return results;
}
