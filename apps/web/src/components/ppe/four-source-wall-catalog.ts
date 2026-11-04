import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  hasRegisteredFeatureKey,
  registerFeatureCatalog,
} from '../../i18n/feature-catalog-registry';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';

export const FOUR_SOURCE_WALL_EN_CATALOG = {
  'ppe.wall.tileAriaFocused': 'Camera {camera} (focused)',
  'ppe.wall.tileAriaAvailable': 'Camera {camera} (available)',
  'ppe.wall.context.focusedBadge': 'Focused',
  'ppe.badge.aiPaused': 'AI WORK PAUSED',
  'ppe.wall.sourceReplay': 'REPLAY',
  'ppe.wall.sourceLive': 'LIVE',
  'ppe.wall.sourceConnecting': 'CONNECTING',
  'ppe.wall.sourceUnavailable': 'UNAVAILABLE',
  'ppe.viewport.pausedTitle': 'Camera preview paused',
  'ppe.viewport.applyingTitle': 'Applying Demo Region...',
  'ppe.wall.awaitingSnapshot': 'Awaiting fresh camera snapshot...',
  'ppe.wall.connectingSnapshot': 'Connecting ({cadence} snapshot)...',
  'ppe.wall.snapshotUnavailable': 'Snapshot Unavailable',
  'ppe.wall.noActiveSnapshot': 'No active camera snapshot available.',
  'ppe.viewport.snapshotCooldown429': 'Automatic retry resumes after server cooldown.',
  'mf06.detail.retry': 'Retry',
  'ppe.wall.noPersonDetectionsDisclaimer':
    'No Person detections · Zero detections do not certify safety clearance',
  'ppe.wall.personDetectionsCount': '{count} Person detection(s)',
  'ppe.common.details': 'Details',
  'mf06.detail.field.cameraId': 'Camera ID:',
  'ppe.wall.cadenceLabel': 'Cadence: {cadence}',
  'ppe.wall.rawObjectsCount': '{count} raw object(s)',
  'ppe.overview.selectedAria': 'Selected',
  'ppe.overview.selectTitle': 'Select camera',
  'ppe.wall.enlargeCameraBtn': 'Enlarge camera',
  'ppe.common.evidence': 'Evidence',
  'ppe.wall.emptyTitle': 'No cameras available for this site',
  'ppe.wall.emptyDesc': 'Select another site or contact an administrator for camera access.',
  'ppe.wall.unassignedSlotTitle': 'Slot {slot} · Unassigned',
  'ppe.wall.unassignedSlotDesc':
    'No authorized camera source assigned. The system does not fabricate simulated feeds.',
} as const;

export type FourSourceWallTranslationKey = keyof typeof FOUR_SOURCE_WALL_EN_CATALOG;

export const FOUR_SOURCE_WALL_VI_CATALOG: Record<FourSourceWallTranslationKey, string> = {
  'ppe.wall.tileAriaFocused': 'Camera {camera} (đang chọn tiêu điểm)',
  'ppe.wall.tileAriaAvailable': 'Camera {camera} (khả dụng)',
  'ppe.wall.context.focusedBadge': 'Tiêu điểm',
  'ppe.badge.aiPaused': 'TẠM DỪNG XỬ LÝ AI',
  'ppe.wall.sourceReplay': 'PHÁT LẠI',
  'ppe.wall.sourceLive': 'TRỰC TIẾP',
  'ppe.wall.sourceConnecting': 'ĐANG KẾT NỐI',
  'ppe.wall.sourceUnavailable': 'KHÔNG KHẢ DỤNG',
  'ppe.viewport.pausedTitle': 'Đã tạm dừng xem trước camera',
  'ppe.viewport.applyingTitle': 'Đang áp dụng vùng quan sát demo...',
  'ppe.wall.awaitingSnapshot': 'Đang chờ ảnh chụp camera mới...',
  'ppe.wall.connectingSnapshot': 'Đang kết nối (ảnh chụp {cadence})...',
  'ppe.wall.snapshotUnavailable': 'Ảnh chụp không khả dụng',
  'ppe.wall.noActiveSnapshot': 'Không có ảnh chụp camera đang hoạt động.',
  'ppe.viewport.snapshotCooldown429': 'Tự động thử lại sau thời gian chờ của máy chủ.',
  'mf06.detail.retry': 'Thử lại',
  'ppe.wall.noPersonDetectionsDisclaimer':
    'Không phát hiện người · Không có phát hiện không đồng nghĩa với chứng nhận an toàn',
  'ppe.wall.personDetectionsCount': '{count} phát hiện người',
  'ppe.common.details': 'Chi tiết',
  'mf06.detail.field.cameraId': 'Mã camera:',
  'ppe.wall.cadenceLabel': 'Chu kỳ: {cadence}',
  'ppe.wall.rawObjectsCount': '{count} vật thể thô',
  'ppe.overview.selectedAria': 'Đang chọn',
  'ppe.overview.selectTitle': 'Chọn camera',
  'ppe.wall.enlargeCameraBtn': 'Phóng to camera',
  'ppe.common.evidence': 'Bằng chứng',
  'ppe.wall.emptyTitle': 'Chưa có camera khả dụng cho công trường này',
  'ppe.wall.emptyDesc':
    'Vui lòng chọn công trường khác hoặc liên hệ quản trị viên để cấp quyền camera.',
  'ppe.wall.unassignedSlotTitle': 'Kênh {slot} · Chưa chỉ định',
  'ppe.wall.unassignedSlotDesc':
    'Chưa có nguồn camera được phân quyền. Hệ thống không tạo nguồn mô phỏng.',
};

const FOUR_SOURCE_WALL_SENTINEL_KEY: FourSourceWallTranslationKey = 'ppe.wall.unassignedSlotDesc';

export function registerFourSourceWallCatalog(): void {
  if (hasRegisteredFeatureKey(FOUR_SOURCE_WALL_SENTINEL_KEY)) {
    return;
  }
  registerFeatureCatalog({
    en: FOUR_SOURCE_WALL_EN_CATALOG,
    vi: FOUR_SOURCE_WALL_VI_CATALOG,
  });
}

registerFourSourceWallCatalog();

export function useFourSourceWallTranslate() {
  registerFourSourceWallCatalog();
  const { t: rawT } = useTranslation(SAFETY_NAMESPACE);
  return useCallback(
    (key: FourSourceWallTranslationKey, params?: Record<string, string | number>) =>
      params ? rawT(key, { replace: params }) : rawT(key),
    [rawT],
  );
}
