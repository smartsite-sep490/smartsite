import { registerFeatureCatalog } from '../../i18n/feature-catalog-registry';

const en = {
  'trackedIdentity.title': 'Manual observation identity record',
  'trackedIdentity.scopeDisclaimer':
    'Manual link for this observation only; it does not grant access.',
  'trackedIdentity.boundaryNoteLabel': 'Boundary & non-inference notice',
  'trackedIdentity.boundaryNoteValue':
    'Applies strictly to this exact original observation (event + PERSON index) — never a verified Face match, Worker profile, team/Contractor/Zone permission, or safety clearance.',
  'trackedIdentity.idlePrompt': 'Manual identity records are not loaded automatically.',
  'trackedIdentity.readAction': 'Read manual identity record',
  'trackedIdentity.collapseAction': 'Hide manual identity record',
  'trackedIdentity.loading': 'Reading manual identity record for this observation…',
  'trackedIdentity.error': 'Could not read manual identity record for this observation.',
  'trackedIdentity.retry': 'Retry identity read',
  'trackedIdentity.forbidden':
    'Manual identity record is unavailable or your role does not have permission to read identity records in this scope.',
  'trackedIdentity.noDecision': 'No manual link recorded for this observation',
  'trackedIdentity.clearedBadge': 'Manual link cleared',
  'trackedIdentity.clearedSummary':
    'Previous manual link was cleared for this exact observation (not a verified Worker) · Rev #{{revision}} · {{recordedAt}}',
  'trackedIdentity.resolvedBadge': 'Manual link (this observation only)',
  'trackedIdentity.resolvedSummary':
    'Manual Worker ID (this observation only): {{workerId}} · Rev #{{revision}} · {{recordedAt}}',
  'trackedIdentity.reasonLabel': 'Reason',
  'trackedIdentity.showTechnical': 'Show identity technical details',
  'trackedIdentity.hideTechnical': 'Hide identity technical details',
  'trackedIdentity.episodeId': 'Episode ID',
  'trackedIdentity.siteId': 'Site ID',
  'trackedIdentity.alertId': 'Finding alert ID',
  'trackedIdentity.eventId': 'Original event ID',
  'trackedIdentity.personIndex': 'PERSON observation index',
  'trackedIdentity.evidenceIndex': 'Evidence frame index',
  'trackedIdentity.payloadHash': 'Payload SHA-256',
  'trackedIdentity.revision': 'Identity revision',
  'trackedIdentity.capturedAt': 'Original captured at',
  'trackedIdentity.cameraId': 'Camera ID',
  'trackedIdentity.cameraExternalId': 'Camera external ID',
  'trackedIdentity.streamSessionId': 'Stream session ID',
  'trackedIdentity.trackId': 'Technical track ID (not Worker ID)',
  'trackedIdentity.boundingBox': 'PERSON bounding box (NORMALIZED_0_1)',
  'trackedIdentity.decisionId': 'Decision ID',
  'trackedIdentity.actorUserId': 'Recorded by actor ID',
  'trackedIdentity.decisionScope': 'Decision scope',
  'trackedIdentity.verificationMethod': 'Verification method',
  'trackedIdentity.evidenceSha256': 'Decision evidence SHA-256',
};

const vi: Record<keyof typeof en, string> = {
  'trackedIdentity.title': 'Bản ghi định danh thủ công của quan sát',
  'trackedIdentity.scopeDisclaimer':
    'Liên kết thủ công chỉ áp dụng cho quan sát này; không cấp quyền ra vào.',
  'trackedIdentity.boundaryNoteLabel': 'Lưu ý ranh giới và không suy diễn',
  'trackedIdentity.boundaryNoteValue':
    'Chỉ áp dụng cho đúng quan sát gốc này (sự kiện + chỉ mục PERSON) — tuyệt đối không phải kết quả khớp khuôn mặt, hồ sơ Công nhân, quyền tổ đội/Nhà thầu/Khu vực hay xác nhận an toàn.',
  'trackedIdentity.idlePrompt': 'Bản ghi định danh thủ công không tự động tải.',
  'trackedIdentity.readAction': 'Đọc bản ghi định danh thủ công',
  'trackedIdentity.collapseAction': 'Ẩn bản ghi định danh thủ công',
  'trackedIdentity.loading': 'Đang đọc bản ghi định danh thủ công cho quan sát này…',
  'trackedIdentity.error': 'Không thể đọc bản ghi định danh thủ công cho quan sát này.',
  'trackedIdentity.retry': 'Thử đọc lại định danh',
  'trackedIdentity.forbidden':
    'Bản ghi định danh thủ công không khả dụng hoặc vai trò của bạn không có quyền đọc bản ghi định danh trong phạm vi này.',
  'trackedIdentity.noDecision': 'Chưa có liên kết thủ công cho quan sát này',
  'trackedIdentity.clearedBadge': 'Đã xóa liên kết thủ công',
  'trackedIdentity.clearedSummary':
    'Liên kết thủ công trước đó đã được xóa cho đúng quan sát này (không phải Công nhân đã xác minh) · Phiên bản #{{revision}} · {{recordedAt}}',
  'trackedIdentity.resolvedBadge': 'Liên kết thủ công (chỉ quan sát này)',
  'trackedIdentity.resolvedSummary':
    'Mã Công nhân thủ công (chỉ quan sát này): {{workerId}} · Phiên bản #{{revision}} · {{recordedAt}}',
  'trackedIdentity.reasonLabel': 'Lý do',
  'trackedIdentity.showTechnical': 'Hiện chi tiết kỹ thuật định danh',
  'trackedIdentity.hideTechnical': 'Ẩn chi tiết kỹ thuật định danh',
  'trackedIdentity.episodeId': 'Mã hồ sơ',
  'trackedIdentity.siteId': 'Mã công trường',
  'trackedIdentity.alertId': 'Mã cảnh báo phát hiện',
  'trackedIdentity.eventId': 'Mã sự kiện gốc',
  'trackedIdentity.personIndex': 'Chỉ mục quan sát PERSON',
  'trackedIdentity.evidenceIndex': 'Chỉ mục khung bằng chứng',
  'trackedIdentity.payloadHash': 'SHA-256 gói dữ liệu',
  'trackedIdentity.revision': 'Phiên bản định danh',
  'trackedIdentity.capturedAt': 'Thời điểm ghi nhận gốc',
  'trackedIdentity.cameraId': 'Mã camera',
  'trackedIdentity.cameraExternalId': 'Mã ngoài camera',
  'trackedIdentity.streamSessionId': 'Mã phiên luồng',
  'trackedIdentity.trackId': 'Mã vệt kỹ thuật (không phải mã Công nhân)',
  'trackedIdentity.boundingBox': 'Khung bao PERSON (NORMALIZED_0_1)',
  'trackedIdentity.decisionId': 'Mã quyết định',
  'trackedIdentity.actorUserId': 'Mã người ghi nhận',
  'trackedIdentity.decisionScope': 'Phạm vi quyết định',
  'trackedIdentity.verificationMethod': 'Phương thức xác minh',
  'trackedIdentity.evidenceSha256': 'SHA-256 bằng chứng quyết định',
};

registerFeatureCatalog({ en, vi });
