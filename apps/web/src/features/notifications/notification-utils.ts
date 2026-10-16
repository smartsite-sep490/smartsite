import { translate as tr, uiLanguage } from '../../i18n';
import { localizeMessage } from '../../i18n/messages';
import { localizedLabel } from '../../i18n/labels';
import type { UserNotificationResponse } from '@smartsite/api-client';

export function notificationHref(notification: UserNotificationResponse) {
  return `${'incidentId' in notification.target || 'checklistId' in notification.target ? '/incidents' : notification.target.tab === 'attendance' ? '/access' : '/workforce'}?${new URLSearchParams({ ...notification.target })}`;
}

export function formatNotificationDisplayMessage(
  item: Pick<UserNotificationResponse, 'event' | 'message' | 'workDate'>,
): string {
  if (['EXIT_DURATION_EXCEEDED', 'MAX_EXITS_EXCEEDED'].includes(item.event)) {
    // Older notifications stored a transient duration snapshot. Hide that
    // suffix as well so existing inbox entries use the same concise copy.
    const message = item.message
      .replace(
        / Lượt ra ngoài thứ \d+, thời gian ngoài giờ nghỉ: \d+ phút; thời gian bị trừ tính đến lần kiểm tra này: \d+ phút\.$/,
        '',
      )
      .replace(
        / Exit \d+, time outside excluding breaks: \d+ minutes; time deducted as of this check: \d+ minutes\.$/,
        '',
      );
    return localizeMessage(message);
  }
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
  // Safety bodies contain authored incident titles or checklist work descriptions.
  if (
    [
      'SAFETY_HANDOVER',
      'CHECKLIST_ASSIGNED',
      'CHECKLIST_SUBMITTED',
      'CHECKLIST_RETURNED',
      'CHECKLIST_RECORDED',
    ].includes(item.event)
  )
    return item.message;
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
  if (['EARLY_EXIT', 'EXIT_DURATION_EXCEEDED', 'MAX_EXITS_EXCEEDED'].includes(item.event)) {
    return tr(`notifications.${item.event}`);
  }
  if (uiLanguage() === 'en') return item.title;
  return localizeMessage(localizedLabel(item.title));
}
