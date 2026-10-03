import { describe, expect, it } from 'vitest';
import { ApiError } from '@smartsite/api-client';
import {
  buildObservationIdentityContextQueryKey,
  buildObservationIdentityDecisionsQueryKey,
  buildObservationIdentityWorkersQueryKey,
  computeBoxOverlayRect,
  computeCommandSignature,
  computeViewedEvidenceSha256,
  formatClearBlockReason,
  formatIdentityErrorMessage,
  formatResolveBlockReason,
  formatTechnicalStatus,
  getOrGenerateCommandId,
  validateReason,
  type ObservationIdentityCommandInput,
  type ObservationIdentityCommandScope,
} from './observationIdentityReviewUtils';

// Immutable synthetic minimal valid JPEG fixture (SOI, APP0, SOF0, SOS, EOI)
const SYNTHETIC_MINIMAL_JPEG_BYTES = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
  0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08,
  0x07, 0x07, 0x07, 0x09, 0x09, 0x08, 0x0a, 0x0c, 0x14, 0x0d, 0x0c, 0x0b, 0x0b, 0x0c, 0x19, 0x12,
  0x13, 0x0f, 0x14, 0x1d, 0x1a, 0x1f, 0x1e, 0x1d, 0x1a, 0x1c, 0x1c, 0x20, 0x24, 0x2e, 0x27, 0x20,
  0x22, 0x2c, 0x23, 0x1c, 0x1c, 0x28, 0x37, 0x29, 0x2c, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1f, 0x27,
  0x39, 0x3d, 0x38, 0x32, 0x3c, 0x2e, 0x33, 0x34, 0x32, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01,
  0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00,
  0xbf, 0xff, 0xd9,
]);

