import { registerFeatureCatalog } from '../../../i18n/feature-catalog-registry';

export const EPISODE_EN_CATALOG = {
  'episode.detail.regionAria': 'Safety episode detail',
  'episode.detail.subjectTitle': 'Person in this image',
  'episode.detail.collectionCollecting': 'Collecting',
  'episode.detail.collectionSealed': 'Sealed',
  'episode.detail.collectingNote': 'Collecting observations for this person',
  'episode.detail.sealedNote': 'Collection stopped; findings still need individual review',
  'episode.detail.siteLabel': 'Site',
  'episode.detail.siteFallback': 'Linked site',
  'episode.detail.cameraLabel': 'Camera',
  'episode.detail.cameraFallback': 'Linked camera',
  'episode.detail.firstObservedLabel': 'First observed',
  'episode.detail.lastObservedLabel': 'Last observed',
  'episode.detail.identityLabel': 'Identity',
  'episode.detail.identityUnknownBadge': 'Unknown identity',
  'episode.detail.identityUnknownNote': 'Identity not verified — no worker assigned',
  'episode.detail.identityClearedBadge': 'Identity cleared',
  'episode.detail.identityClearedNote': 'Prior identity assignment cleared — no worker assigned',
  'episode.detail.identityResolvedBadge': 'Identity verified',
  'episode.detail.identityResolvedNote': 'Verified by manual exact-observation review',
  'episode.detail.findingsHeading': 'Findings to review ({{count}})',
  'episode.detail.findingsEmpty': 'No findings recorded for this person.',
  'episode.detail.zoneLinked': 'Linked zone',
  'episode.detail.zoneUnresolved': 'No resolved zone',
  'episode.detail.reviewFindingBtn': 'Review finding',
  'episode.detail.evidenceEmpty': 'No evidence references recorded for this finding.',
  'episode.detail.evidenceItemLabel': 'Evidence #{{index}}',
  'episode.detail.evidenceAvailable': 'Available',
  'episode.detail.evidenceUnavailable': 'Unavailable',
  'episode.detail.evidenceUnbound': 'Unbound subject',
  'episode.detail.requestEvidenceBtn': 'View evidence #{{index}}',
  'episode.detail.workflowHeading': 'Linked workflow',
  'episode.detail.incidentLabel': 'Incident #{{index}}',
  'episode.detail.actionLabel': 'Corrective action #{{index}}',
  'episode.detail.techEpisodeLine':
    'Episode {{id}} · Content revision #{{revision}} · Reported findingCount {{findingCount}}',
  'episode.detail.techContextLine': 'Site ID {{siteId}} · Camera ID {{cameraId}}',
  'episode.detail.techSubjectLine':
    'Subject {{kind}} · Event {{eventId}} · observations[{{index}}] (0-based array index, not Worker ID or person count)',
  'episode.detail.techBundleActive': 'Configuration bundle ID: {{bundleId}}',
  'episode.detail.techBundleNull': 'Configuration bundle: Unsupported legacy context (null)',
  'episode.detail.techIdentityResolved':
    'Manual identity decision {{id}} · revision #{{revision}} · Worker ID {{workerId}}',
  'episode.detail.techIdentityCleared':
    'Manual identity decision {{id}} · revision #{{revision}} · Action CLEAR',
  'episode.detail.techFindingLine':
    'Finding alert {{alertId}} · Alert revision #{{revision}} · Zone {{zoneId}}',
  'episode.detail.techEvidenceLine':
    'Evidence event {{eventId}} · observations[{{personIndex}}] · evidence #{{evidenceIndex}} · sha256 {{sha256}}',
  'episode.detail.techWorkflowLine': 'Incident {{incidentId}} · Actions {{actionIds}}',
} as const;

export type EpisodeCatalogKey = keyof typeof EPISODE_EN_CATALOG;

