import { registerFeatureCatalog } from '../../i18n/feature-catalog-registry';

const en = {
  'cameraSetup.revisionLabel': 'Saved config version',
  'cameraSetup.savedConfigVersionStatus':
    'Saved config version v{{version}}; worker application status unavailable.',
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
  'cameraSetup.appStatus.action.CAMERA_INACTIVE':
    'Next step: enable this camera in configuration before the edge worker can apply it.',
  'cameraSetup.appStatus.action.NO_WORKER_GENERATION':
    'Next step: verify the edge worker is enrolled and running for this camera source, then refresh status.',
  'cameraSetup.appStatus.action.WORKER_GENERATION_STALE':
    'Next step: check edge worker health or restart the worker session, then refresh status.',
  'cameraSetup.appStatus.action.VIEW_UNAVAILABLE':
    'Next step: check camera capture availability and load a fresh configuration image in Regions.',
  'cameraSetup.appStatus.action.CONFIGURATION_NOT_ISSUED':
    'Next step: complete active region and PPE configuration, then refresh status once issued.',
  'cameraSetup.appStatus.action.NO_APPLICATION_RECEIPT':
    'Next step: wait for the next edge worker poll cycle and refresh status to confirm ACK.',
  'cameraSetup.appStatus.action.RECEIPT_CONTEXT_STALE':
    'Next step: revalidate the camera reference view or wait for a fresh worker session receipt.',
  'cameraSetup.appStatus.action.APPLICATION_RECEIPT_STALE':
    'Next step: refresh status to check for a newer worker ACK (live video is checked separately).',
  'cameraSetup.appStatus.action.DESIRED_CONFIGURATION_PENDING':
    'Next step: saved configuration is ahead of the worker; refresh status after the worker polls the new revision.',
  'cameraSetup.appStatus.action.REJECTED_DEFAULT':
    'Next step: review camera source, active region geometry, and PPE policy before saving a new revision.',
  'cameraSetup.appStatus.action.OTHER':
    'Next step: inspect camera source and worker logs, then refresh status.',
};

const vi: Record<keyof typeof en, string> = {
  'cameraSetup.revisionLabel': 'Phiên bản cấu hình đã lưu',
  'cameraSetup.savedConfigVersionStatus':
    'Phiên bản cấu hình đã lưu v{{version}}; chưa có trạng thái áp dụng của worker.',
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
  'cameraSetup.appStatus.action.CAMERA_INACTIVE':
    'Bước tiếp theo: bật camera trong cấu hình trước khi worker có thể áp dụng.',
  'cameraSetup.appStatus.action.NO_WORKER_GENERATION':
    'Bước tiếp theo: kiểm tra tiến trình edge worker đã đăng ký cho nguồn camera này rồi làm mới trạng thái.',
  'cameraSetup.appStatus.action.WORKER_GENERATION_STALE':
    'Bước tiếp theo: kiểm tra tình trạng hoặc khởi động lại phiên edge worker, sau đó làm mới trạng thái.',
  'cameraSetup.appStatus.action.VIEW_UNAVAILABLE':
    'Bước tiếp theo: kiểm tra nguồn thu hình camera và lấy ảnh cấu hình mới trong mục Vùng quan sát.',
  'cameraSetup.appStatus.action.CONFIGURATION_NOT_ISSUED':
    'Bước tiếp theo: hoàn tất vùng quan sát đang bật và chính sách PPE, rồi làm mới khi gói cấu hình được phát hành.',
  'cameraSetup.appStatus.action.NO_APPLICATION_RECEIPT':
    'Bước tiếp theo: chờ chu kỳ đồng bộ tiếp theo của edge worker và nhấn Làm mới trạng thái để xác nhận ACK.',
  'cameraSetup.appStatus.action.RECEIPT_CONTEXT_STALE':
    'Bước tiếp theo: xác nhận lại khung tham chiếu camera hoặc chờ biên nhận từ phiên worker mới.',
  'cameraSetup.appStatus.action.APPLICATION_RECEIPT_STALE':
    'Bước tiếp theo: nhấn Làm mới trạng thái để kiểm tra ACK mới hơn từ worker (luồng video trực tiếp được kiểm tra riêng).',
  'cameraSetup.appStatus.action.DESIRED_CONFIGURATION_PENDING':
    'Bước tiếp theo: bản đã lưu mới hơn bản trên worker; hãy làm mới trạng thái sau khi worker nạp phiên bản mới.',
  'cameraSetup.appStatus.action.REJECTED_DEFAULT':
    'Bước tiếp theo: rà lại mã nguồn camera, đa giác vùng quan sát và chính sách PPE trước khi lưu phiên bản mới.',
  'cameraSetup.appStatus.action.OTHER':
    'Bước tiếp theo: kiểm tra nguồn camera và nhật ký worker, sau đó làm mới trạng thái.',
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

export const KNOWN_APPLICATION_STATUS_ACTION_KEYS: Record<string, CameraApplicationStatusCopyKey> =
  {
    CAMERA_INACTIVE: 'cameraSetup.appStatus.action.CAMERA_INACTIVE',
    NO_WORKER_GENERATION: 'cameraSetup.appStatus.action.NO_WORKER_GENERATION',
    WORKER_GENERATION_STALE: 'cameraSetup.appStatus.action.WORKER_GENERATION_STALE',
    VIEW_UNAVAILABLE: 'cameraSetup.appStatus.action.VIEW_UNAVAILABLE',
    CONFIGURATION_NOT_ISSUED: 'cameraSetup.appStatus.action.CONFIGURATION_NOT_ISSUED',
    NO_APPLICATION_RECEIPT: 'cameraSetup.appStatus.action.NO_APPLICATION_RECEIPT',
    RECEIPT_CONTEXT_STALE: 'cameraSetup.appStatus.action.RECEIPT_CONTEXT_STALE',
    APPLICATION_RECEIPT_STALE: 'cameraSetup.appStatus.action.APPLICATION_RECEIPT_STALE',
    DESIRED_CONFIGURATION_PENDING: 'cameraSetup.appStatus.action.DESIRED_CONFIGURATION_PENDING',
  };
