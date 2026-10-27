import { registerFeatureCatalog } from '../../i18n/feature-catalog-registry';

const en = {
  'cameraSetup.appStatus.refresh': 'Refresh status',
  'cameraSetup.appStatus.details': 'Details',
  'cameraSetup.appStatus.checking': 'Checking worker application status…',
  'cameraSetup.appStatus.error': 'Could not verify worker application status.',
  'cameraSetup.appStatus.forbidden': 'Worker application status is unavailable for this scope.',
  'cameraSetup.appStatus.revisions': 'Saved v{{desired}} · Worker reported: {{reported}}',
  'cameraSetup.appStatus.reportedNone': 'none',
  'cameraSetup.appStatus.reportedVersion': 'v{{version}}',
  'cameraSetup.appStatus.state.UNCONFIRMED': 'Worker application unconfirmed',
  'cameraSetup.appStatus.state.PENDING': 'Pending worker application',
  'cameraSetup.appStatus.state.LOADED': 'Worker loaded v{{reported}}',
  'cameraSetup.appStatus.state.REJECTED': 'Worker rejected v{{reported}}',
  'cameraSetup.appStatus.state.STALE': 'Application receipt is old',
  'cameraSetup.appStatus.viewValidity.UNCONFIRMED': 'Physical camera view is unconfirmed.',
  'cameraSetup.appStatus.viewValidity.NEEDS_REVALIDATION': 'Reference view needs revalidation.',
  'cameraSetup.appStatus.viewValidity.UNAVAILABLE': 'Reference view is unavailable.',
  'cameraSetup.appStatus.timestamps': 'Observed: {{observedAt}} · Last receipt: {{lastReceiptAt}}',
  'cameraSetup.appStatus.caveat':
    'Configuration receipt does not prove live stream or model health.',
  'cameraSetup.appStatus.reasonLine': 'Reason: {{reason}} ({{code}})',
  'cameraSetup.appStatus.reason.CAMERA_INACTIVE': 'Camera is disabled in configuration.',
  'cameraSetup.appStatus.reason.NO_WORKER_GENERATION': 'No active worker generation enrolled.',
  'cameraSetup.appStatus.reason.WORKER_GENERATION_STALE':
    'Worker generation expired or was superseded.',
  'cameraSetup.appStatus.reason.VIEW_UNAVAILABLE': 'Current reference view is unavailable.',
  'cameraSetup.appStatus.reason.CONFIGURATION_NOT_ISSUED':
    'Configuration bundle is not issued yet.',
  'cameraSetup.appStatus.reason.NO_APPLICATION_RECEIPT': 'No worker receipt recorded yet.',
  'cameraSetup.appStatus.reason.RECEIPT_CONTEXT_STALE':
    'Historical worker claim belongs to an older session or reference view.',
  'cameraSetup.appStatus.reason.APPLICATION_RECEIPT_STALE':
    'Historical worker claim / old receipt past 60s window; does not mean camera is offline.',
  'cameraSetup.appStatus.reason.DESIRED_CONFIGURATION_PENDING':
    'Worker receipt is for an earlier saved revision.',
  'cameraSetup.appStatus.reason.OTHER': 'Worker reported reason code.',
};

