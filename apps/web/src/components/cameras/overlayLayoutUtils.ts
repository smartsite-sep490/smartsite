import { PPE_ITEMS, type PpeItem } from '@smartsite/contracts/ppe-items';
import type { VideoTestDetection } from './videoTestFixture';

export type PpeEvidenceStatus = VideoTestDetection['ppeStatus']['HARD_HAT'];

export type OverlayDetection = Omit<VideoTestDetection, 'confirmedMissingItems' | 'ppeStatus'> & {
  confirmedMissingItems?: readonly PpeItem[];
  ppeStatus: VideoTestDetection['ppeStatus'] & Partial<Record<PpeItem, PpeEvidenceStatus>>;
};

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

export interface PlacedDetectionOverlay<T extends OverlayDetection = VideoTestDetection> {
  trackId: number | null;
  detection: T;
  boxPx: BoundingBoxPixels;
  badge: PlacedBadge | null; // null when crowded or narrow frame prevents collision-free placement
  style: VisualStyle;
  accessibleSummary: string;
}

export type OverlayLabelLocale = 'en' | 'vi';

export interface LabelPlacementOptions {
  canvasWidth: number;
  canvasHeight: number;
  measureTextWidth: (text: string) => number;
  badgeHeight?: number;
  paddingX?: number;
  margin?: number;
  locale?: OverlayLabelLocale;
}

