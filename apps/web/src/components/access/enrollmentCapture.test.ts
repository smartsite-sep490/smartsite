import { describe, expect, it } from 'vitest';
import { CAPTURE_GUIDANCE, enrollmentQualityMessage } from './enrollmentCapture';

describe('guided face capture feedback', () => {
  it('instructs front then the user’s own left and right without pretending to measure yaw', () => {
    expect(CAPTURE_GUIDANCE.front.title).toContain('Nhìn thẳng');
    expect(CAPTURE_GUIDANCE.left.title).toContain('trái của bạn');
    expect(CAPTURE_GUIDANCE.right.title).toContain('phải của bạn');
    expect(CAPTURE_GUIDANCE.left.detail).toContain('không chỉ liếc mắt');
  });
  it('gives actionable feedback and never marks unknown reason codes accepted', () => {
    expect(enrollmentQualityMessage('FACE_BLURRY')).toContain('Giữ đầu đứng yên');
    expect(enrollmentQualityMessage('FACE_TOO_DARK')).toContain('Bật đèn');
    expect(enrollmentQualityMessage('FACE_MULTIPLE_FOUND')).toContain('Chỉ để người đăng ký');
    expect(enrollmentQualityMessage('FACE_POSE_LEFT_REQUIRED')).toContain('góc trái');
    expect(enrollmentQualityMessage('FACE_QUALITY_ACCEPTED')).toContain('Ảnh đạt yêu cầu');
    expect(enrollmentQualityMessage('untrusted service response')).toContain('chưa đủ chất lượng');
  });
});
