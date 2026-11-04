import { registerFeatureCatalog } from '../../i18n/feature-catalog-registry';

const en = {
  'cameraSetup.cameras': 'Cameras',
  'cameraSetup.metadata':
    'Register cameras, manage activation state, and link observation regions per Zone.',
  'cameraSetup.adminHint': 'View configured cameras and observation regions for this Site.',
  'cameraSetup.loading': 'Loading cameras…',
  'cameraSetup.inactiveHint':
    'Disabled in configuration. Open Manage to enable before linking regions.',
  'cameraSetup.selectCameraBtn': 'Select {{code}}',
  'cameraSetup.selectedCameraBtn': 'Selected {{code}}',
  'cameraSetup.monitorPpe': 'PPE monitoring',
  'cameraSetup.monitorZones': 'Zone monitoring',
  'cameraSetup.regionsAction': 'Regions',
  'cameraSetup.manage': 'Manage {{name}}',
  'cameraSetup.manageAction': 'Manage',
  'cameraSetup.noCameras': 'No cameras registered for this Site yet.',
  'cameraSetup.linkedCameraMore':
    'The requested camera is not in the loaded pages yet. Load more cameras to locate it.',
  'cameraSetup.linkedCameraUnavailable': 'The requested camera was not found in this Site catalog.',
  'cameraSetup.partial': 'No cameras shown on this page. Load more cameras to continue.',
  'cameraSetup.count': '{{loaded}} of {{total}} cameras loaded',
  'cameraSetup.camerasMore': 'Load more cameras',
  'cameraSetup.statusLabel': 'Configuration status',
  'cameraSetup.enabled': 'Enabled',
  'cameraSetup.disabled': 'Disabled',
  'cameraSetup.codeLabel': 'Code',
  'cameraSetup.revisionLabel': 'Saved config version',
  'cameraSetup.workflowTitle': 'Camera setup actions',
  'cameraSetup.zones': 'Configure PPE by Zone',
  'cameraSetup.viewZones': 'View Zones',
  'cameraSetup.register': 'Register camera',
  'cameraSetup.help': 'Setup guide',
  'cameraSetup.discardPrompt': 'Discard unsaved camera changes?',
  'cameraSetup.field.code': 'Camera code',
  'cameraSetup.field.name': 'Camera name',
  'cameraSetup.field.externalId': 'Source ID',
};

const vi: Record<keyof typeof en, string> = {
  'cameraSetup.cameras': 'Camera',
  'cameraSetup.metadata':
    'Đăng ký camera, quản lý trạng thái kích hoạt và gắn vùng quan sát theo từng khu vực.',
  'cameraSetup.adminHint': 'Xem danh mục camera và vùng quan sát đã cấu hình cho công trường này.',
  'cameraSetup.loading': 'Đang tải camera…',
  'cameraSetup.inactiveHint':
    'Đang tắt trong cấu hình. Mở Quản lý để bật trước khi gắn vùng quan sát.',
  'cameraSetup.selectCameraBtn': 'Chọn {{code}}',
  'cameraSetup.selectedCameraBtn': 'Đang chọn {{code}}',
  'cameraSetup.monitorPpe': 'Giám sát PPE',
  'cameraSetup.monitorZones': 'Giám sát khu vực',
  'cameraSetup.regionsAction': 'Vùng quan sát',
  'cameraSetup.manage': 'Quản lý {{name}}',
  'cameraSetup.manageAction': 'Quản lý',
  'cameraSetup.noCameras': 'Chưa có camera nào được đăng ký cho công trường này.',
  'cameraSetup.linkedCameraMore':
    'Camera được yêu cầu chưa nằm trong các trang đã tải. Tải thêm camera để tìm.',
  'cameraSetup.linkedCameraUnavailable':
    'Không tìm thấy camera được yêu cầu trong danh mục công trường này.',
  'cameraSetup.partial': 'Chưa có camera trên trang này. Tải thêm camera để tiếp tục.',
  'cameraSetup.count': 'Đã tải {{loaded}} / {{total}} camera',
  'cameraSetup.camerasMore': 'Tải thêm camera',
  'cameraSetup.statusLabel': 'Trạng thái cấu hình',
  'cameraSetup.enabled': 'Đang bật',
  'cameraSetup.disabled': 'Đang tắt',
  'cameraSetup.codeLabel': 'Mã',
  'cameraSetup.revisionLabel': 'Phiên bản cấu hình đã lưu',
  'cameraSetup.workflowTitle': 'Thao tác thiết lập camera',
  'cameraSetup.zones': 'Cấu hình PPE theo Khu vực',
  'cameraSetup.viewZones': 'Xem Khu vực',
  'cameraSetup.register': 'Đăng ký camera',
  'cameraSetup.help': 'Hướng dẫn thiết lập',
  'cameraSetup.discardPrompt': 'Hủy các thay đổi camera chưa lưu?',
  'cameraSetup.field.code': 'Mã camera',
  'cameraSetup.field.name': 'Tên camera',
  'cameraSetup.field.externalId': 'Mã nguồn (Source ID)',
};

registerFeatureCatalog({ en, vi });

export type CameraSetupCatalogCopyKey = keyof typeof en;
