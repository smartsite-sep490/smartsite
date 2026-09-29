import { describe, expect, it } from 'vitest';
import { ApiError } from '@smartsite/api-client';
import {
  buildEvidenceQueryKey,
  evidenceErrorMessage,
  formatEvidenceAltText,
  formatEvidenceKind,
} from './safetyAlertEvidenceUtils';

describe('safetyAlertEvidenceUtils', () => {
  describe('buildEvidenceQueryKey', () => {
    it('isolates cached evidence by API endpoint and authenticated user', () => {
      const first = buildEvidenceQueryKey(
        'https://api-a.example',
        'user-a',
        'site-1',
        'alert-1',
        'event-1',
        0,
      );
      const otherUser = buildEvidenceQueryKey(
        'https://api-a.example',
        'user-b',
        'site-1',
        'alert-1',
        'event-1',
        0,
      );
      const otherApi = buildEvidenceQueryKey(
        'https://api-b.example',
        'user-a',
        'site-1',
        'alert-1',
        'event-1',
        0,
      );

      expect(first).not.toEqual(otherUser);
      expect(first).not.toEqual(otherApi);
      expect(first).not.toContain('access-token');
    });
  });

  describe('formatEvidenceKind', () => {
    it('formats known standard evidence kinds correctly', () => {
      expect(formatEvidenceKind('FRAME')).toBe('Frame');
      expect(formatEvidenceKind('CROP')).toBe('Crop');
      expect(formatEvidenceKind('SNAPSHOT')).toBe('Snapshot');
    });

    it('formats case-insensitively and handles fallback snake_case kinds', () => {
      expect(formatEvidenceKind('frame')).toBe('Frame');
      expect(formatEvidenceKind('crop')).toBe('Crop');
      expect(formatEvidenceKind('ZONE_INTRUSION_CLIP')).toBe('Zone Intrusion Clip');
    });
  });

  describe('formatEvidenceAltText', () => {
    it('generates neutral, descriptive alt text without path or URI references', () => {
      const altText = formatEvidenceAltText('FRAME', 'CAM-01', '2026-09-29T08:00:00.000Z');
      expect(altText).toContain('Evidence frame from camera CAM-01');
      expect(altText).not.toContain('local://');
      expect(altText).not.toContain('evidence/');
      expect(altText).not.toContain('..');
      expect(altText).not.toContain('\\');
    });

    it('handles fallback raw timestamp strings if date parsing is invalid', () => {
      const altText = formatEvidenceAltText('CROP', 'CAM-NORTH', 'invalid-date');
      expect(altText).toBe('Evidence crop from camera CAM-NORTH captured at invalid-date');
    });
  });

  describe('evidenceErrorMessage', () => {
    it('translates HTTP 401 to session expiry message', () => {
      const error = new ApiError('http', 'Unauthorized', 401);
      expect(evidenceErrorMessage(error)).toBe('Your session is no longer valid. Sign in again.');
    });

    it('translates HTTP 403 to site access denial message', () => {
      const error = new ApiError('http', 'Forbidden', 403);
      expect(evidenceErrorMessage(error)).toBe(
        'This account cannot view evidence for the selected Site.',
      );
    });

    it('translates HTTP 404 to evidence missing message', () => {
      const error = new ApiError('http', 'Not Found', 404);
      expect(evidenceErrorMessage(error)).toBe(
        'The requested evidence image is no longer available.',
      );
    });

    it('translates HTTP 503 to evidence temporarily unavailable message', () => {
      const error = new ApiError('http', 'Service Unavailable', 503);
      expect(evidenceErrorMessage(error)).toBe('Evidence is temporarily unavailable.');
    });

    it('falls back to default ApiError message for other HTTP statuses', () => {
      const error = new ApiError('http', 'Internal Server Error', 500);
      expect(evidenceErrorMessage(error)).toBe('Internal Server Error');
    });

    it('handles generic Error and unknown errors gracefully', () => {
      expect(evidenceErrorMessage(new Error('Network timeout'))).toBe('Network timeout');
      expect(evidenceErrorMessage('unexpected string')).toBe('Failed to load evidence image.');
    });
  });
});
