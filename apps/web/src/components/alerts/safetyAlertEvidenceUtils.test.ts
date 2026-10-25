import { afterEach, describe, expect, it } from 'vitest';
import { ApiError } from '@smartsite/api-client';
import i18n from '../../i18n';
import {
  buildEvidenceQueryKey,
  evidenceErrorMessage,
  formatCandidateSubtype,
  formatEvidenceAltText,
  formatEvidenceKind,
} from './safetyAlertEvidenceUtils';

describe('safetyAlertEvidenceUtils', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

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

    it('translates HTTP 429 to rate-limit message without exposing raw backend text', () => {
      const error = new ApiError('http', 'rate-limit-token-canary https://internal.local', 429);
      expect(evidenceErrorMessage(error)).toBe('Too many requests. Wait before trying again.');
    });

    it('translates HTTP 503 to evidence temporarily unavailable message', () => {
      const error = new ApiError('http', 'Service Unavailable', 503);
      expect(evidenceErrorMessage(error)).toBe('Evidence is temporarily unavailable.');
    });

    it('does not display upstream exception text for other HTTP statuses', () => {
      const error = new ApiError('http', 'private-service-canary', 500);
      expect(evidenceErrorMessage(error)).toBe(
        'The service is temporarily unavailable. Please try again.',
      );
    });

    it('handles generic Error and unknown errors gracefully', () => {
      expect(evidenceErrorMessage(new Error('private-service-canary'))).toBe(
        'Something went wrong. Please try again.',
      );
      expect(evidenceErrorMessage('unexpected string')).toBe('Failed to load evidence image.');
    });

    it.each([
      ['network', 'Cannot reach the evidence service. Check your connection and try again.'],
      ['timeout', 'Loading evidence timed out. Please try again.'],
      ['cancelled', 'Evidence loading was cancelled.'],
      ['invalid-response', 'The evidence service returned an invalid image. Please try again.'],
    ] as const)('gives actionable %s feedback without raw exception details', (code, message) => {
      expect(evidenceErrorMessage(new ApiError(code, 'private-service-canary'))).toBe(message);
    });

    it('localizes fixed safe messages across EN and VI without leaking raw backend errors', async () => {
      await i18n.changeLanguage('vi');

      expect(formatEvidenceKind('FRAME')).toBe('Khung hình');
      expect(formatEvidenceKind('CROP')).toBe('Ảnh cắt');
      expect(evidenceErrorMessage(new ApiError('http', 'secret-token', 401))).toBe(
        'Phiên đăng nhập không còn hợp lệ. Hãy đăng nhập lại.',
      );
      expect(evidenceErrorMessage(new ApiError('http', 'secret-token', 403))).toBe(
        'Tài khoản này không có quyền xem bằng chứng của công trường đã chọn.',
      );
      expect(evidenceErrorMessage(new ApiError('http', 'secret-token', 404))).toBe(
        'Ảnh bằng chứng được yêu cầu không còn khả dụng.',
      );
      expect(evidenceErrorMessage(new ApiError('http', 'secret-token', 429))).toBe(
        'Quá nhiều yêu cầu. Vui lòng chờ trước khi thử lại.',
      );
      expect(evidenceErrorMessage(new ApiError('http', 'secret-token', 503))).toBe(
        'Bằng chứng tạm thời không khả dụng.',
      );
      expect(evidenceErrorMessage(new ApiError('network', 'http://10.0.0.1/secret'))).toBe(
        'Không thể kết nối tới dịch vụ bằng chứng. Hãy kiểm tra kết nối và thử lại.',
      );
      expect(evidenceErrorMessage(new ApiError('timeout', 'http://10.0.0.1/secret'))).toBe(
        'Quá thời gian tải bằng chứng. Vui lòng thử lại.',
      );
      expect(evidenceErrorMessage(new ApiError('cancelled', 'http://10.0.0.1/secret'))).toBe(
        'Đã hủy tải bằng chứng.',
      );
      expect(evidenceErrorMessage(new ApiError('invalid-response', 'corrupt-header'))).toBe(
        'Dịch vụ bằng chứng trả về hình ảnh không hợp lệ. Vui lòng thử lại.',
      );
      expect(evidenceErrorMessage(new ApiError('http', 'raw-db-error-500', 500))).toBe(
        'Dịch vụ tạm thời không khả dụng. Vui lòng thử lại.',
      );

      await i18n.changeLanguage('en');
      expect(evidenceErrorMessage(new ApiError('http', 'secret-token', 429))).toBe(
        'Too many requests. Wait before trying again.',
      );
    });
  });

  describe('formatCandidateSubtype', () => {
    it('retains strict machine-mapped subtype labels across PPE and zone entries', async () => {
      expect(formatCandidateSubtype('PPE_HARD_HAT_MISSING')).toBe('Missing Hard Hat');
      expect(formatCandidateSubtype('PPE_SAFETY_VEST_MISSING')).toBe('Missing Safety Vest');
      expect(formatCandidateSubtype('PPE_GLOVES_MISSING')).toBe('Missing Gloves');
      expect(formatCandidateSubtype('PPE_BOOTS_MISSING')).toBe('Missing Boots');
      expect(formatCandidateSubtype('PPE_GOGGLES_MISSING')).toBe('Missing Goggles');
      expect(formatCandidateSubtype('ZONE_ENTRY_VIOLATION')).toBe('Zone Entry Violation');
      expect(formatCandidateSubtype('ZONE_ENTRY_UNAUTHORIZED')).toBe('Unauthorized Zone Entry');
      expect(formatCandidateSubtype('ZONE_ENTRY_AUTHORIZATION_UNAVAILABLE')).toBe(
        'Authorization Unavailable',
      );
      expect(formatCandidateSubtype('RESTRICTED_ZONE_INTRUSION')).toBe('Restricted Zone Intrusion');

      await i18n.changeLanguage('vi');
      expect(formatCandidateSubtype('PPE_HARD_HAT_MISSING')).toBe('Thiếu mũ bảo hộ');
      expect(formatCandidateSubtype('ZONE_ENTRY_AUTHORIZATION_UNAVAILABLE')).toBe(
        'Không thể xác minh quyền vào khu vực',
      );
    });
  });
});