function formatItemName(item: PpeItem, locale: OverlayLabelLocale = 'vi'): string {
  if (locale === 'en') {
    switch (item) {
      case 'HARD_HAT':
        return 'Hard hat';
      case 'SAFETY_VEST':
        return 'Vest';
      case 'GLOVES':
        return 'Gloves';
      case 'BOOTS':
        return 'Boots';
      case 'GOGGLES':
        return 'Goggles';
    }
  }
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
 * Formats a compact, neutral PPE label from current-frame ppeStatus evidence
 * and per-item confirmedMissingItems history without false full-safe claims.
 */
export function formatPpeCompactLabel(
  detection: OverlayDetection,
  locale: OverlayLabelLocale = 'vi',
): {
  full: string;
  short: string;
  accessibleSummary: string;
} {
  const isEn = locale === 'en';
  const itemLabel = (item: PpeItem) => formatItemName(item, locale);
  const andWord = isEn ? ' and ' : ' và ';

  const trackText =
    detection.trackId !== null && detection.trackId !== undefined
      ? `Track #${detection.trackId}`
      : 'Track #?';
  const shortText =
    detection.trackId !== null && detection.trackId !== undefined ? `#${detection.trackId}` : '#?';

  const confirmedList = detection.confirmedMissingItems ?? [];

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

  const historicalConfirmedItems = confirmedList.filter(
    (item) => detection.ppeStatus?.[item] !== 'MISSING',
  );

  // 1. Current frame has missing item(s)
  if (currentMissingItems.length > 0) {
    let missingDesc: string;
    if (confirmedCurrentMissing.length > 0 && pendingCurrentMissing.length === 0) {
      missingDesc = isEn
        ? `Missing ${confirmedCurrentMissing.map(itemLabel).join(' & ')}`
        : `Thiếu ${confirmedCurrentMissing.map(itemLabel).join(' & ')}`;
    } else if (pendingCurrentMissing.length > 0 && confirmedCurrentMissing.length === 0) {
      missingDesc = isEn
        ? `Pending confirmation (${pendingCurrentMissing.map(itemLabel).join(' & ')})`
        : `Chờ xác nhận (${pendingCurrentMissing.map(itemLabel).join(' & ')})`;
    } else {
      missingDesc = isEn
        ? `Missing ${confirmedCurrentMissing.map(itemLabel).join(' & ')} · Pending ${pendingCurrentMissing.map(itemLabel).join(' & ')}`
        : `Thiếu ${confirmedCurrentMissing.map(itemLabel).join(' & ')} · Chờ ${pendingCurrentMissing.map(itemLabel).join(' & ')}`;
    }

    if (historicalConfirmedItems.length > 0) {
      const historyStr = isEn
        ? `Prior alert: ${historicalConfirmedItems.map(itemLabel).join(' & ')}`
        : `Cảnh báo cũ: ${historicalConfirmedItems.map(itemLabel).join(' & ')}`;
      const full = `${trackText} · ${missingDesc} · ${historyStr}`;
      return {
        full,
        short: shortText,
        accessibleSummary: isEn
          ? `${trackText}: Current frame technical evidence: ${missingDesc}; note ${historyStr}.`
          : `${trackText}: Bằng chứng kỹ thuật khung hình hiện tại: ${missingDesc}; lưu ý ${historyStr}.`,
      };
    }

    const full = `${trackText} · ${missingDesc}`;
    return {
      full,
      short: shortText,
      accessibleSummary: isEn
        ? `${trackText}: Current frame technical evidence: ${missingDesc}.`
        : `${trackText}: Bằng chứng kỹ thuật khung hình hiện tại: ${missingDesc}.`,
    };
  }

  // 2. Current frame has NO missing item, but has historical confirmed items
  if (historicalConfirmedItems.length > 0) {
    const historyNote = isEn
      ? 'Prior technical alert confirmed'
      : 'Có cảnh báo kỹ thuật đã xác nhận';
    if (currentPresentItems.length > 0 && currentUnknownItems.length === 0) {
      const presentLabel = isEn
        ? `${currentPresentItems.map(itemLabel).join(' & ')}: Present`
        : `${currentPresentItems.map(itemLabel).join(' & ')}: Có`;
      const full = `${trackText} · ${presentLabel} · ${historyNote}`;
      return {
        full,
        short: shortText,
        accessibleSummary: isEn
          ? `${trackText}: Observed ${currentPresentItems.map(itemLabel).join(andWord)} in frame; prior technical alert confirmed.`
          : `${trackText}: Ghi nhận có ${currentPresentItems.map(itemLabel).join(andWord)} trong khung hình; có cảnh báo kỹ thuật đã xác nhận trước đó.`,
      };
    }

    if (currentPresentItems.length > 0) {
      const presentName = isEn
        ? `${currentPresentItems.map(itemLabel).join(' & ')}: Present`
        : `${currentPresentItems.map(itemLabel).join(' & ')}: Có`;
      const full = `${trackText} · ${presentName} · ${historyNote}`;
      return {
        full,
        short: shortText,
        accessibleSummary: isEn
          ? `${trackText}: Observed ${presentName}; remaining PPE unclear; prior technical alert confirmed.`
          : `${trackText}: Ghi nhận ${presentName}; trang bị còn lại chưa rõ; có cảnh báo kỹ thuật đã xác nhận trước đó.`,
      };
    }

    const full = `${trackText} · ${isEn ? 'Unclear' : 'Chưa rõ'} · ${historyNote}`;
    return {
      full,
      short: shortText,
      accessibleSummary: isEn
        ? `${trackText}: Current frame technical evidence is unclear; prior technical alert confirmed.`
        : `${trackText}: Bằng chứng kỹ thuật khung hình hiện tại chưa rõ; có cảnh báo kỹ thuật đã xác nhận trước đó.`,
    };
  }

  // 3. Current frame observed all items PRESENT (alertState COMPLIANT alone is NOT proof)
  if (currentPresentItems.length > 0 && currentUnknownItems.length === 0) {
    const full = isEn
      ? `${trackText} · ${currentPresentItems.map(itemLabel).join(' & ')}: Present`
      : `${trackText} · ${currentPresentItems.map(itemLabel).join(' & ')}: Có`;
    return {
      full,
      short: shortText,
      accessibleSummary: isEn
        ? `${trackText}: Current frame technical evidence records ${currentPresentItems.map(itemLabel).join(andWord)} present.`
        : `${trackText}: Bằng chứng kỹ thuật ghi nhận có ${currentPresentItems.map(itemLabel).join(andWord)} trong khung hình này.`,
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
      const full = isEn
        ? `${trackText} · Hard hat: Present · Vest: Unclear`
        : `${trackText} · Mũ: Có · Áo: Chưa rõ`;
      return {
        full,
        short: shortText,
        accessibleSummary: isEn
          ? `${trackText}: Observed Hard hat; Safety vest unclear in this frame.`
          : `${trackText}: Ghi nhận có Mũ bảo hộ; Áo phản quang chưa rõ trong khung hình này.`,
      };
    }
    if (
      currentPresentItems.length === 1 &&
      currentUnknownItems.length === 1 &&
      currentPresentItems[0] === 'SAFETY_VEST' &&
      currentUnknownItems[0] === 'HARD_HAT'
    ) {
      const full = isEn
        ? `${trackText} · Hard hat: Unclear · Vest: Present`
        : `${trackText} · Mũ: Chưa rõ · Áo: Có`;
      return {
        full,
        short: shortText,
        accessibleSummary: isEn
          ? `${trackText}: Observed Safety vest; Hard hat unclear in this frame.`
          : `${trackText}: Ghi nhận có Áo phản quang; Mũ bảo hộ chưa rõ trong khung hình này.`,
      };
    }
    const full = isEn
      ? `${trackText} · ${currentPresentItems.map(itemLabel).join(' & ')}: Present · ${currentUnknownItems.map(itemLabel).join(' & ')}: Unclear`
      : `${trackText} · ${currentPresentItems.map(itemLabel).join(' & ')}: Có · ${currentUnknownItems.map(itemLabel).join(' & ')}: Chưa rõ`;
    return {
      full,
      short: shortText,
      accessibleSummary: isEn
        ? `${trackText}: Observed ${currentPresentItems.map(itemLabel).join(andWord)}; ${currentUnknownItems.map(itemLabel).join(andWord)} unclear in this frame.`
        : `${trackText}: Ghi nhận có ${currentPresentItems.map(itemLabel).join(andWord)}; ${currentUnknownItems.map(itemLabel).join(andWord)} chưa rõ trong khung hình này.`,
    };
  }

  // 5. Default Unknown
  const full = `${trackText} · ${isEn ? 'Unclear' : 'Chưa rõ'}`;
  return {
    full,
    short: shortText,
    accessibleSummary: isEn
      ? `${trackText}: Insufficient technical evidence to determine PPE in this frame.`
      : `${trackText}: Chưa đủ bằng chứng kỹ thuật để xác định trang bị bảo hộ trong khung hình này.`,
  };
}

/**
 * Determines neutral palette colors and stroke widths without bright-green full-safe assertions.
 */
export function resolveDetectionVisualStyle(
  detection: OverlayDetection,
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
      boxStroke: '#EA580C',
      badgeBg: '#1C1917',
      badgeBorder: '#EA580C',
      badgeText: '#F5F5F4',
      lineWidth: 2,
    };
  }

  if (hasPendingCurrent) {
    return {
      boxStroke: '#D97706',
      badgeBg: '#1C1917',
      badgeBorder: '#D97706',
      badgeText: '#FDE68A',
      lineWidth: 2,
    };
  }

  if (hasConfirmedHistory) {
    return {
      boxStroke: '#EA580C',
      badgeBg: '#1C1917',
      badgeBorder: '#EA580C',
      badgeText: '#F5F5F4',
      lineWidth: 2,
    };
  }

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
 */
