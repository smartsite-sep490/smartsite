import { registerFeatureCatalog } from '../../i18n/feature-catalog-registry';

const en = {
  'cameraSetup.revisionLabel': 'Saved config version',
  'cameraSetup.savedConfigVersionStatus':
    'Saved config version v{{version}}; worker application status unavailable.',
  'cameraSetup.appStatus.refresh': 'Refresh status',
  'cameraSetup.appStatus.details': 'Technical details',
  'cameraSetup.appStatus.checking': 'Checking whether AI has received the saved configuration…',
  'cameraSetup.appStatus.error': 'Could not confirm whether AI has received the configuration.',
  'cameraSetup.appStatus.forbidden': 'AI application status is unavailable for this scope.',
  'cameraSetup.appStatus.unavailablePrimary': 'Saved · Unable to confirm',
  'cameraSetup.appStatus.savedOnlyVersion': 'Saved version: v{{version}}',
  'cameraSetup.appStatus.revisions': 'Saved version: v{{desired}} · AI reported: {{reported}}',
  'cameraSetup.appStatus.reportedNone': 'none',
  'cameraSetup.appStatus.reportedVersion': 'v{{version}}',
  'cameraSetup.appStatus.state.UNCONFIRMED': 'Saved · Unable to confirm',
  'cameraSetup.appStatus.state.PENDING': 'Saved · Waiting for AI application',
  'cameraSetup.appStatus.state.LOADED': 'AI has received the configuration',
  'cameraSetup.appStatus.state.REJECTED': 'Saved · AI could not apply configuration',
  'cameraSetup.appStatus.state.STALE': 'Saved · Unable to confirm',
  'cameraSetup.appStatus.viewValidity.UNCONFIRMED': 'Needs camera angle review',
  'cameraSetup.appStatus.viewValidity.NEEDS_REVALIDATION': 'Needs camera angle review',
  'cameraSetup.appStatus.viewValidity.UNAVAILABLE': 'Camera angle reference unavailable',
  'cameraSetup.appStatus.timestamps': 'Observed: {{observedAt}} · Last receipt: {{lastReceiptAt}}',
  'cameraSetup.appStatus.reasonCodeLine': 'Reason code: {{code}}',
  'cameraSetup.appStatus.caveat':
    'Configuration receipt does not prove live video or model accuracy.',
  'cameraSetup.appStatus.reasonLine': 'Reason: {{reason}}',
  'cameraSetup.appStatus.reason.CAMERA_INACTIVE': 'Camera is disabled in configuration.',
  'cameraSetup.appStatus.reason.NO_WORKER_GENERATION':
    'No active AI session is connected for this camera.',
  'cameraSetup.appStatus.reason.WORKER_GENERATION_STALE':
    'Previous AI session expired or was replaced.',
  'cameraSetup.appStatus.reason.VIEW_UNAVAILABLE': 'Current reference view is unavailable.',
  'cameraSetup.appStatus.reason.CONFIGURATION_NOT_ISSUED':
    'Configuration package is not ready to send to AI yet.',
  'cameraSetup.appStatus.reason.NO_APPLICATION_RECEIPT': 'AI has not confirmed the settings yet.',
  'cameraSetup.appStatus.reason.RECEIPT_CONTEXT_STALE':
    'Previous AI confirmation belongs to an older session or camera angle.',
  'cameraSetup.appStatus.reason.APPLICATION_RECEIPT_STALE':
    'Latest AI confirmation is over 60 seconds old; this does not mean the camera is offline.',
  'cameraSetup.appStatus.reason.DESIRED_CONFIGURATION_PENDING':
    'AI is still using an earlier saved configuration.',
  'cameraSetup.appStatus.reason.OTHER': 'AI reported an application issue.',
  'cameraSetup.appStatus.action.CAMERA_INACTIVE':
    'Next step: enable this camera in configuration before AI can apply it.',
  'cameraSetup.appStatus.action.NO_WORKER_GENERATION':
    'Next step: verify the AI device is connected and running for this camera source, then refresh status.',
  'cameraSetup.appStatus.action.WORKER_GENERATION_STALE':
    'Next step: check AI device status or restart the camera session, then refresh status.',
  'cameraSetup.appStatus.action.VIEW_UNAVAILABLE':
    'Next step: check camera capture availability and load a fresh configuration image in Regions.',
  'cameraSetup.appStatus.action.CONFIGURATION_NOT_ISSUED':
    'Next step: complete active region and PPE configuration, then refresh status.',
  'cameraSetup.appStatus.action.NO_APPLICATION_RECEIPT':
    'Next step: wait a moment and click Refresh status to confirm AI has received the settings.',
  'cameraSetup.appStatus.action.RECEIPT_CONTEXT_STALE':
    'Next step: review the camera angle reference image or wait for a fresh AI confirmation.',
  'cameraSetup.appStatus.action.APPLICATION_RECEIPT_STALE':
    'Next step: click Refresh status to check for a newer AI confirmation (live video is checked separately).',
  'cameraSetup.appStatus.action.DESIRED_CONFIGURATION_PENDING':
    'Next step: your saved settings are newer than what AI last confirmed; apply or refresh status shortly.',
  'cameraSetup.appStatus.action.REJECTED_DEFAULT':
    'Next step: review camera source, active region geometry, and PPE policy before saving again.',
  'cameraSetup.appStatus.action.OTHER':
    'Next step: check the camera source and AI device status, then refresh status.',
};

