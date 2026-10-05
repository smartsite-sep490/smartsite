import { describe, expect, it } from 'vitest';
import type { VideoTestDetection } from './videoTestFixture';
import {
  computeOverlayLabels,
  doRectanglesIntersect,
  formatPpeCompactLabel,
  resolveDetectionVisualStyle,
} from './overlayLayoutUtils';

function createMockDetection(overrides?: Partial<VideoTestDetection>): VideoTestDetection {
  return {
    trackId: 1,
    confidence: 0.92,
    active: false,
    alertState: 'COMPLIANT',
    label: 'MF04 PPE COMPLIANT',
    timecode: 'LIVE',
    eventId: 'EVENT-1',
    confirmedMissingItems: [],
    ppeStatus: {
      HARD_HAT: 'PRESENT',
      SAFETY_VEST: 'PRESENT',
    },
    boundingBox: {
      x1: 0.2,
      y1: 0.2,
      x2: 0.4,
      y2: 0.6,
    },
    ...overrides,
  };
}

describe('overlayLayoutUtils - Label formatting and neutral semantics', () => {
  it('formats compact neutral label without emojis or false full-safe claims', () => {
    // Both present in frame -> "Mũ & Áo: Có"
    const compliant = createMockDetection({
      alertState: 'COMPLIANT',
      ppeStatus: { HARD_HAT: 'PRESENT', SAFETY_VEST: 'PRESENT' },
    });
    const labelCompliant = formatPpeCompactLabel(compliant);
    expect(labelCompliant.full).toContain('Track #1');
    expect(labelCompliant.full).toContain('Mũ & Áo: Có');
    expect(labelCompliant.full).not.toMatch(/safe|an toàn|complian/i);
    expect(labelCompliant.full).not.toMatch(/[\u{1F300}-\u{1F9FF}]/u); // No emojis
    expect(labelCompliant.short).toBe('#1');
  });

  it('proves alertState COMPLIANT alone is NOT proof both PPE are currently PRESENT', () => {
    // alertState says COMPLIANT, but frame evidence is UNKNOWN
    const deceptiveCompliant = createMockDetection({
      alertState: 'COMPLIANT',
      ppeStatus: { HARD_HAT: 'UNKNOWN', SAFETY_VEST: 'UNKNOWN' },
    });
    const label = formatPpeCompactLabel(deceptiveCompliant);
    expect(label.full).toBe('Track #1 · Chưa rõ');
    expect(label.full).not.toContain('Mũ & Áo: Có');
  });

  it('separates historical confirmed missing items from current UNKNOWN status (never fresh Thiếu)', () => {
    // Confirmed history exists from earlier incident, but current frame is UNKNOWN
    const historicalIncident = createMockDetection({
      trackId: 9,
      confirmedMissingItems: ['HARD_HAT'],
      ppeStatus: { HARD_HAT: 'UNKNOWN', SAFETY_VEST: 'UNKNOWN' },
    });
    const label = formatPpeCompactLabel(historicalIncident);
    // MUST NOT label as fresh "Thiếu"
    expect(label.full).not.toMatch(/Thiếu Mũ/i);
    expect(label.full).toContain('Chưa rõ');
    expect(label.full).toContain('Có cảnh báo kỹ thuật đã xác nhận');
    expect(label.accessibleSummary).not.toMatch(/vi phạm/i);
    expect(label.accessibleSummary).toMatch(/cảnh báo kỹ thuật/i);
  });

  it('regression: active=true is temporal metadata, NOT proof of current missing evidence', () => {
    // active=true but current ppeStatus is UNKNOWN
    const activeUnknown = createMockDetection({
      active: true,
      ppeStatus: { HARD_HAT: 'UNKNOWN', SAFETY_VEST: 'UNKNOWN' },
      confirmedMissingItems: [],
    });
    const labelUnknown = formatPpeCompactLabel(activeUnknown);
    expect(labelUnknown.full).toBe('Track #1 · Chưa rõ');
    expect(labelUnknown.full).not.toContain('Thiếu');

    // active=true and current ppeStatus is both PRESENT
    const activePresent = createMockDetection({
      active: true,
      ppeStatus: { HARD_HAT: 'PRESENT', SAFETY_VEST: 'PRESENT' },
      confirmedMissingItems: [],
    });
    const labelPresent = formatPpeCompactLabel(activePresent);
    expect(labelPresent.full).toBe('Track #1 · Mũ & Áo: Có');
  });

  it('regression: mixed hat historical + vest pending does NOT claim Thiếu Mũ & Áo', () => {
    // Hat is historical confirmed, but current frame is UNKNOWN; Vest is current MISSING but pending
    const mixedDet = createMockDetection({
      trackId: 15,
      confirmedMissingItems: ['HARD_HAT'],
      ppeStatus: { HARD_HAT: 'UNKNOWN', SAFETY_VEST: 'MISSING' },
    });
    const label = formatPpeCompactLabel(mixedDet);

    // MUST NOT claim "Thiếu Mũ & Áo"
    expect(label.full).not.toMatch(/Thiếu Mũ & Áo/i);
    // Vest is pending
    expect(label.full).toContain('Chờ xác nhận (Áo)');
    // Hat is historical note
    expect(label.full).toContain('Cảnh báo cũ: Mũ');
    // Uses technical language, avoids "vi phạm"
    expect(label.accessibleSummary).not.toMatch(/vi phạm/i);
    expect(label.accessibleSummary).toMatch(/bằng chứng kỹ thuật/i);
  });

  it('regression: alertState CONFIRMED does NOT promote a different item pending evidence', () => {
    // AlertState is CONFIRMED (from hat historically), but current vest is MISSING without confirmed status
    const unpromotedDet = createMockDetection({
      trackId: 22,
      alertState: 'CONFIRMED',
      confirmedMissingItems: ['HARD_HAT'],
      ppeStatus: { HARD_HAT: 'PRESENT', SAFETY_VEST: 'MISSING' },
    });
    const label = formatPpeCompactLabel(unpromotedDet);

    // Vest must remain pending, NOT promoted to confirmed missing
    expect(label.full).toContain('Chờ xác nhận (Áo)');
    expect(label.full).toContain('Cảnh báo cũ: Mũ');
    expect(label.full).not.toMatch(/Thiếu Áo/i);
  });

  it('formats confirmed missing items accurately only when current evidence intersects confirmedMissingItems', () => {
    const freshMissing = createMockDetection({
      trackId: 12,
      alertState: 'CONFIRMED',
      confirmedMissingItems: ['HARD_HAT'],
      ppeStatus: { HARD_HAT: 'MISSING', SAFETY_VEST: 'PRESENT' },
    });
    const label = formatPpeCompactLabel(freshMissing);
    expect(label.full).toBe('Track #12 · Thiếu Mũ');
    expect(label.short).toBe('#12');
  });

  it('differentiates UNKNOWN from missing or safe', () => {
    const unknownDet = createMockDetection({
      trackId: 3,
      alertState: 'UNKNOWN',
      ppeStatus: { HARD_HAT: 'UNKNOWN', SAFETY_VEST: 'UNKNOWN' },
    });
    const label = formatPpeCompactLabel(unknownDet);
    expect(label.full).toBe('Track #3 · Chưa rõ');
    expect(label.short).toBe('#3');
  });

  it('differentiates PENDING_CONFIRMATION from confirmed missing', () => {
    const pendingDet = createMockDetection({
      trackId: 4,
      alertState: 'PENDING_CONFIRMATION',
      confirmedMissingItems: [],
      ppeStatus: { HARD_HAT: 'MISSING', SAFETY_VEST: 'PRESENT' },
    });
    const label = formatPpeCompactLabel(pendingDet);
    expect(label.full).toBe('Track #4 · Chờ xác nhận (Mũ)');
  });

  it('uses neutral stone palette and does not claim worker identity', () => {
    const compliant = createMockDetection();
    const styleCompliant = resolveDetectionVisualStyle(compliant, 'ppe');
    // Neutral stone border, dark neutral badge, not bright green
    expect(styleCompliant.boxStroke).toBe('#78716C');
    expect(styleCompliant.badgeBg).toBe('#1C1917');

    const confirmedMissing = createMockDetection({
      alertState: 'CONFIRMED',
      confirmedMissingItems: ['HARD_HAT'],
      ppeStatus: { HARD_HAT: 'MISSING', SAFETY_VEST: 'PRESENT' },
    });
    const styleMissing = resolveDetectionVisualStyle(confirmedMissing, 'ppe');
    expect(styleMissing.boxStroke).toBe('#EA580C');
  });

  it('formats compact neutral label with expanded PPE items when supplied', () => {
    // When GLOVES is supplied and PRESENT along with Mũ and Áo
    const withGloves = createMockDetection({
      ppeStatus: {
        HARD_HAT: 'PRESENT',
        SAFETY_VEST: 'PRESENT',
        GLOVES: 'PRESENT',
      },
    });
    const label = formatPpeCompactLabel(withGloves);
    expect(label.full).toBe('Track #1 · Mũ & Áo & Găng: Có');

    // When BOOTS is supplied and MISSING (confirmed)
    const bootsMissing = createMockDetection({
      trackId: 5,
      confirmedMissingItems: ['BOOTS'],
      ppeStatus: {
        HARD_HAT: 'PRESENT',
        SAFETY_VEST: 'PRESENT',
        BOOTS: 'MISSING',
      },
    });
    const bootsLabel = formatPpeCompactLabel(bootsMissing);
    expect(bootsLabel.full).toBe('Track #5 · Thiếu Ủng');

    // When GLOVES is MISSING (pending) and BOOTS is MISSING (confirmed)
    const mixedExpanded = createMockDetection({
      trackId: 6,
      confirmedMissingItems: ['BOOTS'],
      ppeStatus: {
        HARD_HAT: 'PRESENT',
        SAFETY_VEST: 'PRESENT',
        GLOVES: 'MISSING',
        BOOTS: 'MISSING',
      },
    });
    const mixedLabel = formatPpeCompactLabel(mixedExpanded);
    expect(mixedLabel.full).toBe('Track #6 · Thiếu Ủng · Chờ Găng');

    // When an optional item is absent, it must NOT appear in the label
    const absentOptional = createMockDetection({
      ppeStatus: {
        HARD_HAT: 'PRESENT',
        SAFETY_VEST: 'PRESENT',
      },
    });
    const absentLabel = formatPpeCompactLabel(absentOptional);
    expect(absentLabel.full).toBe('Track #1 · Mũ & Áo: Có');
    expect(absentLabel.full).not.toMatch(/Găng|Ủng|Kính/);
  });

  it('applies neutral style to UNKNOWN expanded PPE without latching warning colors', () => {
    const unknownExpanded = createMockDetection({
      trackId: 7,
      ppeStatus: {
        HARD_HAT: 'PRESENT',
        SAFETY_VEST: 'PRESENT',
        GLOVES: 'UNKNOWN',
        BOOTS: 'UNKNOWN',
      },
    });
    const style = resolveDetectionVisualStyle(unknownExpanded, 'ppe');
    expect(style.boxStroke).toBe('#78716C');
    expect(style.badgeBg).toBe('#1C1917');
  });

  it('applies amber warning to pending expanded PPE missing items', () => {
    const pendingExpanded = createMockDetection({
      trackId: 8,
      confirmedMissingItems: [],
      ppeStatus: {
        HARD_HAT: 'PRESENT',
        SAFETY_VEST: 'PRESENT',
        GLOVES: 'MISSING',
      },
    });
    const style = resolveDetectionVisualStyle(pendingExpanded, 'ppe');
    expect(style.boxStroke).toBe('#D97706'); // Muted Amber
  });

  it('separates historical confirmed missing extended items from current UNKNOWN status (never fresh Thiếu)', () => {
    // Gloves has confirmed missing history, but current frame evidence is UNKNOWN
    const historicalGloves = createMockDetection({
      trackId: 19,
      confirmedMissingItems: ['GLOVES'],
      ppeStatus: {
        HARD_HAT: 'PRESENT',
        SAFETY_VEST: 'PRESENT',
        GLOVES: 'UNKNOWN',
      },
    });
    const label = formatPpeCompactLabel(historicalGloves);
    // MUST NOT label as fresh "Thiếu Găng"
    expect(label.full).not.toMatch(/Thiếu Găng/i);
    expect(label.full).toContain('Mũ & Áo: Có');
    expect(label.full).toContain('Có cảnh báo kỹ thuật đã xác nhận');
    expect(label.accessibleSummary).not.toMatch(/vi phạm/i);
    expect(label.accessibleSummary).toMatch(/cảnh báo kỹ thuật/i);
  });
});

