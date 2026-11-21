import type { Mf06AssessmentResponse } from '@smartsite/contracts';
import {
  hasRegisteredFeatureKey,
  registerFeatureCatalog,
} from '../../i18n/feature-catalog-registry';

export type Mf06ZoneReasonKey = `frameInbox.zoneReason.${Mf06AssessmentResponse['reasonCode']}`;

const ZONE_REASON_EN: Record<Mf06ZoneReasonKey, string> = {
  'frameInbox.zoneReason.IDENTITY_UNAVAILABLE': 'Identity unverified (not a confirmed violation)',
  'frameInbox.zoneReason.AUTHORITY_UNAVAILABLE': 'Authorization service unavailable',
  'frameInbox.zoneReason.MEDIA_UNAVAILABLE': 'Observation media unavailable for check',
  'frameInbox.zoneReason.INVALID_BINDING': 'Observation context binding incomplete',
  'frameInbox.zoneReason.PROFILE_REVOKED': 'Biometric profile revoked (unverified)',
  'frameInbox.zoneReason.SERVICE_DISABLED': 'Zone assessment service disabled',
  'frameInbox.zoneReason.ABORTED': 'Zone check aborted before completion',
  'frameInbox.zoneReason.POLICY_PROHIBITED': 'Entry prohibited by zone policy',
  'frameInbox.zoneReason.UNAUTHORIZED': 'No active zone authorization recorded',
  'frameInbox.zoneReason.AUTHORIZED': 'Authorized for zone',
  'frameInbox.zoneReason.POLICY_NONE': 'No zone restriction active',
};

const ZONE_REASON_VI: Record<Mf06ZoneReasonKey, string> = {
  'frameInbox.zoneReason.IDENTITY_UNAVAILABLE':
    'Chưa xác minh được danh tính (chưa kết luận vi phạm)',
  'frameInbox.zoneReason.AUTHORITY_UNAVAILABLE':
    'Dịch vụ kiểm tra phân quyền tạm thời không khả dụng',
  'frameInbox.zoneReason.MEDIA_UNAVAILABLE': 'Thiếu ảnh quan sát để kiểm tra phân quyền',
  'frameInbox.zoneReason.INVALID_BINDING': 'Liên kết ngữ cảnh quan sát không hợp lệ',
  'frameInbox.zoneReason.PROFILE_REVOKED': 'Hồ sơ sinh trắc đã thu hồi (chưa xác minh)',
  'frameInbox.zoneReason.SERVICE_DISABLED': 'Dịch vụ đánh giá vùng đang tắt',
  'frameInbox.zoneReason.ABORTED': 'Phiên kiểm tra vùng bị hủy trước khi hoàn tất',
  'frameInbox.zoneReason.POLICY_PROHIBITED': 'Khu vực cấm vào theo chính sách vùng',
  'frameInbox.zoneReason.UNAUTHORIZED': 'Không có quyền vào vùng hạn chế tại thời điểm ghi nhận',
  'frameInbox.zoneReason.AUTHORIZED': 'Được cấp quyền vào vùng',
  'frameInbox.zoneReason.POLICY_NONE': 'Không áp dụng hạn chế vùng',
};

