import { registerFeatureCatalog } from '../../i18n/feature-catalog-registry';

const en = {
  'cameraSetup.title': 'Camera setup',
  'cameraSetup.intro': 'Site cameras and area PPE policies.',
  'cameraSetup.monitor': 'Open monitoring',
  'cameraSetup.denied': 'You do not have setup access.',
  'cameraSetup.session': 'Sign in to manage configuration.',
  'cameraSetup.site': 'Site',
  'cameraSetup.chooseSite': 'Choose a site',
  'cameraSetup.chooseCamera': 'Choose a camera',
  'cameraSetup.linkedSelection':
    'The linked selection is not in the loaded list. Load more or choose an available item.',
  'cameraSetup.sitesMore': 'Load more sites',
  'cameraSetup.retry': 'Retry',
  'cameraSetup.error': 'Could not load configuration. Please try again.',
  'cameraSetup.forbidden': 'Configuration access is unavailable for this scope.',
  'cameraSetup.noSites': 'No sites available for configuration.',
  'cameraSetup.areas': 'Areas & PPE',
  'cameraSetup.areasHint': 'A camera can observe several areas. Each area has its own PPE policy.',
  'cameraSetup.managerHint': 'The Site Manager defines PPE requirements for each area.',
  'cameraSetup.step1': 'Create site areas and PPE requirements.',
  'cameraSetup.step2': 'Register each camera in configuration.',
  'cameraSetup.step3': 'Link observation regions to areas. Source verification is separate.',
};

const vi: Record<keyof typeof en, string> = {
  'cameraSetup.title': 'Thiết lập camera',
  'cameraSetup.intro': 'Camera và PPE của công trường.',
  'cameraSetup.monitor': 'Mở giám sát',
  'cameraSetup.denied': 'Bạn không có quyền thiết lập.',
  'cameraSetup.session': 'Đăng nhập để quản lý cấu hình.',
  'cameraSetup.site': 'Công trường',
  'cameraSetup.chooseSite': 'Chọn công trường',
  'cameraSetup.chooseCamera': 'Chọn camera',
  'cameraSetup.linkedSelection':
    'Lựa chọn trong liên kết chưa có trong danh sách đã tải. Tải thêm hoặc chọn mục khả dụng.',
  'cameraSetup.sitesMore': 'Tải thêm công trường',
  'cameraSetup.retry': 'Thử lại',
  'cameraSetup.error': 'Không tải được cấu hình. Vui lòng thử lại.',
  'cameraSetup.forbidden': 'Không có quyền truy cập cấu hình trong phạm vi này.',
  'cameraSetup.noSites': 'Chưa có công trường được phép thiết lập.',
  'cameraSetup.areas': 'Khu vực & PPE',
  'cameraSetup.areasHint':
    'Một camera có thể quan sát nhiều khu vực. Mỗi khu vực có chính sách PPE riêng.',
  'cameraSetup.managerHint': 'Quản lý công trường quy định PPE cho từng khu vực.',
  'cameraSetup.step1': 'Tạo khu vực và quy định PPE bắt buộc.',
  'cameraSetup.step2': 'Đăng ký từng camera vào cấu hình.',
  'cameraSetup.step3': 'Gắn vùng quan sát với khu vực. Kiểm tra nguồn kết nối là bước riêng.',
};

registerFeatureCatalog({ en, vi });

export type CameraSetupWorkspaceCopyKey = keyof typeof en;