describe('overlayLayoutUtils - Deterministic Placement & Collision Avoidance', () => {
  const dummyMeasure = (text: string): number => text.length * 8;

  it('preserves exact original floating-point box coordinates without rounding distortion', () => {
    const det = createMockDetection({
      boundingBox: { x1: 0.12345, y1: 0.23456, x2: 0.34567, y2: 0.45678 },
    });
    const placed = computeOverlayLabels([det], 'ppe', {
      canvasWidth: 1000,
      canvasHeight: 800,
      measureTextWidth: dummyMeasure,
    });

    expect(placed.length).toBe(1);
    const box = placed[0]!.boxPx;
    // Exactly matches normalized float * dimension
    expect(box.left).toBeCloseTo(123.45, 5);
    expect(box.top).toBeCloseTo(187.648, 5);
    expect(box.right).toBeCloseTo(345.67, 5);
    expect(box.bottom).toBeCloseTo(365.424, 5);
  });

  it('places label at top-left outside when within frame boundaries', () => {
    const det = createMockDetection({
      boundingBox: { x1: 0.3, y1: 0.3, x2: 0.5, y2: 0.7 },
    });
    const placed = computeOverlayLabels([det], 'ppe', {
      canvasWidth: 1000,
      canvasHeight: 1000,
      measureTextWidth: dummyMeasure,
    });

    expect(placed.length).toBe(1);
    const item = placed[0]!;
    expect(item.badge).not.toBeNull();
    expect(item.badge!.slot).toBe('top-left-outside');
    expect(item.badge!.rect.top).toBeLessThan(300); // Placed above y=300
    expect(item.badge!.rect.left).toBe(300);
    expect(item.badge!.isShort).toBe(false);
  });

  it('flips label inside the box when touching top boundary (y1 < 24px)', () => {
    const det = createMockDetection({
      boundingBox: { x1: 0.2, y1: 0.01, x2: 0.4, y2: 0.5 }, // top is at y = 10px
    });
    const placed = computeOverlayLabels([det], 'ppe', {
      canvasWidth: 1000,
      canvasHeight: 1000,
      measureTextWidth: dummyMeasure,
    });

    expect(placed.length).toBe(1);
    const item = placed[0]!;
    expect(item.badge).not.toBeNull();
    expect(item.badge!.slot).toBe('top-left-inside');
    expect(item.badge!.rect.top).toBeGreaterThanOrEqual(10); // Inside box, not clipped above 0
    expect(item.badge!.rect.left).toBeGreaterThanOrEqual(200);
  });

  it('staggers adjacent persons and enforces strict rectangle nonintersection across all placed badges', () => {
    const det1 = createMockDetection({
      trackId: 1,
      boundingBox: { x1: 0.2, y1: 0.2, x2: 0.35, y2: 0.7 },
    });
    const det2 = createMockDetection({
      trackId: 2,
      boundingBox: { x1: 0.25, y1: 0.21, x2: 0.4, y2: 0.65 },
    });

    const placed = computeOverlayLabels([det1, det2], 'ppe', {
      canvasWidth: 1000,
      canvasHeight: 1000,
      measureTextWidth: dummyMeasure,
    });

    expect(placed.length).toBe(2);
    const badges = placed.map((p) => p.badge).filter((b): b is NonNullable<typeof b> => b !== null);
    expect(badges.length).toBe(2);

    // Strict geometric nonintersection verification
    const intersects = doRectanglesIntersect(badges[0]!.rect, badges[1]!.rect);
    expect(intersects).toBe(false);
  });

  it('hides badge (badge: null) when dense crowd has no collision-free slot, keeping box intact', () => {
    // 6 persons clustered tightly in the exact same spot
    const dets = Array.from({ length: 6 }, (_, i) =>
      createMockDetection({
        trackId: i + 1,
        boundingBox: { x1: 0.4 + i * 0.005, y1: 0.4 + i * 0.005, x2: 0.46, y2: 0.48 },
      }),
    );

    const placed = computeOverlayLabels(dets, 'ppe', {
      canvasWidth: 600,
      canvasHeight: 600,
      measureTextWidth: dummyMeasure,
    });

    expect(placed.length).toBe(6);

    // Every detection MUST retain its exact PERSON bounding box
    for (const item of placed) {
      expect(item.boxPx.width).toBeGreaterThan(0);
      expect(item.boxPx.height).toBeGreaterThan(0);
    }

    // Badges that were placed must NEVER intersect
    const placedBadges = placed
      .map((p) => p.badge)
      .filter((b): b is NonNullable<typeof b> => b !== null);

    for (let i = 0; i < placedBadges.length; i++) {
      for (let j = i + 1; j < placedBadges.length; j++) {
        expect(doRectanglesIntersect(placedBadges[i]!.rect, placedBadges[j]!.rect)).toBe(false);
      }
    }

    // Due to extreme clustering, at least one badge must have been safely omitted (badge: null)
    // rather than knowingly overlapping prior labels
    const hasOmittedBadge = placed.some((p) => p.badge === null);
    expect(hasOmittedBadge).toBe(true);
  });

  it('hides badge when narrow frame cannot contain the badge width, keeping box intact', () => {
    const det = createMockDetection({
      trackId: 100,
      boundingBox: { x1: 0.1, y1: 0.2, x2: 0.9, y2: 0.8 },
    });
    // Canvas is only 40px wide, but shortest badge is "#100" (4 chars * 8px + 12px padding = 44px > 40px - 8px margin)
    const placed = computeOverlayLabels([det], 'ppe', {
      canvasWidth: 40,
      canvasHeight: 200,
      measureTextWidth: dummyMeasure,
    });

    expect(placed.length).toBe(1);
    // Box exists and is valid
    expect(placed[0]!.boxPx.width).toBeCloseTo(32);
    // Badge is omitted safely rather than overflowing bounds
    expect(placed[0]!.badge).toBeNull();
  });

  it('preserves zone mode labels and behavior without asserting unconditional in-zone membership', () => {
    const activeZoneDet = createMockDetection({
      trackId: 5,
      active: true,
      label: 'MF05 IN RESTRICTED ZONE',
    });
    const placedActive = computeOverlayLabels([activeZoneDet], 'zone', {
      canvasWidth: 1000,
      canvasHeight: 1000,
      measureTextWidth: dummyMeasure,
    });

    expect(placedActive.length).toBe(1);
    expect(placedActive[0]!.badge).not.toBeNull();
    expect(placedActive[0]!.badge!.text).toBe('MF05 IN RESTRICTED ZONE · #5');
    expect(placedActive[0]!.accessibleSummary).toBe(
      'Track #5: MF05 IN RESTRICTED ZONE. [Nhãn: MF05 IN RESTRICTED ZONE · #5]',
    );
  });

  it('regression: inactive zone track remains monitoring/outside with no unconditional in-zone phrase', () => {
    const inactiveZoneDet = createMockDetection({
      trackId: 8,
      active: false,
      label: 'MF05 ZONE MONITORING',
    });
    const placedInactive = computeOverlayLabels([inactiveZoneDet], 'zone', {
      canvasWidth: 1000,
      canvasHeight: 1000,
      measureTextWidth: dummyMeasure,
    });

    expect(placedInactive.length).toBe(1);
    expect(placedInactive[0]!.badge).not.toBeNull();
    expect(placedInactive[0]!.badge!.text).toBe('MF05 ZONE MONITORING · #8');
    // Must preserve provided label only; MUST NOT append unconditional "trong khu vực hạn chế"
    expect(placedInactive[0]!.accessibleSummary).not.toMatch(/trong khu vực hạn chế/i);
    expect(placedInactive[0]!.accessibleSummary).toBe(
      'Track #8: MF05 ZONE MONITORING. [Nhãn: MF05 ZONE MONITORING · #8]',
    );
  });
});
