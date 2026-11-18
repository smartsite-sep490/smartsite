import type { SafetyIdentificationRetrospectiveAssessment } from '@smartsite/api-client';
import type { BadgeProps } from '../ui';

const RAW_UUID_RE = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export type RetrospectiveAssessmentStatus = SafetyIdentificationRetrospectiveAssessment['status'];
export type RetrospectiveOriginalOutcome =
  SafetyIdentificationRetrospectiveAssessment['originalOutcome'];

export const RETROSPECTIVE_PAGE_SIZE = 10;
export const RETROSPECTIVE_POLL_INTERVAL_MS = 2_000;

export const RETROSPECTIVE_LABELS = {
  en: {
    title: 'Zone reassessments',
    subtitle:
      'Re-evaluate historical zone permissions at capture time using this accepted worker identification.',
    show: 'View zone reassessments',
    hide: 'Hide zone reassessments',
    refresh: 'Refresh',
    loading: 'Loading reassessments…',
    failed: 'Could not load zone reassessments.',
    deniedNotice:
      'Zone reassessment records are unavailable for your current session or site access.',
    empty: 'No reassessments have been requested for this case.',
    reassessment: 'Retrospective result',
    original: 'Original assessment',
    noOriginal: 'Awaiting original result',
    capture: 'Recorded at',
    zone: 'Zone',
    camera: 'Camera',
    previous: 'Previous',
    next: 'Next',
    showingRange: (from: number, to: number, total: number) => `Showing ${from}–${to} of ${total}`,
    entry: 'Zone entry to reassess',
    choose: 'Choose a zone entry',
    request: 'Request reassessment',
    queued: 'Reassessment queued.',
    autoUpdating: 'Updating automatically while reassessment is in progress…',
    submitError: 'Could not request reassessment. You can retry.',
    optionsError: 'Could not load zone entries eligible for reassessment.',
    noOptions: 'No zone entries in this case are eligible for a new reassessment.',
    status: {
      PENDING: 'Queued',
      CLAIMED: 'In progress',
      ALLOWED: 'Access authorized',
      DENIED: 'Access unauthorized',
      UNAVAILABLE: 'Unable to assess',
      FAILED: 'Assessment failed',
      CANCELLED: 'Cancelled',
    },
    stateHint: {
      PENDING: 'Waiting for historical zone permission check at recorded time.',
      CLAIMED: 'Checking historical zone permissions at recorded time…',
      FAILED: 'Automatic check did not complete. Refresh to check the latest status.',
    },
    unrestricted: 'Zone did not require authorization',
    prohibited: 'Entry prohibited for everyone',
  },
  vi: {
    title: 'Lịch sử đánh giá lại quyền vào vùng',
    subtitle:
      'Đánh giá lại quyền vào vùng tại đúng thời điểm ghi hình dựa trên kết luận xác minh danh tính đã duyệt.',
    show: 'Xem lịch sử đánh giá lại',
    hide: 'Ẩn lịch sử đánh giá lại',
    refresh: 'Làm mới',
    loading: 'Đang tải lịch sử đánh giá…',
    failed: 'Chưa tải được lịch sử đánh giá lại.',
    deniedNotice:
      'Dữ liệu đánh giá lại hiện không khả dụng với phiên đăng nhập hoặc quyền công trường hiện tại.',
    empty: 'Hồ sơ này chưa có yêu cầu đánh giá lại.',
    reassessment: 'Kết quả đánh giá lại',
    original: 'Đánh giá ban đầu',
    noOriginal: 'Chưa có kết quả ban đầu',
    capture: 'Thời điểm ghi hình',
    zone: 'Khu vực',
    camera: 'Camera',
    previous: 'Trang trước',
    next: 'Trang sau',
    showingRange: (from: number, to: number, total: number) => `Hiển thị ${from}–${to} / ${total}`,
    entry: 'Lượt vào vùng cần đánh giá lại',
    choose: 'Chọn lượt vào vùng',
    request: 'Gửi yêu cầu đánh giá lại',
    queued: 'Đã gửi yêu cầu đánh giá lại.',
    autoUpdating: 'Tự động cập nhật khi đang đánh giá lại…',
    submitError: 'Chưa gửi được yêu cầu. Bạn có thể thử lại.',
    optionsError: 'Chưa tải được các lượt vào vùng đủ điều kiện đánh giá lại.',
    noOptions: 'Hồ sơ này không có lượt vào vùng nào đủ điều kiện đánh giá lại thêm.',
    status: {
      PENDING: 'Đang chờ xử lý',
      CLAIMED: 'Đang đánh giá',
      ALLOWED: 'Có quyền vào vùng',
      DENIED: 'Không có quyền vào vùng',
      UNAVAILABLE: 'Chưa thể đánh giá',
      FAILED: 'Đánh giá thất bại',
      CANCELLED: 'Đã hủy',
    },
    stateHint: {
      PENDING: 'Đang chờ kiểm tra quyền vào vùng tại thời điểm ghi hình.',
      CLAIMED: 'Đang đối chiếu quyền vào vùng tại thời điểm ghi hình…',
      FAILED: 'Chưa hoàn tất kiểm tra tự động. Hãy bấm Làm mới để kiểm tra lại.',
    },
    unrestricted: 'Khu vực không yêu cầu cấp quyền',
    prohibited: 'Khu vực cấm mọi người',
  },
} as const;

export type RetrospectiveCopy = (typeof RETROSPECTIVE_LABELS)[keyof typeof RETROSPECTIVE_LABELS];

export function isActiveRetrospectiveStatus(status: RetrospectiveAssessmentStatus): boolean {
  return status === 'PENDING' || status === 'CLAIMED';
}

export function resolveRetrospectiveVerdict(
  item: SafetyIdentificationRetrospectiveAssessment,
  copy: RetrospectiveCopy,
): string {
  if (item.reasonCode === 'POLICY_NONE' && item.status === 'ALLOWED') return copy.unrestricted;
  if (item.reasonCode === 'POLICY_PROHIBITED' && item.status === 'DENIED') return copy.prohibited;
  return copy.status[item.status] ?? copy.status.UNAVAILABLE;
}

export function retrospectiveBadgeVariant(
  item: SafetyIdentificationRetrospectiveAssessment,
): NonNullable<BadgeProps['variant']> {
  switch (item.status) {
    case 'PENDING':
      return 'warning';
    case 'CLAIMED':
      return 'info';
    case 'ALLOWED':
      return 'success';
    case 'DENIED':
    case 'FAILED':
      return 'danger';
    case 'UNAVAILABLE':
    case 'CANCELLED':
      return 'neutral';
  }
}

export function retrospectiveStateHint(
  status: RetrospectiveAssessmentStatus,
  copy: RetrospectiveCopy,
): string | null {
  if (status === 'PENDING') return copy.stateHint.PENDING;
  if (status === 'CLAIMED') return copy.stateHint.CLAIMED;
  if (status === 'FAILED') return copy.stateHint.FAILED;
  return null;
}

export function safeRetrospectivePlaceLabel(
  name: string | null | undefined,
  fallback: string,
): string {
  const trimmed = name?.trim() ?? '';
  if (!trimmed || RAW_UUID_RE.test(trimmed)) return fallback;
  return trimmed;
}
