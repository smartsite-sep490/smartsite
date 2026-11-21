import {
  hasRegisteredFeatureKey,
  registerFeatureCatalog,
} from '../../i18n/feature-catalog-registry';

export const ZONE_MONITOR_EN = {
  'zoneMonitor.header.subtitle':
    'Monitor restricted area boundaries and camera status for the selected site.',
  'zoneMonitor.toolbar.boundarySummary': 'AI boundary info',
  'zoneMonitor.toolbar.editPolygon': 'Edit zone polygon',
  'zoneMonitor.inspectorRail.regionLabel': 'Region #{{index}} ({{status}})',
  'zoneMonitor.inspectorRail.regionActive': 'Active',
  'zoneMonitor.inspectorRail.regionInactive': 'Inactive',
  'zoneMonitor.inspectorRail.aiBoundaryNote':
    'The AI boundary polygon is synced from the server configuration. Changes are made via Camera Setup.',
  'zoneMonitor.inspectorRail.monitorStatus': 'Monitor status',
  'zoneMonitor.inspectorRail.liveVideo': 'Live video stage',
} as const;

export type ZoneMonitorKey = keyof typeof ZONE_MONITOR_EN;

export const ZONE_MONITOR_VI: Record<ZoneMonitorKey, string> = {
  'zoneMonitor.header.subtitle':
    'Theo dõi ranh giới khu vực hạn chế và trạng thái camera theo công trường đang chọn.',
  'zoneMonitor.toolbar.boundarySummary': 'Thông tin vùng AI',
  'zoneMonitor.toolbar.editPolygon': 'Sửa đa giác vùng',
  'zoneMonitor.inspectorRail.regionLabel': 'Vùng #{{index}} ({{status}})',
  'zoneMonitor.inspectorRail.regionActive': 'Đang bật',
  'zoneMonitor.inspectorRail.regionInactive': 'Đang tắt',
  'zoneMonitor.inspectorRail.aiBoundaryNote':
    'Ranh giới vùng AI đang đồng bộ từ cấu hình công trường. Để chỉnh sửa đa giác vùng, vui lòng mở Thiết lập camera.',
  'zoneMonitor.inspectorRail.monitorStatus': 'Trạng thái giám sát',
  'zoneMonitor.inspectorRail.liveVideo': 'Hình ảnh trực tiếp',
};

export function registerZoneMonitorCatalog(): void {
  if (hasRegisteredFeatureKey('zoneMonitor.inspectorRail.regionLabel')) {
    return;
  }
  registerFeatureCatalog({
    en: ZONE_MONITOR_EN,
    vi: ZONE_MONITOR_VI,
  });
}

registerZoneMonitorCatalog();
