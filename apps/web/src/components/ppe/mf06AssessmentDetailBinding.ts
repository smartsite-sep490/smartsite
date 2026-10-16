import type { Mf06AssessmentResponse } from '@smartsite/api-client';

export interface AssessmentTargetContext {
  assessmentId: string;
  siteId: string;
  requestId: string;
  eventId: string;
  cameraId: string;
  zoneId: string;
  purpose: 'INITIAL_OBSERVATION_ASSESSMENT' | 'RETROSPECTIVE_REVIEW';
  capturedAt: string;
  // History origin immutable context
  outcome?: 'ALLOWED' | 'DENIED' | 'UNAVAILABLE';
  reasonCode?: string;
  evaluatorVersion?: string;
  provenance?: 'UNAVAILABLE' | 'TRUSTED_SERVICE';
  assessedAt?: string;
}

/**
 * Normalizes RFC3339 UTC timestamps by padding the fractional second to 9 digits (nanoseconds)
 * Fraction comparison never uses JS Date, so microseconds are not truncated.
 *
 * Example:
 * - "2026-10-12T10:00:00Z" -> "2026-10-12T10:00:00.000000000Z"
 * - "2026-10-12T10:00:00.123456Z" -> "2026-10-12T10:00:00.123456000Z"
 * - "2026-10-12T10:00:00.123457Z" -> "2026-10-12T10:00:00.123457000Z"
 */
export function normalizeRfc3339Utc(isoString: string): string | null {
  if (typeof isoString !== 'string') return null;
  const trimmed = isoString.trim();
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$/i.exec(trimmed);
  if (!match) return null;

  const base = match[1];
  const rawFraction = match[2];

  // Validate that the base timestamp represents a valid calendar date/time
  const dateObj = new Date(`${base}Z`);
  if (Number.isNaN(dateObj.getTime()) || dateObj.toISOString().slice(0, 19) !== base) {
    return null;
  }

  // MUST reject fractions longer than 9 rather than slicing
  if (rawFraction !== undefined) {
    if (rawFraction.length === 0 || rawFraction.length > 9) {
      return null;
    }
  }

  const fraction = (rawFraction ?? '').padEnd(9, '0');
  return `${base}.${fraction}Z`;
}

export function areExactRfc3339Equal(a: string, b: string): boolean {
  // Reject invalid inputs immediately without shortcut equality bypass
  const normA = normalizeRfc3339Utc(a);
  const normB = normalizeRfc3339Utc(b);
  if (!normA || !normB) {
    return false;
  }
  return normA === normB;
}

export function areUuidsEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Validates that loaded assessment matches the expected target context.
 * Returns null if valid, or an error reason string if invalid.
 */
export function validateAssessmentBinding(
  loaded: Mf06AssessmentResponse,
  expected: AssessmentTargetContext,
): string | null {
  if (!areUuidsEqual(loaded.assessmentId, expected.assessmentId)) {
    return 'Assessment ID mismatch';
  }
  if (!areUuidsEqual(loaded.siteId, expected.siteId)) {
    return 'Site ID mismatch';
  }
  if (!areUuidsEqual(loaded.requestId, expected.requestId)) {
    return 'Request ID mismatch';
  }
  if (!areUuidsEqual(loaded.eventId, expected.eventId)) {
    return 'Event ID mismatch';
  }
  if (!areUuidsEqual(loaded.cameraId, expected.cameraId)) {
    return 'Camera ID mismatch';
  }
  if (!areUuidsEqual(loaded.zoneId, expected.zoneId)) {
    return 'Zone ID mismatch';
  }
  if (loaded.purpose !== expected.purpose) {
    return 'Purpose mismatch';
  }
  if (!areExactRfc3339Equal(loaded.capturedAt, expected.capturedAt)) {
    return 'CapturedAt precision mismatch';
  }

  // History-origin immutable checks
  if (expected.outcome && loaded.outcome !== expected.outcome) {
    return 'Outcome mismatch';
  }
  if (expected.reasonCode && loaded.reasonCode !== expected.reasonCode) {
    return 'Reason code mismatch';
  }
  if (expected.provenance && loaded.provenance !== expected.provenance) {
    return 'Provenance mismatch';
  }
  if (expected.evaluatorVersion && loaded.evaluatorVersion !== expected.evaluatorVersion) {
    return 'Evaluator version mismatch';
  }
  if (expected.assessedAt && !areExactRfc3339Equal(loaded.assessedAt, expected.assessedAt)) {
    return 'AssessedAt precision mismatch';
  }

  return null;
}
