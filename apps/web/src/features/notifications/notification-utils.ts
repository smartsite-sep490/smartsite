import type { UserNotificationResponse } from '@smartsite/api-client';

export function notificationHref(notification: UserNotificationResponse) {
  return `${'incidentId' in notification.target ? '/incidents' : '/workforce'}?${new URLSearchParams({ ...notification.target })}`;
}
