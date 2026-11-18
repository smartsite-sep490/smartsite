import { hasRegisteredFeatureKey, registerFeatureCatalog } from './i18n/feature-catalog-registry';

export const FRAME_INBOX_EXTRA_EN = {
  'frameInbox.wholeFrameBadge': 'Whole frame',
  'frameInbox.personCropBadge': 'Person crop · Person {number}',
  'frameInbox.zoneUnavailableCount_one': '{count} Zone check unverified (insufficient evidence)',
  'frameInbox.zoneUnavailableCount_other': '{count} Zone checks unverified (insufficient evidence)',
  'frameInbox.technicalSummary': 'Technical frame details',
  'frameInbox.frameKeyLabel': 'Frame key:',
} as const;

export type FrameInboxExtraKey = keyof typeof FRAME_INBOX_EXTRA_EN;

export const FRAME_INBOX_EXTRA_VI: Record<FrameInboxExtraKey, string> = {
  'frameInbox.wholeFrameBadge': 'Toàn khung hình',
  'frameInbox.personCropBadge': 'Ảnh cắt người · Người {number}',
  'frameInbox.zoneUnavailableCount_one': '{count} lượt kiểm tra vùng chưa đủ bằng chứng',
  'frameInbox.zoneUnavailableCount_other': '{count} lượt kiểm tra vùng chưa đủ bằng chứng',
  'frameInbox.technicalSummary': 'Chi tiết kỹ thuật khung hình',
  'frameInbox.frameKeyLabel': 'Khóa khung hình:',
};

export function registerFrameInboxExtraCatalog(): void {
  if (hasRegisteredFeatureKey('frameInbox.wholeFrameBadge')) {
    return;
  }
  registerFeatureCatalog({
    en: FRAME_INBOX_EXTRA_EN,
    vi: FRAME_INBOX_EXTRA_VI,
  });
}

registerFrameInboxExtraCatalog();