describe('observationIdentityReviewUtils', () => {
  describe('computeViewedEvidenceSha256', () => {
    it('computes correct SHA-256 hex string from valid synthetic JPEG', async () => {
      const blob = new Blob([SYNTHETIC_MINIMAL_JPEG_BYTES], {
        type: 'image/jpeg',
      });
      const hash = await computeViewedEvidenceSha256(blob);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('rejects zero-byte JPEG with user-facing message without Blob/MIME terms', async () => {
      const emptyBlob = new Blob([], { type: 'image/jpeg' });
      await expect(computeViewedEvidenceSha256(emptyBlob)).rejects.toThrow(/không có dữ liệu/i);
      // Ensure no technical words
      await expect(computeViewedEvidenceSha256(emptyBlob)).rejects.not.toThrow(/blob|mime/i);
    });

    it('rejects blob exceeding 1MiB (1,048,576 bytes) with user-facing message', async () => {
      const oversizedData = new Uint8Array(1048576 + 1);
      const blob = new Blob([oversizedData], { type: 'image/jpeg' });
      await expect(computeViewedEvidenceSha256(blob)).rejects.toThrow(
        /vượt quá dung lượng cho phép/i,
      );
      await expect(computeViewedEvidenceSha256(blob)).rejects.not.toThrow(/blob|mime/i);
    });

    it('rejects image/jpg and non-JPEG types (accepts only exact image/jpeg)', async () => {
      const jpgBlob = new Blob([SYNTHETIC_MINIMAL_JPEG_BYTES], { type: 'image/jpg' });
      await expect(computeViewedEvidenceSha256(jpgBlob)).rejects.toThrow(
        /định dạng ảnh bằng chứng không hợp lệ/i,
      );

      const pngBlob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
      await expect(computeViewedEvidenceSha256(pngBlob)).rejects.toThrow(
        /định dạng ảnh bằng chứng không hợp lệ/i,
      );
    });
  });

  describe('query key builders', () => {
    it('isolates context query key by apiUrl, sessionScope, siteId, alertId, and eventId without tokens', () => {
      const key1 = buildObservationIdentityContextQueryKey(
        'https://api.example',
        'session-1',
        'site-alpha',
        'alert-1',
        'event-1',
      );
      const key2 = buildObservationIdentityContextQueryKey(
        'https://api.example',
        'session-2',
        'site-alpha',
        'alert-1',
        'event-1',
      );
      const keyOtherSite = buildObservationIdentityContextQueryKey(
        'https://api.example',
        'session-1',
        'site-beta',
        'alert-1',
        'event-1',
      );

      expect(key1).not.toEqual(key2);
      expect(key1).not.toEqual(keyOtherSite);
      expect(key1).toContain('site-alpha');
      expect(key1).toContain('event-1');
      expect(key1).not.toContain('token');
      expect(key1).not.toContain('Bearer');
    });

    it('isolates workers query key with pagination', () => {
      const keyA = buildObservationIdentityWorkersQueryKey(
        'https://api.example',
        'session-1',
        'site-alpha',
        'alert-1',
        'event-1',
        0,
        20,
      );
      const keyB = buildObservationIdentityWorkersQueryKey(
        'https://api.example',
        'session-1',
        'site-alpha',
        'alert-1',
        'event-1',
        20,
        20,
      );

      expect(keyA).not.toEqual(keyB);
      expect(keyA).toContain(0);
      expect(keyB).toContain(20);
    });

    it('isolates decisions query key per personObservationIndex', () => {
      const keyPerson0 = buildObservationIdentityDecisionsQueryKey(
        'https://api.example',
        'session-1',
        'site-alpha',
        'alert-1',
        'event-1',
        0,
      );
      const keyPerson1 = buildObservationIdentityDecisionsQueryKey(
        'https://api.example',
        'session-1',
        'site-alpha',
        'alert-1',
        'event-1',
        1,
      );

      expect(keyPerson0).not.toEqual(keyPerson1);
      expect(keyPerson0).toContain(0);
      expect(keyPerson1).toContain(1);
    });
  });

  describe('validateReason', () => {
    it('accepts valid reasons between 5 and 1000 characters', () => {
      const result = validateReason('Xác nhận đúng công nhân số 1');
      expect(result.valid).toBe(true);
      expect(result.trimmed).toBe('Xác nhận đúng công nhân số 1');
      expect(result.error).toBeUndefined();
    });

    it('rejects reasons shorter than 5 code points after trim', () => {
      const result = validateReason('   abc  ');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/at least 5 characters/i);
    });

    it('rejects reasons longer than 1000 code points', () => {
      const longText = 'a'.repeat(1001);
      const result = validateReason(longText);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/must not exceed 1000 characters/i);
    });

    it('rejects reasons containing null bytes', () => {
      const result = validateReason('Reason with \u0000 null byte');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/invalid characters/i);
    });

    it('correctly counts Unicode code points for Vietnamese accents', () => {
      const result = validateReason('  Đã kiểm tra  ');
      expect(result.valid).toBe(true);
      expect(result.trimmed).toBe('Đã kiểm tra');
    });
  });

  describe('command signature and idempotency with scope', () => {
    const baseScope: ObservationIdentityCommandScope = {
      apiUrl: 'https://api.example',
      sessionScope: 'session-alpha',
      siteId: '00000000-0000-4000-8000-000000000001',
      alertId: '00000000-0000-4000-8000-000000000002',
      eventId: '00000000-0000-4000-8000-000000000003',
      personObservationIndex: 0,
    };

    const baseResolveInput: Extract<ObservationIdentityCommandInput, { action: 'RESOLVE' }> = {
      action: 'RESOLVE',
      expectedRevision: 1,
      expectedEventHash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      reason: 'Đã xác nhận thẻ đeo công trường',
      workerId: '00000000-0000-4000-8000-000000000010',
      evidenceIndex: 0,
      expectedEvidenceSha256: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    };

    it('generates a new UUIDv4 on first call', () => {
      const state = getOrGenerateCommandId(null, baseScope, baseResolveInput);
      expect(state.commandId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it('reuses existing commandId if identical scope and parameters are retried', () => {
      const state1 = getOrGenerateCommandId(null, baseScope, baseResolveInput);
      const state2 = getOrGenerateCommandId(state1, baseScope, { ...baseResolveInput });
      expect(state2.commandId).toBe(state1.commandId);
    });

    it('normalizes UUID case and whitespace in computeCommandSignature', () => {
      const upperScope: ObservationIdentityCommandScope = {
        ...baseScope,
        siteId: baseScope.siteId.toUpperCase(),
        alertId: baseScope.alertId.toUpperCase(),
        eventId: baseScope.eventId.toUpperCase(),
      };
      const upperInput: ObservationIdentityCommandInput = {
        ...baseResolveInput,
        workerId: baseResolveInput.workerId.toUpperCase(),
        expectedEventHash: baseResolveInput.expectedEventHash.toUpperCase(),
        expectedEvidenceSha256: baseResolveInput.expectedEvidenceSha256.toUpperCase(),
        reason: '   Đã xác nhận thẻ đeo công trường   ',
      };

      const sig1 = computeCommandSignature(baseScope, baseResolveInput);
      const sig2 = computeCommandSignature(upperScope, upperInput);
      expect(sig1).toBe(sig2);
    });

    it('RED scope-switch regression: generates new commandId when personObservationIndex changes despite carried tracker', () => {
      const state1 = getOrGenerateCommandId(null, baseScope, baseResolveInput);
      const scopePerson1: ObservationIdentityCommandScope = {
        ...baseScope,
        personObservationIndex: 1, // Changed subject index!
      };
      // Carried state1 across subject switch
      const state2 = getOrGenerateCommandId(state1, scopePerson1, baseResolveInput);
      expect(state2.commandId).not.toBe(state1.commandId);
    });

    it('RED scope-switch regression: generates new commandId when eventId changes despite carried tracker', () => {
      const state1 = getOrGenerateCommandId(null, baseScope, baseResolveInput);
      const scopeOtherEvent: ObservationIdentityCommandScope = {
        ...baseScope,
        eventId: '00000000-0000-4000-8000-000000000099',
      };
      const state2 = getOrGenerateCommandId(state1, scopeOtherEvent, baseResolveInput);
      expect(state2.commandId).not.toBe(state1.commandId);
    });

    it('generates a new commandId if workerId changes', () => {
      const state1 = getOrGenerateCommandId(null, baseScope, baseResolveInput);
      const state2 = getOrGenerateCommandId(state1, baseScope, {
        ...baseResolveInput,
        workerId: '00000000-0000-4000-8000-000000000020',
      });
      expect(state2.commandId).not.toBe(state1.commandId);
    });

    it('generates a new commandId if action changes from RESOLVE to CLEAR', () => {
      const state1 = getOrGenerateCommandId(null, baseScope, baseResolveInput);
      const clearInput: ObservationIdentityCommandInput = {
        action: 'CLEAR',
        expectedRevision: 1,
        expectedEventHash: baseResolveInput.expectedEventHash,
        reason: 'Thu hồi xác minh trước đó',
      };
      const state2 = getOrGenerateCommandId(state1, baseScope, clearInput);
      expect(state2.commandId).not.toBe(state1.commandId);
    });
  });

  describe('computeBoxOverlayRect', () => {
    it('computes overlay coordinates accurately with letterboxing', () => {
      const box = { x1: 0.1, y1: 0.2, x2: 0.6, y2: 0.8 };
      const rect = computeBoxOverlayRect(box, 800, 400, 400, 400);

      expect(rect.valid).toBe(true);
      expect(rect.offsetX).toBe(0);
      expect(rect.offsetY).toBe(100);
      expect(rect.renderedWidth).toBe(400);
      expect(rect.renderedHeight).toBe(200);
      expect(rect.left).toBeCloseTo(40);
      expect(rect.top).toBeCloseTo(140);
      expect(rect.width).toBeCloseTo(200);
      expect(rect.height).toBeCloseTo(120);
    });

    it('computes overlay coordinates accurately with pillarboxing', () => {
      const box = { x1: 0.2, y1: 0.1, x2: 0.8, y2: 0.9 };
      const rect = computeBoxOverlayRect(box, 400, 800, 600, 400);

      expect(rect.valid).toBe(true);
      expect(rect.offsetX).toBe(200);
      expect(rect.offsetY).toBe(0);
      expect(rect.renderedWidth).toBe(200);
      expect(rect.renderedHeight).toBe(400);
      expect(rect.left).toBeCloseTo(240);
      expect(rect.top).toBeCloseTo(40);
      expect(rect.width).toBeCloseTo(120);
      expect(rect.height).toBeCloseTo(320);
    });

    it('rejects nonpositive or nonfinite dimensions and never returns NaN CSS', () => {
      const box = { x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.5 };

      const zeroWidth = computeBoxOverlayRect(box, 0, 400, 400, 400);
      expect(zeroWidth.valid).toBe(false);
      expect(zeroWidth.left).toBe(0);
      expect(Number.isNaN(zeroWidth.left)).toBe(false);

      const nanHeight = computeBoxOverlayRect(box, 400, Number.NaN, 400, 400);
      expect(nanHeight.valid).toBe(false);
      expect(nanHeight.top).toBe(0);

      const infContainer = computeBoxOverlayRect(box, 400, 400, Number.POSITIVE_INFINITY, 400);
      expect(infContainer.valid).toBe(false);
      expect(infContainer.width).toBe(0);
    });

    it('rejects invalid or inverted bounding boxes', () => {
      // Inverted x1 >= x2
      const invertedBox = { x1: 0.8, y1: 0.1, x2: 0.2, y2: 0.9 };
      const resultInverted = computeBoxOverlayRect(invertedBox, 400, 400, 400, 400);
      expect(resultInverted.valid).toBe(false);
      expect(resultInverted.width).toBe(0);

      // Out of bounds (<0 or >1)
      const outOfBounds = { x1: -0.1, y1: 0.1, x2: 0.5, y2: 1.2 };
      const resultOob = computeBoxOverlayRect(outOfBounds, 400, 400, 400, 400);
      expect(resultOob.valid).toBe(false);

      // NaN in box coordinates
      const nanBox = { x1: 0.1, y1: Number.NaN, x2: 0.5, y2: 0.9 };
      const resultNan = computeBoxOverlayRect(nanBox, 400, 400, 400, 400);
      expect(resultNan.valid).toBe(false);
    });
  });

  describe('formatters', () => {
    it('formats identity error messages correctly', () => {
      const staleError = new ApiError('http', 'Observation identity revision is stale', 409);
      expect(formatIdentityErrorMessage(staleError)).toMatch(/phiên bản xem xét đã thay đổi/i);

      const inactiveError = new ApiError('http', 'Worker is inactive', 409);
      expect(formatIdentityErrorMessage(inactiveError)).toMatch(/nhân viên đã ngừng hoạt động/i);

      const forbiddenError = new ApiError('http', 'Forbidden', 403);
      expect(formatIdentityErrorMessage(forbiddenError)).toMatch(/không có thẩm quyền/i);
    });

    it('formats resolve block reasons in human readable Vietnamese', () => {
      expect(formatResolveBlockReason('FRAME_UNAVAILABLE')).toMatch(
        /ảnh bằng chứng.*không khả dụng/i,
      );
      expect(formatResolveBlockReason('EVENT_INCONSISTENT')).toMatch(/không nhất quán/i);
      expect(formatResolveBlockReason('WORKER_READER_UNAVAILABLE')).toMatch(/danh bạ nhân viên/i);
      expect(formatResolveBlockReason(null)).toBe('');
    });

    it('formats clear block reasons in human readable Vietnamese', () => {
      expect(formatClearBlockReason('NO_ACTIVE_RESOLUTION')).toMatch(/chưa có quyết định/i);
      expect(formatClearBlockReason(null)).toBe('');
    });

    it('formats technical status properly', () => {
      expect(formatTechnicalStatus('CANDIDATE')).toBe('Gợi ý AI');
      expect(formatTechnicalStatus('UNKNOWN')).toBe('Chưa xác định');
      expect(formatTechnicalStatus('UNAVAILABLE')).toBe('Không khả dụng');
      expect(formatTechnicalStatus('CONFLICTED')).toBe('Xung đột kỹ thuật');
    });
  });
});
