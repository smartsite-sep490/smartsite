import { hasRegisteredFeatureKey, registerFeatureCatalog } from './i18n/feature-catalog-registry';

export const FRAME_INBOX_EXTRA_EN = {
  'frameInbox.wholeFrameBadge': 'Whole frame',
  'frameInbox.personCropBadge': 'Person crop · Person {number}',
  'frameInbox.zoneUnavailableCount_one': '{count} Zone check unverified (insufficient evidence)',
  'frameInbox.zoneUnavailableCount_other': '{count} Zone checks unverified (insufficient evidence)',
  'frameInbox.technicalSummary': 'Technical frame details',
  'frameInbox.frameKeyLabel': 'Frame key:',
  'frameInbox.updatedCasesPill_one': '{{count}} updated case',
  'frameInbox.updatedCasesPill_other': '{{count}} updated cases',
  'frameInbox.caseUpdatedRevision': 'Updated case · Rev #{{revision}}',
  'frameInbox.caseSeenRevision': 'Rev #{{revision}}',
  'frameInbox.selectAllUnreadPage_one': 'Select {{count}} unread frame on this page',
  'frameInbox.selectAllUnreadPage_other': 'Select all {{count}} unread frames on this page',
  'frameInbox.selectedFramesCount_one': '{{count}} frame selected',
  'frameInbox.selectedFramesCount_other': '{{count}} frames selected',
  'frameInbox.clearFrameSelection': 'Clear selection',
  'frameInbox.markSelectedRead_one': 'Mark {{count}} selected frame read',
  'frameInbox.markSelectedRead_other': 'Mark {{count}} selected frames read',
  'frameInbox.markVisiblePageRead_one': 'Mark {{count}} unread frame on page read',
  'frameInbox.markVisiblePageRead_other': 'Mark all {{count}} unread frames on page read',
  'frameInbox.selectFrameAria': 'Select frame {{camera}} at {{time}}',
  'frameInbox.batchAckScopeHint':
    'Acknowledges displayed content revisions only; each person case still requires explicit Safety Officer review.',
} as const;

export type FrameInboxExtraKey = keyof typeof FRAME_INBOX_EXTRA_EN;

export const FRAME_INBOX_EXTRA_VI: Record<FrameInboxExtraKey, string> = {
  'frameInbox.wholeFrameBadge': 'Toàn khung hình',
  'frameInbox.personCropBadge': 'Ảnh cắt người · Người {number}',
  'frameInbox.zoneUnavailableCount_one': '{count} lượt kiểm tra vùng chưa đủ bằng chứng',
  'frameInbox.zoneUnavailableCount_other': '{count} lượt kiểm tra vùng chưa đủ bằng chứng',
  'frameInbox.technicalSummary': 'Chi tiết kỹ thuật khung hình',
  'frameInbox.frameKeyLabel': 'Khóa khung hình:',
  'frameInbox.updatedCasesPill_one': '{{count}} hồ sơ có cập nhật mới',
  'frameInbox.updatedCasesPill_other': '{{count}} hồ sơ có cập nhật mới',
  'frameInbox.caseUpdatedRevision': 'Hồ sơ cập nhật · Phiên bản #{{revision}}',
  'frameInbox.caseSeenRevision': 'Phiên bản #{{revision}}',
  'frameInbox.selectAllUnreadPage_one': 'Chọn {{count}} khung chưa đọc trên trang',
  'frameInbox.selectAllUnreadPage_other': 'Chọn cả {{count}} khung chưa đọc trên trang',
  'frameInbox.selectedFramesCount_one': 'Đã chọn {{count}} khung',
  'frameInbox.selectedFramesCount_other': 'Đã chọn {{count}} khung',
  'frameInbox.clearFrameSelection': 'Bỏ chọn',
  'frameInbox.markSelectedRead_one': 'Đánh dấu đã đọc {{count}} khung đã chọn',
  'frameInbox.markSelectedRead_other': 'Đánh dấu đã đọc {{count}} khung đã chọn',
  'frameInbox.markVisiblePageRead_one': 'Đánh dấu đã đọc {{count}} khung trên trang',
  'frameInbox.markVisiblePageRead_other': 'Đánh dấu đã đọc cả {{count}} khung trên trang',
  'frameInbox.selectFrameAria': 'Chọn khung hình {{camera}} lúc {{time}}',
  'frameInbox.batchAckScopeHint':
    'Chỉ xác nhận đã xem đúng phiên bản đang hiển thị trên trang; việc kết luận từng phát hiện vẫn thực hiện riêng trong hồ sơ.',
};

export function registerFrameInboxExtraCatalog(): void {
  if (hasRegisteredFeatureKey('frameInbox.markVisiblePageRead_one')) {
    return;
  }
  registerFeatureCatalog({
    en: FRAME_INBOX_EXTRA_EN,
    vi: FRAME_INBOX_EXTRA_VI,
  });
}

registerFrameInboxExtraCatalog();
