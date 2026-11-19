import { hasRegisteredFeatureKey, registerFeatureCatalog } from '../../i18n/feature-catalog-registry';

export const ZONE_MONITOR_EN = {
  'zoneMonitor.inspectorRail.regionLabel': 'Region #{{index}} · v{{version}} · {{status}}',
  'zoneMonitor.inspectorRail.regionActive': 'Active',
  'zoneMonitor.inspectorRail.regionInactive': 'Inactive',
  'zoneMonitor.inspectorRail.aiBoundaryNote':
    'The AI boundary polygon is synced from the server configuration. Changes are made via Camera Setup.',
  'zoneMonitor.inspectorRail.monitorStatus': 'Monitor status',
  'zoneMonitor.inspectorRail.liveVideo': 'Live video stage',
} as const;

export type ZoneMonitorKey = keyof typeof ZONE_MONITOR_EN;

export const ZONE_MONITOR_VI: Record<ZoneMonitorKey, string> = {
  'zoneMonitor.inspectorRail.regionLabel': 'Vùng #{{index}} · v{{version}} · {{status}}',
  'zoneMonitor.inspectorRail.regionActive': 'Đang bật',
  'zoneMonitor.inspectorRail.regionInactive': 'Đang tắt',
  'zoneMonitor.inspectorRail.aiBoundaryNote':
    'Ranh giới vùng AI đang đồng bộ trực tiếp từ cấu hình máy chủ. Để chỉnh sửa đa giác vùng, vui lòng mở Thiết lập camera.',
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
