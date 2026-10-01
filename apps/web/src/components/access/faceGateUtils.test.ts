import { describe, expect, it } from 'vitest';
import {
  createSafePreviewUrl,
  getSafeReasonMessage,
  resolveGateUiState,
  revokeSafePreviewUrl,
  retainGateWorker,
} from './faceGateUtils';

describe('faceGateUtils', () => {
  it('retains the last identified worker until another is identified or explicitly cleared', () => {
    const oldWorker = {
      id: 'worker-a',
      userId: 'account-a',
      username: 'a',
      externalId: 'A',
      displayName: 'Worker A',
      contractorName: 'Contractor',
      assignmentStatus: 'ACTIVE',
    };
    const newWorker = { ...oldWorker, id: 'worker-b', displayName: 'Worker B' };
    expect(retainGateWorker(oldWorker, undefined)).toBe(oldWorker);
    expect(retainGateWorker(oldWorker, newWorker)).toBe(newWorker);
    expect(retainGateWorker(oldWorker, null)).toBeNull();
    expect(retainGateWorker(null, undefined)).toBeNull();
  });
  describe('resolveGateUiState', () => {
    it('returns retry state when network error is indicated and prevents cached success', () => {
      const state = resolveGateUiState({
        technicalOutcome: 'MATCHED',
        authorization: 'ALLOWED',
        isNetworkError: true,
      });

      expect(state.type).toBe('RETRY');
      expect(state.isRetry).toBe(true);
      expect(state.canRecordInOut).toBe(false);
      expect(state.canUseQrFallback).toBe(false);
    });

    it('returns green ALLOWED state when MATCHED and ALLOWED, enabling IN/OUT recording', () => {
      const state = resolveGateUiState({
        technicalOutcome: 'MATCHED',
        authorization: 'ALLOWED',
      });

      expect(state.type).toBe('ALLOWED');
      expect(state.canRecordInOut).toBe(true);
      expect(state.canUseQrFallback).toBe(false);
      expect(state.badgeClass).toContain('bg-emerald-100');
    });

    it('returns red DENIED state when MATCHED and DENIED, with no QR fallback', () => {
      const state = resolveGateUiState({
        technicalOutcome: 'MATCHED',
        authorization: 'DENIED',
      });

      expect(state.type).toBe('DENIED');
      expect(state.canRecordInOut).toBe(false);
      expect(state.canUseQrFallback).toBe(false);
      expect(state.badgeClass).toContain('bg-red-100');
    });

    it('returns MANUAL_REVIEW state when MATCHED and MANUAL_REVIEW', () => {
      const state = resolveGateUiState({
        technicalOutcome: 'MATCHED',
        authorization: 'MANUAL_REVIEW',
      });

      expect(state.type).toBe('MANUAL_REVIEW');
      expect(state.canRecordInOut).toBe(false);
      expect(state.canUseQrFallback).toBe(false);
    });

    it.each([
      ['UNKNOWN' as const],
      ['LOW_CONFIDENCE' as const],
      ['QUALITY_FAILED' as const],
      ['AI_UNAVAILABLE' as const],
    ])('exposes QR fallback for inconclusive outcome %s', (technicalOutcome) => {
      const state = resolveGateUiState({
        technicalOutcome,
        authorization: null,
      });

      expect(state.type).toBe('FALLBACK_REQUIRED');
      expect(state.canRecordInOut).toBe(false);
      expect(state.canUseQrFallback).toBe(true);
      expect(state.badgeClass).toContain('bg-amber-100');
    });

    it('never infers ALLOWED when authorization is missing even if face MATCHED', () => {
      const state = resolveGateUiState({
        technicalOutcome: 'MATCHED',
        authorization: null,
      });

      expect(state.canRecordInOut).toBe(false);
      expect(state.type).not.toBe('ALLOWED');
    });
  });

  describe('getSafeReasonMessage', () => {
    it('returns safe message for known reason codes without raw scores', () => {
      const msg = getSafeReasonMessage('FACE_PROFILE_REVOKED');
      expect(msg).toContain('revoked');
      expect(msg).not.toMatch(/[0-9]\.[0-9]{2,}/); // No raw floating point scores
    });

    it('returns safe message for expired assignment', () => {
      const msg = getSafeReasonMessage('ASSIGNMENT_EXPIRED');
      expect(msg).toContain('expired');
    });

    it('handles null / undefined safely', () => {
      const msg = getSafeReasonMessage(null);
      expect(msg).toBe('Verification result recorded.');
    });
  });

  describe('preview url lifecycle', () => {
    it('creates object URL and handles revocation without throwing', () => {
      let created = '';
      if (typeof URL.createObjectURL === 'function') {
        const blob = new Blob(['sample'], { type: 'image/jpeg' });
        created = createSafePreviewUrl(blob);
        expect(typeof created).toBe('string');
      }
      expect(() => revokeSafePreviewUrl(created)).not.toThrow();
      expect(() => revokeSafePreviewUrl(null)).not.toThrow();
    });
  });
});
