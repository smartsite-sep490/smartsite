import type { UserNotificationResponse } from '@smartsite/api-client';

export function notificationHref(notification: UserNotificationResponse) {
  return `/workforce?${new URLSearchParams({ ...notification.target })}`;
}
