import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  hasRegisteredFeatureKey,
  registerFeatureCatalog,
} from '../../i18n/feature-catalog-registry';
import { SAFETY_NAMESPACE } from '../../i18n/runtime';
import type { ScopedPreviewStatus } from '../cameras/useScopedCameraPreview';

export const MONITOR_READABILITY_EN = {
  'monitor.layout.groupAria': 'Camera display layout',
  'monitor.layout.grid4': 'Camera grid (4)',
  'monitor.layout.focus1': 'Focus (1)',
  'monitor.layout.exitFullscreen': 'Exit fullscreen',
  'monitor.layout.useFocusFallback': 'Switch to Focus (1) view',
  'monitor.frameInbox': 'Grouped Frame Inbox',
  'monitor.clearLinkedCamera': 'Show available site cameras',
  'monitor.linkedCameraHint':
    'The requested camera may be disabled in configuration or belong to another site.',
  'monitor.emptyInactiveHint':
    '{inactive} camera(s) in loaded pages are saved as Disabled in configuration.',
  'monitor.emptyOfficerHint':
    'Camera registration and enabling are managed by the assigned Site Manager.',
  'monitor.openCameraSetup': 'Inspect Camera Setup',
  'monitor.siteErrorDetail': 'Could not load authorized sites. Check network or retry.',
  'monitor.cameraErrorDetail': 'Could not load preview cameras for this site.',
  'monitor.state.cameraUnavailable': 'Camera source unavailable',
  'monitor.state.aiUnavailable': 'AI snapshot unavailable',
  'monitor.state.accessRestricted': 'Camera access restricted',
  'monitor.state.cameraUnavailableHint': 'Camera feed or gateway is currently unreachable.',
  'monitor.state.aiUnavailableHint': 'No current analyzed frame is available from the AI pipeline.',
  'monitor.state.accessRestrictedHint': 'Your current session cannot access this camera stream.',
  'monitor.state.rawNoAi': 'Raw source only (AI overlay off)',
  'monitor.people.paused': 'AI paused · Person count unavailable',
  'monitor.people.connecting': 'Connecting · Person count pending',
  'monitor.people.unavailable': 'Person count unavailable (no active AI frame)',
  'monitor.people.rawMode': 'Person count unavailable on raw source video',
  'monitor.zones.linkedCount': '{count} zone(s)',
  'monitor.tech.summary': 'Technical & source details',
  'monitor.tech.sourceId': 'Source ID:',
  'monitor.tech.configVersion': 'Saved config: v{version}',
  'focus.unavailableAi': 'AI snapshot is currently unavailable (camera feed or AI worker offline).',
  'focus.unavailableSource': 'Camera source video is currently unavailable.',
  'focus.unavailableDenied': 'Access to this camera source is restricted or unavailable.',
  'focus.backToGrid': 'Back to 4-camera grid',
} as const;

export type MonitorReadabilityKey = keyof typeof MONITOR_READABILITY_EN;

export const MONITOR_READABILITY_VI: Record<MonitorReadabilityKey, string> = {
  'monitor.layout.groupAria': 'Bố cục hiển thị camera',
  'monitor.layout.grid4': 'Lưới camera (4)',
  'monitor.layout.focus1': 'Tiêu điểm (1)',
  'monitor.layout.exitFullscreen': 'Thoát toàn màn hình',
  'monitor.layout.useFocusFallback': 'Chuyển sang khung Tiêu điểm (1)',
  'monitor.frameInbox': 'Hộp thư khung hình gộp',
  'monitor.clearLinkedCamera': 'Xem các camera khả dụng của công trường',
  'monitor.linkedCameraHint':
    'Camera trong liên kết có thể đang tắt trong cấu hình hoặc thuộc công trường khác.',
  'monitor.emptyInactiveHint':
    'Có {inactive} camera trong trang đã tải đang ở trạng thái Đang tắt trong cấu hình.',
  'monitor.emptyOfficerHint':
    'Việc đăng ký và bật camera thuộc quyền của Quản lý công trường được phân công.',
  'monitor.openCameraSetup': 'Xem Thiết lập Camera',
  'monitor.siteErrorDetail': 'Không tải được danh sách công trường được phân quyền. Hãy thử lại.',
  'monitor.cameraErrorDetail': 'Không tải được danh sách camera giám sát của công trường này.',
  'monitor.state.cameraUnavailable': 'Nguồn camera không khả dụng',
  'monitor.state.aiUnavailable': 'Ảnh phân tích AI không khả dụng',
  'monitor.state.accessRestricted': 'Hạn chế quyền truy cập camera',
  'monitor.state.cameraUnavailableHint': 'Hiện không kết nối được nguồn phát hoặc cổng camera.',
  'monitor.state.aiUnavailableHint': 'Chưa có khung hình đã phân tích hiện hành từ tiến trình AI.',
  'monitor.state.accessRestrictedHint':
    'Phiên làm việc hiện tại không có quyền truy cập luồng camera này.',
  'monitor.state.rawNoAi': 'Nguồn gốc trực tiếp (tắt lớp phủ AI)',
  'monitor.people.paused': 'Tạm dừng AI · Số người không khả dụng',
  'monitor.people.connecting': 'Đang kết nối · Đang chờ số người',
  'monitor.people.unavailable': 'Số người không khả dụng (chưa có frame AI hiện hành)',
  'monitor.people.rawMode': 'Số người không khả dụng ở chế độ video nguồn gốc',
  'monitor.zones.linkedCount': '{count} khu vực',
  'monitor.tech.summary': 'Chi tiết kỹ thuật & mã nguồn',
  'monitor.tech.sourceId': 'Mã nguồn:',
  'monitor.tech.configVersion': 'Cấu hình đã lưu: v{version}',
  'focus.unavailableAi':
    'Ảnh phân tích AI hiện không khả dụng (nguồn camera hoặc worker AI đang gián đoạn).',
  'focus.unavailableSource': 'Video nguồn camera hiện không khả dụng.',
  'focus.unavailableDenied': 'Quyền truy cập nguồn camera này bị hạn chế hoặc không khả dụng.',
  'focus.backToGrid': 'Quay lại lưới 4 camera',
};

