import { registerFeatureCatalog } from '../../i18n/feature-catalog-registry';

const en = {
  'trackedWorkspace.title': 'Tracked episode evidence',
  'trackedWorkspace.subtitle':
    'Original observation mappings and verified JPEG media for this tracked episode. Technical segment metadata never implies a Worker or team identity.',
  'trackedWorkspace.loadingDetail': 'Loading tracked episode…',
  'trackedWorkspace.errorDetail': 'Could not load tracked episode metadata. Please try again.',
  'trackedWorkspace.forbiddenDetail':
    'You do not have permission to view this tracked episode in the current scope.',
  'trackedWorkspace.retryDetail': 'Retry episode',
  'trackedWorkspace.stateCollecting': 'Collecting',
  'trackedWorkspace.stateSealed': 'Sealed',
  'trackedWorkspace.revisionBadge': 'Revision #{{revision}}',
  'trackedWorkspace.captureRange': 'Observed window',
  'trackedWorkspace.findingFilterLabel': 'Filter observations by finding',
  'trackedWorkspace.allFindings': 'All findings ({{count}})',
  'trackedWorkspace.findingOption': '{{label}} ({{count}} mappings)',
  'trackedWorkspace.showEpisodeTechnical': 'Show episode technical metadata',
  'trackedWorkspace.hideEpisodeTechnical': 'Hide episode technical metadata',
  'trackedWorkspace.episodeId': 'Episode ID',
  'trackedWorkspace.siteId': 'Site ID',
  'trackedWorkspace.cameraId': 'Camera ID',
  'trackedWorkspace.segmentId': 'Technical segment ID (not Worker ID)',
  'trackedWorkspace.scopeSha256': 'Scope SHA-256',
  'trackedWorkspace.nextPageFailed': 'Failed to load the next observation page.',
};

const vi: Record<keyof typeof en, string> = {
  'trackedWorkspace.title': 'Bằng chứng hồ sơ theo dõi (TRACKED)',
  'trackedWorkspace.subtitle':
    'Lịch sử ánh xạ quan sát gốc và ảnh JPEG đã xác minh của hồ sơ theo dõi này. Siêu dữ liệu phân đoạn kỹ thuật không bao giờ hàm ý danh tính Công nhân hay tổ đội.',
  'trackedWorkspace.loadingDetail': 'Đang tải hồ sơ theo dõi…',
  'trackedWorkspace.errorDetail': 'Không thể tải siêu dữ liệu hồ sơ theo dõi. Vui lòng thử lại.',
  'trackedWorkspace.forbiddenDetail':
    'Bạn không có quyền xem hồ sơ theo dõi này trong phạm vi hiện tại.',
  'trackedWorkspace.retryDetail': 'Thử tải lại hồ sơ',
  'trackedWorkspace.stateCollecting': 'Đang thu thập',
  'trackedWorkspace.stateSealed': 'Đã niêm phong',
  'trackedWorkspace.revisionBadge': 'Phiên bản #{{revision}}',
  'trackedWorkspace.captureRange': 'Khoảng thời gian ghi nhận',
  'trackedWorkspace.findingFilterLabel': 'Lọc quan sát theo phát hiện',
  'trackedWorkspace.allFindings': 'Tất cả phát hiện ({{count}})',
  'trackedWorkspace.findingOption': '{{label}} ({{count}} ánh xạ)',
  'trackedWorkspace.showEpisodeTechnical': 'Hiện siêu dữ liệu kỹ thuật hồ sơ',
  'trackedWorkspace.hideEpisodeTechnical': 'Ẩn siêu dữ liệu kỹ thuật hồ sơ',
  'trackedWorkspace.episodeId': 'Mã hồ sơ',
  'trackedWorkspace.siteId': 'Mã công trường',
  'trackedWorkspace.cameraId': 'Mã camera',
  'trackedWorkspace.segmentId': 'Mã phân đoạn kỹ thuật (không phải mã Công nhân)',
  'trackedWorkspace.scopeSha256': 'SHA-256 phạm vi',
  'trackedWorkspace.nextPageFailed': 'Tải trang quan sát tiếp theo thất bại.',
};

registerFeatureCatalog({ en, vi });
