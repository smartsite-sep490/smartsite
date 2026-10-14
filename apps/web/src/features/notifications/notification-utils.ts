import { translate as tr, uiLanguage } from '../../i18n';
import { localizeMessage } from '../../i18n/messages';
import { localizedLabel } from '../../i18n/labels';
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
    return tr(
      'notification-utils.you_are_not_scheduled_for_a_shift_on_value_at_this_site_and_entry_is_not_permitted',
      { value1: workDate },
    );
  }
  // The safety handover body is an authored incident title, not system copy.
  if (item.event === 'SAFETY_HANDOVER') return item.message;
  const reasonAt = item.message.indexOf(' Reason: ');
  if (reasonAt !== -1 && ['SWAP_DECLINED', 'REQUEST_REJECTED'].includes(item.event)) {
    return (
      localizeMessage(item.message.slice(0, reasonAt)) +
      tr('notifications.reason', { reason: item.message.slice(reasonAt + 9) })
    );
  }
  return localizeMessage(item.message);
}

export function formatNotificationTitle(item: Pick<UserNotificationResponse, 'event' | 'title'>) {
  if (uiLanguage() === 'en') return item.title;
  return localizeMessage(localizedLabel(item.title));
}
