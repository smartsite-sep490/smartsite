import { useMemo } from 'react';
import { registerFeatureCatalog } from '../../i18n/feature-catalog-registry';
import { SafetyTaskTour } from '../safety/SafetyTaskTour';
import type { SafetyTourStepSpec } from '../safety/safetyTaskTourModel';

const MONITOR_WORKSPACE_TOUR_VERSION = 2;

const MONITOR_WORKSPACE_TOUR_EN = {
  'monitor.tour.siteScope.title': 'Select Site Scope',
  'monitor.tour.siteScope.body':
    'Choose a Site you can access. Use Load more for later Site pages.',
  'monitor.tour.cameraSelect.title': 'Choose an Enabled Camera',
  'monitor.tour.cameraSelect.body':
    'Choose an enabled camera, using Load more for later pages. Enabled is a saved setting; it does not confirm a connection or current image.',
  'monitor.tour.focusToggle.title': 'Switch Focus or Camera Grid',
  'monitor.tour.focusToggle.body':
    'Switch between one focused camera and a grid of up to four cameras while keeping your selection.',
  'monitor.tour.fullscreen.title': 'Browser Fullscreen',
  'monitor.tour.fullscreen.body':
    'Request browser fullscreen for the current camera display area. Fullscreen only expands the current view and does not switch between Focus and Camera grid.',
  'monitor.tour.safetyRecords.title': 'Open Safety Records',
  'monitor.tour.safetyRecords.body':
    'Open safety records for the selected Site to review saved episodes and technical evidence. Monitoring observations do not automatically confirm violations or worker identity.',
} as const;

const MONITOR_WORKSPACE_TOUR_VI: Record<keyof typeof MONITOR_WORKSPACE_TOUR_EN, string> = {
  'monitor.tour.siteScope.title': 'Chọn phạm vi công trường',
  'monitor.tour.siteScope.body':
    'Chọn công trường được phân quyền. Dùng Tải thêm để xem các trang công trường tiếp theo.',
  'monitor.tour.cameraSelect.title': 'Chọn camera được bật',
  'monitor.tour.cameraSelect.body':
    'Chọn camera được bật trong cấu hình; dùng Tải thêm để xem trang sau. Trạng thái này không xác nhận kết nối hay hình ảnh hiện tại.',
  'monitor.tour.focusToggle.title': 'Chuyển Tiêu điểm hoặc Lưới camera',
  'monitor.tour.focusToggle.body':
    'Chuyển giữa khung xem một camera và lưới tối đa 4 camera mà vẫn giữ nguyên lựa chọn.',
  'monitor.tour.fullscreen.title': 'Toàn màn hình trình duyệt',
  'monitor.tour.fullscreen.body':
    'Yêu cầu trình duyệt mở toàn màn hình cho vùng camera. Thao tác này mở rộng khung nhìn hiện hành, không tự chuyển giữa Tiêu điểm và Lưới camera.',
  'monitor.tour.safetyRecords.title': 'Mở hồ sơ an toàn',
  'monitor.tour.safetyRecords.body':
    'Mở hồ sơ an toàn của công trường đang chọn để xem xét các hồ sơ và bằng chứng kỹ thuật đã lưu. Quan sát giám sát không tự động xác nhận vi phạm hay danh tính công nhân.',
};

registerFeatureCatalog({
  en: MONITOR_WORKSPACE_TOUR_EN,
  vi: MONITOR_WORKSPACE_TOUR_VI,
});

function buildMonitorWorkspaceTourSteps(options: {
  hasSiteScope: boolean;
  hasActiveCamera: boolean;
}): readonly SafetyTourStepSpec[] {
  return [
    {
      id: 'monitor-site-scope',
      anchorSelector: '[data-tour-anchor="monitor-site-scope"]',
      titleKey: 'monitor.tour.siteScope.title',
      bodyKey: 'monitor.tour.siteScope.body',
      isAllowed: () => options.hasSiteScope,
    },
    {
      id: 'monitor-camera-select',
      anchorSelector: '[data-tour-anchor="monitor-camera-select"]',
      titleKey: 'monitor.tour.cameraSelect.title',
      bodyKey: 'monitor.tour.cameraSelect.body',
      isAllowed: () => options.hasActiveCamera,
    },
    {
      id: 'monitor-focus-toggle',
      anchorSelector: '[data-tour-anchor="monitor-focus-toggle"]',
      titleKey: 'monitor.tour.focusToggle.title',
      bodyKey: 'monitor.tour.focusToggle.body',
      isAllowed: () => options.hasActiveCamera,
    },
    {
      id: 'monitor-fullscreen',
      anchorSelector: '[data-tour-anchor="monitor-fullscreen"]',
      titleKey: 'monitor.tour.fullscreen.title',
      bodyKey: 'monitor.tour.fullscreen.body',
      isAllowed: () => options.hasActiveCamera,
    },
    {
      id: 'monitor-safety-records',
      anchorSelector: '[data-tour-anchor="monitor-safety-records"]',
      titleKey: 'monitor.tour.safetyRecords.title',
      bodyKey: 'monitor.tour.safetyRecords.body',
      isAllowed: () => options.hasSiteScope,
    },
  ];
}

export interface MonitorWorkspaceTourProps {
  userId?: string | null;
  scope: string;
  observationMode: 'ppe' | 'zone';
  siteId: string;
  selectedCameraId?: string | null;
  isMetadataReady: boolean;
  hasActiveCamera: boolean;
}

export function MonitorWorkspaceTour({
  userId,
  scope,
  observationMode,
  siteId,
  selectedCameraId = null,
  isMetadataReady,
  hasActiveCamera,
}: MonitorWorkspaceTourProps) {
  const hasSiteScope = isMetadataReady && Boolean(siteId);
  const canUseCameraControls = hasSiteScope && hasActiveCamera;
  const steps = useMemo(
    () =>
      buildMonitorWorkspaceTourSteps({
        hasSiteScope,
        hasActiveCamera: canUseCameraControls,
      }),
    [hasSiteScope, canUseCameraControls],
  );
  const scopeKey = `${scope}:${observationMode}:${siteId}:${selectedCameraId ?? 'none'}`;

  return (
    <SafetyTaskTour
      taskId="monitor"
      tourVersion={MONITOR_WORKSPACE_TOUR_VERSION}
      userId={userId}
      scopeKey={scopeKey}
      isAuthorized={hasSiteScope}
      steps={steps}
    />
  );
}
