import type { UserNotificationResponse } from '@smartsite/api-client';

export function notificationHref(notification: UserNotificationResponse) {
  return `${'incidentId' in notification.target ? '/incidents' : notification.target.tab === 'attendance' ? '/access' : '/workforce'}?${new URLSearchParams({ ...notification.target })}`;
}

export function formatNotificationDisplayMessage(
  item: Pick<UserNotificationResponse, 'event' | 'message' | 'workDate'>,
): string {
  if (
    item.event === 'ENTRY_DENIED_NO_SCHEDULE' &&
    item.message?.startsWith('Bạn chưa được phân công ca làm')
  ) {
    const workDate = item.workDate || 'today';
    return `You are not scheduled for a shift on ${workDate} at this site and entry is not permitted. Please contact your contractor representative.`;
  }
  return item.message;
}
