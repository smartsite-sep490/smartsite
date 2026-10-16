import { describe, expect, it } from 'vitest';
import {
  areExactRfc3339Equal,
  areUuidsEqual,
  normalizeRfc3339Utc,
  validateAssessmentBinding,
  type AssessmentTargetContext,
} from './mf06AssessmentDetailBinding';
import type { Mf06AssessmentResponse } from '@smartsite/api-client';

describe('mf06AssessmentDetailBinding', () => {
  describe('normalizeRfc3339Utc & areExactRfc3339Equal', () => {
    it('normalizes timestamps with and without fractional seconds to 9 digits', () => {
      expect(normalizeRfc3339Utc('2026-10-12T10:00:00Z')).toBe('2026-10-12T10:00:00.000000000Z');
      expect(normalizeRfc3339Utc('2026-10-12T10:00:00.000Z')).toBe(
        '2026-10-12T10:00:00.000000000Z',
      );
      expect(normalizeRfc3339Utc('2026-10-12T10:00:00.123456Z')).toBe(
        '2026-10-12T10:00:00.123456000Z',
      );
    });

    it('matches timestamps with equivalent padded fractions', () => {
      expect(areExactRfc3339Equal('2026-10-12T10:00:00Z', '2026-10-12T10:00:00.000Z')).toBe(true);
      expect(areExactRfc3339Equal('2026-10-12T10:00:00.12Z', '2026-10-12T10:00:00.120000Z')).toBe(
        true,
      );
    });

    it('rejects .123456 vs .123457 despite equal JS Date millisecond values', () => {
      const t1 = '2026-10-12T10:00:00.123456Z';
      const t2 = '2026-10-12T10:00:00.123457Z';

      // JavaScript Date object truncates both to 123ms:
      expect(new Date(t1).getTime()).toBe(new Date(t2).getTime());

      // Our exact RFC3339 comparator MUST reject them:
      expect(areExactRfc3339Equal(t1, t2)).toBe(false);
    });

    it('rejects fractional seconds longer than 9 digits rather than slicing', () => {
      // 10 digits in fraction
      const t10 = '2026-10-12T10:00:00.1234567891Z';
      expect(normalizeRfc3339Utc(t10)).toBeNull();
      expect(areExactRfc3339Equal(t10, t10)).toBe(false);
    });

    it('rejects invalid inputs without allowing equal shortcut bypass', () => {
      expect(areExactRfc3339Equal('invalid-timestamp', 'invalid-timestamp')).toBe(false);
      expect(areExactRfc3339Equal('', '')).toBe(false);
      expect(normalizeRfc3339Utc('2026-99-99T99:99:99Z')).toBeNull();
      expect(areExactRfc3339Equal('2026-99-99T99:99:99Z', '2026-99-99T99:99:99Z')).toBe(false);
    });
  });

  describe('areUuidsEqual', () => {
    it('matches UUIDs case-insensitively with trimming', () => {
      const u1 = '11111111-2222-4333-8444-555555555555';
      const u2 = ' 11111111-2222-4333-8444-555555555555 ';
      const u3 = '11111111-2222-4333-8444-555555555555'.toUpperCase();

      expect(areUuidsEqual(u1, u2)).toBe(true);
      expect(areUuidsEqual(u1, u3)).toBe(true);
      expect(areUuidsEqual(u1, 'aaaaaaaa-2222-4333-8444-555555555555')).toBe(false);
    });
  });

  describe('validateAssessmentBinding', () => {
    const validExpected: AssessmentTargetContext = {
      assessmentId: '11111111-1111-4111-8111-111111111111',
      siteId: '22222222-2222-4222-8222-222222222222',
      requestId: '33333333-3333-4333-8333-333333333333',
      eventId: '44444444-4444-4444-8444-444444444444',
      cameraId: '55555555-5555-4555-8555-555555555555',
      zoneId: '66666666-6666-4666-8666-666666666666',
      purpose: 'INITIAL_OBSERVATION_ASSESSMENT',
      capturedAt: '2026-10-12T10:00:00.123456Z',
    };

    const validLoaded: Mf06AssessmentResponse = {
      assessmentId: '11111111-1111-4111-8111-111111111111'.toUpperCase(),
      siteId: '22222222-2222-4222-8222-222222222222',
      requestId: '33333333-3333-4333-8333-333333333333',
      eventId: '44444444-4444-4444-8444-444444444444',
      cameraId: '55555555-5555-4555-8555-555555555555',
      zoneId: '66666666-6666-4666-8666-666666666666',
      purpose: 'INITIAL_OBSERVATION_ASSESSMENT',
      capturedAt: '2026-10-12T10:00:00.123456000Z',
      assessedAt: '2026-10-12T10:00:02.000Z',
      outcome: 'UNAVAILABLE',
      reasonCode: 'IDENTITY_UNAVAILABLE',
      evaluatorVersion: 'v1.0.0',
      provenance: 'UNAVAILABLE',
    };

    it('returns null when all required target fields match validLoaded', () => {
      expect(validateAssessmentBinding(validLoaded, validExpected)).toBeNull();
    });

    it('rejects on UUID mismatch (e.g. requestId)', () => {
      const mismatch = { ...validLoaded, requestId: '99999999-9999-4999-8999-999999999999' };
      expect(validateAssessmentBinding(mismatch, validExpected)).toBe('Request ID mismatch');
    });

    it('rejects on capturedAt microsecond precision discrepancy (.123456 vs .123457)', () => {
      const mismatch = { ...validLoaded, capturedAt: '2026-10-12T10:00:00.123457Z' };
      expect(validateAssessmentBinding(mismatch, validExpected)).toBe(
        'CapturedAt precision mismatch',
      );
    });

    it('validates history-origin immutable fields when provided in expected context', () => {
      const historyExpected: AssessmentTargetContext = {
        ...validExpected,
        outcome: 'DENIED',
        reasonCode: 'POLICY_PROHIBITED',
        provenance: 'UNAVAILABLE',
        evaluatorVersion: 'v1.0.0',
        assessedAt: '2026-10-12T10:00:02.000Z',
      };

      // loaded has outcome: UNAVAILABLE instead of DENIED
      expect(validateAssessmentBinding(validLoaded, historyExpected)).toBe('Outcome mismatch');

      const matchingHistoryLoaded: Mf06AssessmentResponse = {
        ...validLoaded,
        outcome: 'DENIED',
        reasonCode: 'POLICY_PROHIBITED',
      };
      expect(validateAssessmentBinding(matchingHistoryLoaded, historyExpected)).toBeNull();
    });
  });
});