const SENTINEL_KEY: MonitorReadabilityKey = 'monitor.people.unavailable';

export function registerMonitorReadabilityCatalog(): void {
  if (hasRegisteredFeatureKey(SENTINEL_KEY)) {
    return;
  }
  registerFeatureCatalog({
    en: MONITOR_READABILITY_EN,
    vi: MONITOR_READABILITY_VI,
  });
}

registerMonitorReadabilityCatalog();

export function useMonitorReadabilityTranslate() {
  registerMonitorReadabilityCatalog();
  const { t: rawT } = useTranslation(SAFETY_NAMESPACE);
  return useCallback(
    (key: MonitorReadabilityKey, params?: Record<string, string | number>) =>
      params ? rawT(key, { replace: params }) : rawT(key),
    [rawT],
  );
}

export type MonitorSourceFailureKind =
  | 'NONE'
  | 'AI_PAUSED'
  | 'CONNECTING'
  | 'ACCESS_RESTRICTED'
  | 'CAMERA_UNAVAILABLE'
  | 'AI_UNAVAILABLE';

export type MonitorPeopleCountState =
  | { kind: 'ACTIVE_COUNT'; count: number }
  | { kind: 'ZERO_CLEAR_FRAME' }
  | { kind: 'PAUSED' }
  | { kind: 'CONNECTING' }
  | { kind: 'RAW_SOURCE_NO_AI' }
  | { kind: 'UNAVAILABLE' };

export function resolveMonitorTelemetryState(input: {
  isAiPaused: boolean;
  hasActiveAiPreview: boolean;
  detectionsCount: number;
  status: ScopedPreviewStatus;
  errorStatus: number | null;
  isRawTransport?: boolean;
}): {
  failureKind: MonitorSourceFailureKind;
  peopleState: MonitorPeopleCountState;
} {
  if (input.isAiPaused) {
    return {
      failureKind: 'AI_PAUSED',
      peopleState: { kind: 'PAUSED' },
    };
  }

  if (input.isRawTransport) {
    return {
      failureKind: 'NONE',
      peopleState: { kind: 'RAW_SOURCE_NO_AI' },
    };
  }

  if (input.hasActiveAiPreview) {
    return {
      failureKind: 'NONE',
      peopleState:
        input.detectionsCount > 0
          ? { kind: 'ACTIVE_COUNT', count: input.detectionsCount }
          : { kind: 'ZERO_CLEAR_FRAME' },
    };
  }

  if (input.status === 'CONNECTING') {
    return {
      failureKind: 'CONNECTING',
      peopleState: { kind: 'CONNECTING' },
    };
  }

  if (input.errorStatus === 401 || input.errorStatus === 403) {
    return {
      failureKind: 'ACCESS_RESTRICTED',
      peopleState: { kind: 'UNAVAILABLE' },
    };
  }

  if (
    input.errorStatus === 404 ||
    input.errorStatus === 502 ||
    input.errorStatus === 503 ||
    input.errorStatus === 504
  ) {
    return {
      failureKind: 'CAMERA_UNAVAILABLE',
      peopleState: { kind: 'UNAVAILABLE' },
    };
  }

  return {
    failureKind: 'AI_UNAVAILABLE',
    peopleState: { kind: 'UNAVAILABLE' },
  };
}
