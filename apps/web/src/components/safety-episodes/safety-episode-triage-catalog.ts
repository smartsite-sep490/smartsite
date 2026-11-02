import {
  registerFeatureCatalog,
  type FeatureCatalogPair,
} from '../../i18n/feature-catalog-registry';

const en = {
  'safetyTriage.trackedHeading': 'Tracked episode',
  'safetyTriage.backToInbox': 'Back to inbox',
  'safetyTriage.showSelectionTechnical': 'Show selection IDs',
  'safetyTriage.hideSelectionTechnical': 'Hide selection IDs',
  'safetyTriage.recipientId': 'Recipient row ID',
  'safetyTriage.episodeId': 'Episode ID',
  'safetyTriage.siteId': 'Site ID',
  'safetyTriage.segmentId': 'Technical segment ID',
  'safetyTriage.scopeSha256': 'Scope SHA-256',
};

const vi: Record<keyof typeof en, string> = {
  'safetyTriage.trackedHeading': 'Hồ sơ theo dõi',
  'safetyTriage.backToInbox': 'Quay lại danh sách',
  'safetyTriage.showSelectionTechnical': 'Hiện mã chọn',
  'safetyTriage.hideSelectionTechnical': 'Ẩn mã chọn',
  'safetyTriage.recipientId': 'Mã dòng người nhận',
  'safetyTriage.episodeId': 'Mã hồ sơ',
  'safetyTriage.siteId': 'Mã công trường',
  'safetyTriage.segmentId': 'Mã phân đoạn kỹ thuật',
  'safetyTriage.scopeSha256': 'SHA-256 phạm vi',
};

export const safetyEpisodeTriageCatalog: FeatureCatalogPair<keyof typeof en> = {
  en,
  vi,
};

registerFeatureCatalog(safetyEpisodeTriageCatalog);
