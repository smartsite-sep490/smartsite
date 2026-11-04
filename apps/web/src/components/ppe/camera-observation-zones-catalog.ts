import { registerFeatureCatalog } from '../../i18n/feature-catalog-registry';

const CAMERA_OBSERVATION_ZONES_EN = {
  'ppe.context.siteScopeFallback': 'Site Scope',
  'ppe.wall.context.focusedBadge': 'Focused',
  'ppe.wall.context.siteLabel': 'Site',
  'ppe.wall.context.cameraLabel': 'Camera',
  'ppe.wall.context.zonesLabel': 'Zones',
  'ppe.wall.context.loadingZones': 'Loading zones…',
  'ppe.wall.context.noZonesLinked': 'No zones linked',
  'ppe.wall.context.unresolvedZones': '{count} unresolved region(s)',
  'ppe.wall.context.zonesUnavailable': 'Zones temporarily unavailable',
  'ppe.wall.context.zonesAccessDenied': 'Zone metadata unavailable (access denied)',
  'ppe.wall.context.partialLoadError':
    'Partially loaded ({loaded}/{total}) · Could not load more zones',
  'ppe.wall.context.loadMoreZones': 'Load more zones',
  'ppe.wall.context.loadingMoreZones': 'Loading more zones…',
  'ppe.wall.context.retryZones': 'Reload zones',
} as const;

export type CameraObservationZonesCopyKey = keyof typeof CAMERA_OBSERVATION_ZONES_EN;

const CAMERA_OBSERVATION_ZONES_VI: Record<CameraObservationZonesCopyKey, string> = {
  'ppe.context.siteScopeFallback': 'Phạm vi công trường',
  'ppe.wall.context.focusedBadge': 'Tiêu điểm',
  'ppe.wall.context.siteLabel': 'Công trường',
  'ppe.wall.context.cameraLabel': 'Camera',
  'ppe.wall.context.zonesLabel': 'Khu vực',
  'ppe.wall.context.loadingZones': 'Đang tải khu vực…',
  'ppe.wall.context.noZonesLinked': 'Chưa gắn khu vực',
  'ppe.wall.context.unresolvedZones': '{count} vùng chưa xác định khu vực',
  'ppe.wall.context.zonesUnavailable': 'Không tải được khu vực (lỗi tạm thời)',
  'ppe.wall.context.zonesAccessDenied': 'Không tải được khu vực (không có quyền truy cập)',
  'ppe.wall.context.partialLoadError':
    'Đã tải một phần ({loaded}/{total}) · Không thể tải thêm khu vực',
  'ppe.wall.context.loadMoreZones': 'Tải thêm khu vực',
  'ppe.wall.context.loadingMoreZones': 'Đang tải thêm khu vực…',
  'ppe.wall.context.retryZones': 'Tải lại khu vực',
};

let isCatalogRegistered = false;

export function registerCameraObservationZonesCatalog(): void {
  if (isCatalogRegistered) {
    return;
  }
  registerFeatureCatalog({
    en: CAMERA_OBSERVATION_ZONES_EN,
    vi: CAMERA_OBSERVATION_ZONES_VI,
  });
  isCatalogRegistered = true;
}

registerCameraObservationZonesCatalog();
