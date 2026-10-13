import type { EnrollmentCaptureTarget } from '@smartsite/contracts';

export const CAPTURE_GUIDANCE: Record<EnrollmentCaptureTarget, { title: string; detail: string }> =
  {
    front: {
      title: 'Bước 1/3: Nhìn thẳng vào camera',
      detail: 'Đặt toàn bộ mặt trong khung, nhìn thẳng, giữ đầu ngay ngắn và đứng yên.',
    },
    left: {
      title: 'Bước 2/3: Quay nhẹ sang trái của bạn',
      detail: 'Quay cả đầu từ từ sang trái, không chỉ liếc mắt. Giữ mặt trong khung rồi đứng yên.',
    },
    right: {
      title: 'Bước 3/3: Quay nhẹ sang phải của bạn',
      detail: 'Quay đầu về giữa rồi nhẹ sang phải. Không quay quá xa và giữ yên khi máy chụp.',
    },
  };

export function enrollmentQualityMessage(reason: string): string {
  const messages: Record<string, string> = {
    FACE_QUALITY_ACCEPTED:
      'Ảnh đạt yêu cầu: một khuôn mặt, đủ sáng, rõ nét, trong khung và đúng hướng. Có thể sang bước tiếp theo.',
    FACE_NOT_FOUND: 'Chưa thấy khuôn mặt. Đưa toàn bộ mặt vào khung rồi chụp lại.',
    FACE_MULTIPLE_FOUND: 'Có nhiều khuôn mặt. Chỉ để người đăng ký xuất hiện trong khung.',
    FACE_TOO_SMALL: 'Mặt quá nhỏ hoặc quá xa. Tiến gần camera hơn.',
    FACE_TOO_CLOSE: 'Mặt quá gần. Lùi lại một chút để thấy toàn bộ khuôn mặt.',
    FACE_CLIPPED: 'Khuôn mặt bị cắt ở mép ảnh. Đưa toàn bộ mặt vào khung.',
    FACE_NOT_CENTERED: 'Mặt lệch khỏi giữa khung. Điều chỉnh vị trí rồi chụp lại.',
    FACE_TOO_DARK: 'Ảnh thiếu sáng. Bật đèn hoặc hướng mặt về nguồn sáng.',
    FACE_TOO_BRIGHT: 'Ảnh quá sáng. Tránh ánh sáng chiếu trực tiếp vào mặt.',
    FACE_BLURRY: 'Ảnh bị mờ. Giữ đầu đứng yên và lau camera nếu cần.',
    FACE_HEAD_TILTED: 'Đầu đang nghiêng. Giữ đầu ngay ngắn, không nghiêng vai.',
    FACE_TURN_TOO_FAR: 'Bạn quay đầu quá xa. Quay nhẹ hơn để camera thấy các điểm trên mặt.',
    FACE_POSE_FRONT_REQUIRED: 'Ảnh chưa nhìn thẳng. Quay mặt về chính giữa camera.',
    FACE_POSE_LEFT_REQUIRED: 'Ảnh chưa đúng góc trái. Quay nhẹ đầu sang trái của bạn rồi chụp lại.',
    FACE_POSE_RIGHT_REQUIRED:
      'Ảnh chưa đúng góc phải. Quay nhẹ đầu sang phải của bạn rồi chụp lại.',
    FACE_NOT_CLEAR: 'Camera chưa thấy mặt đủ rõ. Giữ yên, tránh che mặt và điều chỉnh ánh sáng.',
    FACE_LANDMARKS_UNAVAILABLE:
      'Chưa xác định rõ các điểm trên mặt. Bỏ vật che mặt và quay nhẹ hơn.',
    FACE_IMAGE_INVALID: 'Ảnh chụp không đọc được. Hãy chụp lại.',
  };
  return (
    messages[reason] ??
    'Ảnh chưa đủ chất lượng. Điều chỉnh ánh sáng, vị trí và giữ yên rồi chụp lại.'
  );
}
