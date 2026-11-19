import { hasRegisteredFeatureKey, registerFeatureCatalog } from '../../i18n/feature-catalog-registry';

export const NOTIFICATION_CENTER_EN = {
  'notificationCenter.cameraAlerts': 'Camera & PPE Alerts',
  'notificationCenter.scheduleSystem': 'Schedule & System',
  'notificationCenter.viewAllFrames': 'View all frames',
  'notificationCenter.ppeFrameCard.camera': 'Camera',
  'notificationCenter.ppeFrameCard.newAlert': 'New',
} as const;

export type NotificationCenterKey = keyof typeof NOTIFICATION_CENTER_EN;

export const NOTIFICATION_CENTER_VI: Record<NotificationCenterKey, string> = {
  'notificationCenter.cameraAlerts': 'Camera & Cảnh báo PPE',
  'notificationCenter.scheduleSystem': 'Lịch trình & Hệ thống',
  'notificationCenter.viewAllFrames': 'Xem tất cả khung hình',
  'notificationCenter.ppeFrameCard.camera': 'Camera',
  'notificationCenter.ppeFrameCard.newAlert': 'Mới',
};

export function registerNotificationCenterCatalog(): void {
  if (hasRegisteredFeatureKey('notificationCenter.cameraAlerts')) {
    return;
  }
  registerFeatureCatalog({
    en: NOTIFICATION_CENTER_EN,
    vi: NOTIFICATION_CENTER_VI,
  });
}

registerNotificationCenterCatalog();
