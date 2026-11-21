import { registerFeatureCatalog } from '../../i18n/feature-catalog-registry';
import type { RegionReferenceValidationErrorKey } from './cameraRegionReferenceUtils';
import type { RegionPolygonValidationKey } from './region-polygon-geometry';

const REGION_POLYGON_DRAWER_EN = {
  'regionSetup.validation.alreadySaved': 'This polygon draft has already been saved.',
  'regionSetup.error.referenceExpired':
    'Configuration reference image has expired. Review and accept a new reference image before saving.',
  'regionSetup.error.cancelled': 'Operation cancelled.',
  'regionSetup.error.cameraChangedOrInactive':
    'Camera metadata changed or became inactive. Operation cancelled.',
  'regionSetup.error.wrongScope':
    'Region was created with an unexpected camera or zone scope. Please refresh.',
  'regionSetup.error.403': 'You do not have permission to perform this action.',
  'regionSetup.error.409':
    'Configuration version conflict: camera configuration was updated first. Your polygon draft is preserved — load and accept the latest camera image below, then save again.',
  'regionSetup.error.409Edit':
    'Configuration version conflict: camera configuration was updated first. Your unsaved polygon draft is preserved — load and accept the latest camera image below, or reopen this region from the latest revision.',
  'regionSetup.error.409ReloadBtn': 'Load latest reference (v{version}) & keep draft',
  'regionSetup.error.saveDefault':
    'Failed to save observation region. Please verify your inputs and try again.',
} as const;

const REGION_POLYGON_DRAWER_VI: Record<keyof typeof REGION_POLYGON_DRAWER_EN, string> = {
  'regionSetup.validation.alreadySaved': 'Bản nháp đa giác này đã được lưu trước đó.',
  'regionSetup.error.referenceExpired':
    'Ảnh tham chiếu cấu hình đã hết hạn. Vui lòng xem xét và xác nhận ảnh tham chiếu mới trước khi lưu.',
  'regionSetup.error.cancelled': 'Đã hủy thao tác.',
  'regionSetup.error.cameraChangedOrInactive':
    'Siêu dữ liệu camera đã thay đổi hoặc camera ngừng hoạt động. Đã hủy thao tác.',
  'regionSetup.error.wrongScope':
    'Vùng quan sát được tạo với phạm vi camera hoặc khu vực không khớp. Vui lòng làm mới.',
  'regionSetup.error.403': 'Bạn không có quyền thực hiện thao tác này.',
  'regionSetup.error.409':
    'Xung đột phiên bản cấu hình: camera vừa được cập nhật lên phiên bản mới. Bản nháp đa giác vẫn được giữ nguyên — hãy tải và chấp nhận ảnh tham chiếu mới nhất bên dưới rồi lưu lại.',
  'regionSetup.error.409Edit':
    'Xung đột phiên bản cấu hình: camera vừa được cập nhật lên phiên bản mới. Bản nháp đa giác vẫn được giữ nguyên — hãy tải và chấp nhận ảnh tham chiếu mới nhất bên dưới, hoặc mở lại vùng từ phiên bản mới nhất.',
  'regionSetup.error.409ReloadBtn': 'Tải ảnh mới nhất (v{version}) & giữ bản nháp',
  'regionSetup.error.saveDefault':
    'Không thể lưu vùng quan sát. Vui lòng kiểm tra dữ liệu và thử lại.',
};

export type RegionPolygonDrawerCatalogKey = keyof typeof REGION_POLYGON_DRAWER_EN;

export type RegionPolygonDrawerErrorKey =
  RegionReferenceValidationErrorKey | RegionPolygonValidationKey | RegionPolygonDrawerCatalogKey;

export function registerRegionPolygonDrawerCatalog(): void {
  registerFeatureCatalog({
    en: REGION_POLYGON_DRAWER_EN,
    vi: REGION_POLYGON_DRAWER_VI,
  });
}

registerRegionPolygonDrawerCatalog();