const en = {
  'frameInbox.scopeCountNote':
    'Counts reflect people with recorded checks in this frame only (flagged cases, not current live person count or total scene headcount).',
  'frameInbox.identityUnconfirmedBadge': 'Identity: Unconfirmed',
  'frameInbox.subjectFindingsError': 'Could not load PPE findings for this person.',
  'frameInbox.markCaseRead': 'Mark case as read',
  'frameInbox.caseReviewHint': 'Open case to review saved evidence and findings',
  'frameInbox.caseIdentificationHint':
    'Open case to review saved evidence and findings (or request Site Manager identification when enabled)',
  ...ZONE_REASON_EN,
  'episodes.requestIdentificationAction': 'Request identification',
  'episodes.identificationUnavailableHint':
    'Identification workflow is not yet enabled for this site.',
  'episodes.identificationWorkspaceIntro': 'Coordinate identification for safety cases.',
  'episodes.identificationWorkspaceNav': 'Identification requests',
  'episodes.identificationWorkspaceLoading': 'Loading identification requests…',
  'episodes.identificationBackToEpisode': 'Back to episode record',
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
  'trackedWorkspace.findingReviewsLabel': 'Finding review actions',
  'trackedWorkspace.cameraPpeScope': 'Camera PPE policy',
  'trackedWorkspace.zonePpeScope': 'Zone PPE policy',
  'trackedWorkspace.reviewFindingAction': 'Review finding',
  'trackedWorkspace.findingAlertRevision': 'Alert rev #{{revision}}',
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
  'frameInbox.scopeCountNote':
    'Số lượng hiển thị chỉ tính các trường hợp cần kiểm tra trong khung hình này (số ca được gắn cờ, không phải số người trực tiếp hiện tại hay tổng quân số tại hiện trường).',
  'frameInbox.identityUnconfirmedBadge': 'Danh tính: Chưa xác nhận',
  'frameInbox.subjectFindingsError': 'Không tải được phát hiện PPE của người này.',
  'frameInbox.markCaseRead': 'Đánh dấu ca đã đọc',
  'frameInbox.caseReviewHint': 'Mở hồ sơ để xem bằng chứng và phát hiện đã lưu',
  'frameInbox.caseIdentificationHint':
    'Mở hồ sơ để xem bằng chứng và phát hiện đã lưu (hoặc gửi yêu cầu Quản lý xác minh khi tính năng bật)',
  ...ZONE_REASON_VI,
  'episodes.requestIdentificationAction': 'Yêu cầu xác minh người',
  'episodes.identificationUnavailableHint':
    'Luồng xác minh danh tính hiện chưa được kích hoạt tại công trường này.',
  'episodes.identificationWorkspaceIntro': 'Phối hợp xác minh người trong hồ sơ an toàn.',
  'episodes.identificationWorkspaceNav': 'Yêu cầu xác minh',
  'episodes.identificationWorkspaceLoading': 'Đang tải yêu cầu xác minh…',
  'episodes.identificationBackToEpisode': 'Quay lại hồ sơ người',
  'trackedWorkspace.title': 'Bằng chứng hồ sơ theo dõi liên tiếp',
  'trackedWorkspace.subtitle':
    'Chuỗi hình ảnh JPEG gốc và các lần ghi nhận của cùng một lượt theo dõi camera. Mã phân đoạn kỹ thuật chỉ phục vụ gom nhóm hình ảnh, không xác định danh tính công nhân hay tổ đội.',
  'trackedWorkspace.loadingDetail': 'Đang tải hồ sơ theo dõi…',
  'trackedWorkspace.errorDetail': 'Không tải được thông tin hồ sơ theo dõi. Vui lòng thử lại.',
  'trackedWorkspace.forbiddenDetail':
    'Bạn không có quyền xem hồ sơ theo dõi này trong phạm vi hiện tại.',
  'trackedWorkspace.retryDetail': 'Thử tải lại hồ sơ',
  'trackedWorkspace.stateCollecting': 'Đang thu thập',
  'trackedWorkspace.stateSealed': 'Đã niêm phong',
  'trackedWorkspace.revisionBadge': 'Phiên bản #{{revision}}',
  'trackedWorkspace.captureRange': 'Khoảng thời gian ghi nhận',
  'trackedWorkspace.findingFilterLabel': 'Lọc quan sát theo phát hiện',
  'trackedWorkspace.allFindings': 'Tất cả phát hiện ({{count}})',
  'trackedWorkspace.findingOption': '{{label}} ({{count}} lần ghi nhận)',
  'trackedWorkspace.findingReviewsLabel': 'Thao tác duyệt từng phát hiện',
  'trackedWorkspace.cameraPpeScope': 'Quy định PPE của camera',
  'trackedWorkspace.zonePpeScope': 'Quy định PPE theo vùng',
  'trackedWorkspace.reviewFindingAction': 'Duyệt phát hiện',
  'trackedWorkspace.findingAlertRevision': 'Bản cảnh báo #{{revision}}',
  'trackedWorkspace.showEpisodeTechnical': 'Xem mã kỹ thuật của hồ sơ',
  'trackedWorkspace.hideEpisodeTechnical': 'Ẩn mã kỹ thuật của hồ sơ',
  'trackedWorkspace.episodeId': 'Mã hồ sơ',
  'trackedWorkspace.siteId': 'Mã công trường',
  'trackedWorkspace.cameraId': 'Mã camera',
  'trackedWorkspace.segmentId': 'Mã phân đoạn kỹ thuật (không phải mã Công nhân)',
  'trackedWorkspace.scopeSha256': 'SHA-256 phạm vi',
  'trackedWorkspace.nextPageFailed': 'Không tải được trang ghi nhận tiếp theo. Vui lòng thử lại.',
};

if (!hasRegisteredFeatureKey('trackedWorkspace.title')) {
  registerFeatureCatalog({ en, vi });
}