export const EPISODE_VI_CATALOG: Record<EpisodeCatalogKey, string> = {
  'episode.detail.regionAria': 'Chi tiết hồ sơ quan sát an toàn',
  'episode.detail.subjectTitle': 'Người trong ảnh này',
  'episode.detail.collectionCollecting': 'Đang thu thập',
  'episode.detail.collectionSealed': 'Đã đóng thu thập',
  'episode.detail.collectingNote': 'Đang thu thập quan sát cho người này',
  'episode.detail.sealedNote': 'Đã dừng thu thập; từng phát hiện vẫn cần duyệt riêng',
  'episode.detail.siteLabel': 'Công trường',
  'episode.detail.siteFallback': 'Công trường liên kết',
  'episode.detail.cameraLabel': 'Camera',
  'episode.detail.cameraFallback': 'Camera liên kết',
  'episode.detail.firstObservedLabel': 'Quan sát đầu tiên',
  'episode.detail.lastObservedLabel': 'Quan sát gần nhất',
  'episode.detail.identityLabel': 'Danh tính',
  'episode.detail.identityUnknownBadge': 'Chưa rõ danh tính',
  'episode.detail.identityUnknownNote': 'Chưa xác minh danh tính — chưa gán công nhân',
  'episode.detail.identityClearedBadge': 'Đã xóa gán danh tính',
  'episode.detail.identityClearedNote': 'Đã xóa gán danh tính trước đó — chưa xác định công nhân',
  'episode.detail.identityResolvedBadge': 'Đã xác minh danh tính',
  'episode.detail.identityResolvedNote': 'Đã xác minh thủ công trên quan sát gốc',
  'episode.detail.findingsHeading': 'Phát hiện cần xem xét ({{count}})',
  'episode.detail.findingsEmpty': 'Chưa có phát hiện nào được ghi nhận cho người này.',
  'episode.detail.zoneLinked': 'Khu vực liên kết',
  'episode.detail.zoneUnresolved': 'Chưa xác định khu vực',
  'episode.detail.reviewFindingBtn': 'Xem xét phát hiện',
  'episode.detail.evidenceEmpty': 'Chưa có tham chiếu bằng chứng cho phát hiện này.',
  'episode.detail.evidenceItemLabel': 'Bằng chứng #{{index}}',
  'episode.detail.evidenceAvailable': 'Khả dụng',
  'episode.detail.evidenceUnavailable': 'Không khả dụng',
  'episode.detail.evidenceUnbound': 'Không khớp chủ thể',
  'episode.detail.requestEvidenceBtn': 'Xem bằng chứng #{{index}}',
  'episode.detail.workflowHeading': 'Quy trình xử lý liên kết',
  'episode.detail.incidentLabel': 'Sự cố #{{index}}',
  'episode.detail.actionLabel': 'Hành động khắc phục #{{index}}',
  'episode.detail.techEpisodeLine':
    'Hồ sơ {{id}} · Phiên bản nội dung #{{revision}} · Số phát hiện báo cáo {{findingCount}}',
  'episode.detail.techContextLine': 'Mã công trường {{siteId}} · Mã camera {{cameraId}}',
  'episode.detail.techSubjectLine':
    'Chủ thể {{kind}} · Sự kiện {{eventId}} · observations[{{index}}] (chỉ mục mảng tính từ 0, không phải mã công nhân hay số người)',
  'episode.detail.techBundleActive': 'Mã gói cấu hình: {{bundleId}}',
  'episode.detail.techBundleNull': 'Gói cấu hình: Ngữ cảnh cũ chưa gắn gói cấu hình (null)',
  'episode.detail.techIdentityResolved':
    'Quyết định danh tính thủ công {{id}} · phiên bản #{{revision}} · Mã công nhân {{workerId}}',
  'episode.detail.techIdentityCleared':
    'Quyết định danh tính thủ công {{id}} · phiên bản #{{revision}} · Thao tác CLEAR',
  'episode.detail.techFindingLine':
    'Cảnh báo phát hiện {{alertId}} · Phiên bản cảnh báo #{{revision}} · Khu vực {{zoneId}}',
  'episode.detail.techEvidenceLine':
    'Sự kiện bằng chứng {{eventId}} · observations[{{personIndex}}] · bằng chứng #{{evidenceIndex}} · sha256 {{sha256}}',
  'episode.detail.techWorkflowLine': 'Sự cố {{incidentId}} · Hành động {{actionIds}}',
};

registerFeatureCatalog({ en: EPISODE_EN_CATALOG, vi: EPISODE_VI_CATALOG });
