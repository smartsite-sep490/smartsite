import { registerFeatureCatalog } from '../../i18n/feature-catalog-registry';

const en = {
  'trackedViewer.titleFrame': 'Original observation — Full frame',
  'trackedViewer.titleSubject': 'Original observation — Mechanical PERSON crop',
  'trackedViewer.badgeFrame': 'Full FRAME',
  'trackedViewer.badgeSubject': 'Mechanical PERSON crop',
  'trackedViewer.cropDisclaimer':
    'Mechanical PERSON crop shows the original detector bounding box only and is never a verified Worker identity.',
  'trackedViewer.altFrame': 'Full observation frame evidence image',
  'trackedViewer.altSubject': 'Mechanical original PERSON bounding-box crop evidence image',
  'trackedViewer.loading': 'Loading evidence image…',
  'trackedViewer.preparing': 'Preparing verified JPEG image…',
  'trackedViewer.error': 'Could not load the requested evidence image. Please try again.',
  'trackedViewer.forbidden':
    'You do not have permission to view this evidence image in the current scope.',
  'trackedViewer.unavailable': 'Verified JPEG evidence is unavailable for the current selection.',
  'trackedViewer.decodeError': 'The evidence image could not be decoded for display. Please retry.',
  'trackedViewer.retry': 'Retry',
  'trackedViewer.close': 'Close viewer',
  'trackedViewer.showTechnical': 'Show technical details',
  'trackedViewer.hideTechnical': 'Hide technical details',
  'trackedViewer.scopeKey': 'Scope key',
  'trackedViewer.selectionKey': 'Selection key',
  'trackedViewer.representation': 'Representation',
  'trackedViewer.byteSize': 'JPEG size (bytes)',
};

const vi: Record<keyof typeof en, string> = {
  'trackedViewer.titleFrame': 'Quan sát gốc — Toàn khung hình',
  'trackedViewer.titleSubject': 'Quan sát gốc — Ảnh cắt PERSON cơ học',
  'trackedViewer.badgeFrame': 'Toàn khung FRAME',
  'trackedViewer.badgeSubject': 'Ảnh cắt PERSON cơ học',
  'trackedViewer.cropDisclaimer':
    'Ảnh cắt PERSON cơ học chỉ hiển thị khung phát hiện gốc, tuyệt đối không phải danh tính Công nhân đã xác minh.',
  'trackedViewer.altFrame': 'Ảnh bằng chứng toàn khung hình quan sát',
  'trackedViewer.altSubject': 'Ảnh bằng chứng cắt cơ học khung PERSON gốc',
  'trackedViewer.loading': 'Đang tải ảnh bằng chứng…',
  'trackedViewer.preparing': 'Đang chuẩn bị ảnh JPEG đã kiểm tra…',
  'trackedViewer.error': 'Không thể tải ảnh bằng chứng đã yêu cầu. Vui lòng thử lại.',
  'trackedViewer.forbidden': 'Bạn không có quyền xem ảnh bằng chứng này trong phạm vi hiện tại.',
  'trackedViewer.unavailable': 'Ảnh bằng chứng JPEG hợp lệ hiện không khả dụng cho lựa chọn này.',
  'trackedViewer.decodeError': 'Không thể giải mã ảnh bằng chứng để hiển thị. Vui lòng thử lại.',
  'trackedViewer.retry': 'Thử lại',
  'trackedViewer.close': 'Đóng trình xem',
  'trackedViewer.showTechnical': 'Hiện chi tiết kỹ thuật',
  'trackedViewer.hideTechnical': 'Ẩn chi tiết kỹ thuật',
  'trackedViewer.scopeKey': 'Khóa phạm vi',
  'trackedViewer.selectionKey': 'Khóa lựa chọn',
  'trackedViewer.representation': 'Chế độ hiển thị',
  'trackedViewer.byteSize': 'Kích thước JPEG (byte)',
};

registerFeatureCatalog({ en, vi });