const vi: Record<keyof typeof en, string> = {
  'cameraSetup.revisionLabel': 'Phiên bản cấu hình đã lưu',
  'cameraSetup.savedConfigVersionStatus':
    'Phiên bản cấu hình đã lưu v{{version}}; chưa có trạng thái áp dụng của worker.',
  'cameraSetup.appStatus.refresh': 'Làm mới trạng thái',
  'cameraSetup.appStatus.details': 'Chi tiết kỹ thuật',
  'cameraSetup.appStatus.checking': 'Đang kiểm tra máy AI đã nhận cấu hình chưa…',
  'cameraSetup.appStatus.error': 'Chưa xác nhận được máy AI đã nhận cấu hình hay chưa.',
  'cameraSetup.appStatus.forbidden':
    'Trạng thái áp dụng của máy AI không khả dụng trong phạm vi này.',
  'cameraSetup.appStatus.unavailablePrimary': 'Đã lưu · Chưa xác nhận được',
  'cameraSetup.appStatus.savedOnlyVersion': 'Phiên bản đã lưu: v{{version}}',
  'cameraSetup.appStatus.revisions':
    'Phiên bản đã lưu: v{{desired}} · Máy AI báo cáo: {{reported}}',
  'cameraSetup.appStatus.reportedNone': 'chưa có',
  'cameraSetup.appStatus.reportedVersion': 'v{{version}}',
  'cameraSetup.appStatus.state.UNCONFIRMED': 'Đã lưu · Chưa xác nhận được',
  'cameraSetup.appStatus.state.PENDING': 'Đã lưu · Chờ máy AI áp dụng',
  'cameraSetup.appStatus.state.LOADED': 'Máy AI đã nhận cấu hình',
  'cameraSetup.appStatus.state.REJECTED': 'Đã lưu · Máy AI không áp dụng được cấu hình',
  'cameraSetup.appStatus.state.STALE': 'Đã lưu · Chưa xác nhận được',
  'cameraSetup.appStatus.viewValidity.UNCONFIRMED': 'Cần kiểm tra góc camera',
  'cameraSetup.appStatus.viewValidity.NEEDS_REVALIDATION': 'Cần kiểm tra lại góc camera',
  'cameraSetup.appStatus.viewValidity.UNAVAILABLE': 'Chưa có ảnh góc nhìn camera',
  'cameraSetup.appStatus.timestamps':
    'Ghi nhận: {{observedAt}} · Xác nhận gần nhất: {{lastReceiptAt}}',
  'cameraSetup.appStatus.reasonCodeLine': 'Mã lý do: {{code}}',
  'cameraSetup.appStatus.caveat':
    'Xác nhận cấu hình không chứng minh video trực tiếp hay độ chính xác mô hình.',
  'cameraSetup.appStatus.reasonLine': 'Lý do: {{reason}}',
  'cameraSetup.appStatus.reason.CAMERA_INACTIVE': 'Camera đang tắt trong cấu hình.',
  'cameraSetup.appStatus.reason.NO_WORKER_GENERATION':
    'Chưa có phiên máy AI đang hoạt động cho camera này.',
  'cameraSetup.appStatus.reason.WORKER_GENERATION_STALE':
    'Phiên máy AI trước đó đã hết hạn hoặc bị thay thế.',
  'cameraSetup.appStatus.reason.VIEW_UNAVAILABLE': 'Chưa có khung tham chiếu hiện tại.',
  'cameraSetup.appStatus.reason.CONFIGURATION_NOT_ISSUED':
    'Cấu hình chưa sẵn sàng gửi xuống máy AI.',
  'cameraSetup.appStatus.reason.NO_APPLICATION_RECEIPT':
    'Máy AI chưa gửi xác nhận đã nhận cấu hình.',
  'cameraSetup.appStatus.reason.RECEIPT_CONTEXT_STALE':
    'Xác nhận trước đó của máy AI thuộc phiên hoặc góc nhìn cũ.',
  'cameraSetup.appStatus.reason.APPLICATION_RECEIPT_STALE':
    'Xác nhận gần nhất từ máy AI đã cũ quá 60 giây; không đồng nghĩa camera mất kết nối.',
  'cameraSetup.appStatus.reason.DESIRED_CONFIGURATION_PENDING':
    'Máy AI vẫn đang dùng bản cấu hình đã lưu trước đó.',
  'cameraSetup.appStatus.reason.OTHER': 'Máy AI báo lỗi khi áp dụng cấu hình.',
  'cameraSetup.appStatus.action.CAMERA_INACTIVE':
    'Bước tiếp theo: bật camera trong cấu hình trước khi máy AI có thể áp dụng.',
  'cameraSetup.appStatus.action.NO_WORKER_GENERATION':
    'Bước tiếp theo: kiểm tra máy AI đã kết nối và đang chạy cho nguồn camera này, rồi làm mới trạng thái.',
  'cameraSetup.appStatus.action.WORKER_GENERATION_STALE':
    'Bước tiếp theo: kiểm tra tình trạng máy AI hoặc khởi động lại phiên camera, sau đó làm mới trạng thái.',
  'cameraSetup.appStatus.action.VIEW_UNAVAILABLE':
    'Bước tiếp theo: kiểm tra nguồn thu hình camera và lấy ảnh cấu hình mới trong mục Vùng quan sát.',
  'cameraSetup.appStatus.action.CONFIGURATION_NOT_ISSUED':
    'Bước tiếp theo: hoàn tất vùng quan sát đang bật và chính sách PPE, rồi làm mới trạng thái.',
  'cameraSetup.appStatus.action.NO_APPLICATION_RECEIPT':
    'Bước tiếp theo: chờ một chút rồi nhấn Làm mới trạng thái để kiểm tra xác nhận từ máy AI.',
  'cameraSetup.appStatus.action.RECEIPT_CONTEXT_STALE':
    'Bước tiếp theo: kiểm tra lại ảnh góc nhìn tham chiếu hoặc chờ xác nhận mới từ máy AI.',
  'cameraSetup.appStatus.action.APPLICATION_RECEIPT_STALE':
    'Bước tiếp theo: nhấn Làm mới trạng thái để kiểm tra xác nhận mới hơn từ máy AI (video trực tiếp được kiểm tra riêng).',
  'cameraSetup.appStatus.action.DESIRED_CONFIGURATION_PENDING':
    'Bước tiếp theo: cấu hình bạn vừa lưu mới hơn bản máy AI xác nhận lần cuối; hãy áp dụng hoặc làm mới trạng thái sau ít giây.',
  'cameraSetup.appStatus.action.REJECTED_DEFAULT':
    'Bước tiếp theo: rà lại nguồn camera, đa giác vùng quan sát và chính sách PPE trước khi lưu lại.',
  'cameraSetup.appStatus.action.OTHER':
    'Bước tiếp theo: kiểm tra nguồn camera và trạng thái máy AI, sau đó làm mới trạng thái.',
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