const vi: Record<keyof typeof en, string> = {
  'cameraSetup.appStatus.refresh': 'Làm mới trạng thái',
  'cameraSetup.appStatus.details': 'Chi tiết',
  'cameraSetup.appStatus.checking': 'Đang kiểm tra trạng thái áp dụng của worker…',
  'cameraSetup.appStatus.error': 'Không kiểm tra được trạng thái áp dụng của worker.',
  'cameraSetup.appStatus.forbidden':
    'Trạng thái áp dụng của worker không khả dụng trong phạm vi này.',
  'cameraSetup.appStatus.revisions': 'Đã lưu v{{desired}} · Worker báo cáo: {{reported}}',
  'cameraSetup.appStatus.reportedNone': 'chưa có',
  'cameraSetup.appStatus.reportedVersion': 'v{{version}}',
  'cameraSetup.appStatus.state.UNCONFIRMED': 'Chưa xác nhận áp dụng',
  'cameraSetup.appStatus.state.PENDING': 'Đang chờ áp dụng',
  'cameraSetup.appStatus.state.LOADED': 'Worker đã nạp v{{reported}}',
  'cameraSetup.appStatus.state.REJECTED': 'Worker từ chối v{{reported}}',
  'cameraSetup.appStatus.state.STALE': 'Biên nhận áp dụng đã cũ',
  'cameraSetup.appStatus.viewValidity.UNCONFIRMED': 'Góc nhìn vật lý chưa được xác nhận.',
  'cameraSetup.appStatus.viewValidity.NEEDS_REVALIDATION': 'Khung tham chiếu cần xác nhận lại.',
  'cameraSetup.appStatus.viewValidity.UNAVAILABLE': 'Chưa có khung tham chiếu.',
  'cameraSetup.appStatus.timestamps':
    'Ghi nhận: {{observedAt}} · Biên nhận gần nhất: {{lastReceiptAt}}',
  'cameraSetup.appStatus.caveat':
    'Biên nhận cấu hình không chứng minh luồng trực tiếp hay độ chính xác mô hình.',
  'cameraSetup.appStatus.reasonLine': 'Lý do: {{reason}} ({{code}})',
  'cameraSetup.appStatus.reason.CAMERA_INACTIVE': 'Camera đang tắt trong cấu hình.',
  'cameraSetup.appStatus.reason.NO_WORKER_GENERATION': 'Chưa có thế hệ worker đang hoạt động.',
  'cameraSetup.appStatus.reason.WORKER_GENERATION_STALE':
    'Thế hệ worker đã hết hạn hoặc bị thay thế.',
  'cameraSetup.appStatus.reason.VIEW_UNAVAILABLE': 'Chưa có khung tham chiếu hiện tại.',
  'cameraSetup.appStatus.reason.CONFIGURATION_NOT_ISSUED': 'Chưa phát hành gói cấu hình.',
  'cameraSetup.appStatus.reason.NO_APPLICATION_RECEIPT': 'Chưa có biên nhận từ worker.',
  'cameraSetup.appStatus.reason.RECEIPT_CONTEXT_STALE':
    'Ghi nhận lịch sử từ worker thuộc phiên hoặc khung tham chiếu cũ.',
  'cameraSetup.appStatus.reason.APPLICATION_RECEIPT_STALE':
    'Ghi nhận lịch sử từ worker / biên nhận cũ quá 60 giây; không đồng nghĩa camera mất kết nối.',
  'cameraSetup.appStatus.reason.DESIRED_CONFIGURATION_PENDING':
    'Biên nhận của worker thuộc phiên bản đã lưu trước đó.',
  'cameraSetup.appStatus.reason.OTHER': 'Worker báo cáo mã lý do.',
};

registerFeatureCatalog({ en, vi });

export type CameraApplicationStatusCopyKey = keyof typeof en;

export const KNOWN_APPLICATION_STATUS_REASON_KEYS: Record<string, CameraApplicationStatusCopyKey> =
  {
    CAMERA_INACTIVE: 'cameraSetup.appStatus.reason.CAMERA_INACTIVE',
    NO_WORKER_GENERATION: 'cameraSetup.appStatus.reason.NO_WORKER_GENERATION',
    WORKER_GENERATION_STALE: 'cameraSetup.appStatus.reason.WORKER_GENERATION_STALE',
    VIEW_UNAVAILABLE: 'cameraSetup.appStatus.reason.VIEW_UNAVAILABLE',
    CONFIGURATION_NOT_ISSUED: 'cameraSetup.appStatus.reason.CONFIGURATION_NOT_ISSUED',
    NO_APPLICATION_RECEIPT: 'cameraSetup.appStatus.reason.NO_APPLICATION_RECEIPT',
    RECEIPT_CONTEXT_STALE: 'cameraSetup.appStatus.reason.RECEIPT_CONTEXT_STALE',
    APPLICATION_RECEIPT_STALE: 'cameraSetup.appStatus.reason.APPLICATION_RECEIPT_STALE',
    DESIRED_CONFIGURATION_PENDING: 'cameraSetup.appStatus.reason.DESIRED_CONFIGURATION_PENDING',
  };