export function computeOverlayLabels<T extends OverlayDetection = VideoTestDetection>(
  detections: T[],
  mode: 'ppe' | 'zone',
  options: LabelPlacementOptions,
): PlacedDetectionOverlay<T>[] {
  const {
    canvasWidth,
    canvasHeight,
    measureTextWidth,
    badgeHeight = 18,
    paddingX = 6,
    margin = 4,
    locale = 'vi',
  } = options;
  const isEn = locale === 'en';

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

  const orderedDetections = [...validDetections];

  const occupiedRects: Array<{ left: number; top: number; width: number; height: number }> = [];
  const results: PlacedDetectionOverlay<T>[] = [];

  interface CandidateSlot {
    slot: LabelSlot;
    rect: { left: number; top: number; width: number; height: number };
    valid: boolean;
  }

  for (const det of orderedDetections) {
    const box = det.boundingBox!;
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
      const regionSuffix = det.regionId
        ? isEn
          ? ` · Region: ${det.regionId}`
          : ` · Khu vực: ${det.regionId}`
        : '';
      fullText = `${det.label} · #${det.trackId ?? '?'}`;
      shortText = `MF05 #${det.trackId ?? '?'}`;
      accessibleSummary = `Track #${det.trackId ?? '?'}${regionSuffix}: ${det.label}.`;
    } else {
      const ppeLabel = formatPpeCompactLabel(det, locale);
      fullText = ppeLabel.full;
      shortText = ppeLabel.short;
      accessibleSummary = ppeLabel.accessibleSummary;
    }

    const badgeWFull = Math.ceil(measureTextWidth(fullText) + paddingX * 2);
    const badgeWShort = Math.ceil(measureTextWidth(shortText) + paddingX * 2);

    const generateSlots = (badgeW: number): CandidateSlot[] => {
      if (badgeW > canvasWidth - margin * 2 || badgeHeight > canvasHeight - margin * 2) {
        return [];
      }

      const makeSlot = (slot: LabelSlot, left: number, top: number, valid: boolean) => ({
        slot,
        rect: { left, top, width: badgeW, height: badgeHeight },
        valid,
      });

      const maxLeft = canvasWidth - badgeW - margin;
      const topOutY = boxPx.top - badgeHeight - margin;
      const topInY = boxPx.top + margin;
      const botOutY = boxPx.bottom + margin;
      const botInY = boxPx.bottom - badgeHeight - margin;
      const topInValid =
        topInY + badgeHeight <= boxPx.bottom - margin &&
        topInY >= margin &&
        topInY + badgeHeight <= canvasHeight - margin;
      const botOutValid = botOutY + badgeHeight <= canvasHeight - margin;
      const botInValid =
        botInY >= boxPx.top + margin &&
        botInY >= margin &&
        botInY + badgeHeight <= canvasHeight - margin;

      const leftOut = clamp(boxPx.left, margin, maxLeft);
      const leftIn = clamp(boxPx.left + margin, margin, maxLeft);
      const rightOut = clamp(boxPx.right - badgeW, margin, maxLeft);
      const rightIn = clamp(boxPx.right - badgeW - margin, margin, maxLeft);

      const slotTopLeftOut = makeSlot('top-left-outside', leftOut, topOutY, topOutY >= margin);
      const slotTopLeftIn = makeSlot('top-left-inside', leftIn, topInY, topInValid);
      const slotTopRightOut = makeSlot('top-right-outside', rightOut, topOutY, topOutY >= margin);
      const slotTopRightIn = makeSlot('top-right-inside', rightIn, topInY, topInValid);
      const slotBottomLeftOut = makeSlot('bottom-left-outside', leftOut, botOutY, botOutValid);
      const slotBottomLeftIn = makeSlot('bottom-left-inside', leftIn, botInY, botInValid);

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

    const isStrictlyInFrame = (r: { left: number; top: number; width: number; height: number }) =>
      r.left >= 0 &&
      r.top >= 0 &&
      r.left + r.width <= canvasWidth &&
      r.top + r.height <= canvasHeight;

    const pickAvailableBadge = (
      badgeW: number,
      text: string,
      isShort: boolean,
    ): PlacedBadge | null => {
      for (const cand of generateSlots(badgeW)) {
        if (!cand.valid || !isStrictlyInFrame(cand.rect)) continue;
        if (!occupiedRects.some((r) => doRectanglesIntersect(cand.rect, r))) {
          return { text, isShort, rect: cand.rect, slot: cand.slot };
        }
      }
      return null;
    };

    const chosenBadge =
      pickAvailableBadge(badgeWFull, fullText, false) ??
      pickAvailableBadge(badgeWShort, shortText, true);

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
        ? isEn
          ? `${accessibleSummary} [Badge: ${chosenBadge.text}]`
          : `${accessibleSummary} [Nhãn: ${chosenBadge.text}]`
        : isEn
          ? `${accessibleSummary} [Badge hidden due to crowding or narrow frame]`
          : `${accessibleSummary} [Nhãn bị ẩn do mật độ cao hoặc khung hình hẹp]`,
    });
  }

  return results;
}
