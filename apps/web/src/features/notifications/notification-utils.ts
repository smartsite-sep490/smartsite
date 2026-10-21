import i18n, { translate as tr, uiLocale } from '../../i18n';
import { localizeMessage } from '../../i18n/messages';
import { localizedLabel } from '../../i18n/labels';
import type { UserNotificationResponse } from '@smartsite/api-client';

export function notificationHref(notification: UserNotificationResponse, assignedWork = false) {
  if (notification.target.tab === 'alerts')
    return `/incidents?${new URLSearchParams({ ...notification.target })}`;
  if (notification.target.tab === 'documents')
    return `/worker-documents?${new URLSearchParams({ ...notification.target })}`;
  return `${'incidentId' in notification.target || 'checklistId' in notification.target ? (assignedWork ? '/assigned-work' : '/incidents') : notification.target.tab === 'attendance' ? '/access' : '/workforce'}?${new URLSearchParams({ ...notification.target })}`;
}

export function formatNotificationDisplayMessage(
  item: Pick<UserNotificationResponse, 'event' | 'message' | 'workDate' | 'safetyAlert'>,
): string {
  if (item.event === 'PPE_ALERT_CREATED' && item.safetyAlert) {
    const metadata = item.safetyAlert;
    return tr('ppeNotifications.body', {
      camera: metadata.cameraName,
      zone: metadata.zoneName ?? tr('ppeNotifications.noZone'),
      subtype: tr(`ppeNotifications.${metadata.candidateSubtype}`),
    });
  }
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
    const workDate = item.workDate || tr('common.today');
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
  // Translate the generated envelope while keeping names and authored reasons intact.
  const request = /^([\s\S]+) requested (overtime|leave): ([\s\S]*)$/.exec(item.message);
  if (item.event === 'TIME_REQUESTED' && request) {
    return tr('notifications.time_request', {
      name: request[1],
      kind: localizedLabel(request[2]).toLocaleLowerCase(uiLocale()),
      reason: request[3],
    });
  }
  const review =
    /^(Attendance correction|overtime|leave) (approved|rejected)(?:: ([\s\S]*))?$/.exec(
      item.message,
    );
  if (['TIME_APPROVED', 'TIME_REJECTED'].includes(item.event) && review) {
    return (
      tr('notifications.time_review', {
        kind: localizedLabel(review[1] === 'Attendance correction' ? 'CORRECTION' : review[1]),
        status: localizedLabel(review[2]),
      }) + (review[3] ? tr('notifications.reason', { reason: review[3] }) : '')
    );
  }
  if (item.event === 'TIME_APPROVED' && item.message.startsWith('Duplicate IN ignored: '))
    return tr('notifications.duplicate_ignored', {
      reason: item.message.slice('Duplicate IN ignored: '.length),
    });
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
  if (item.event === 'PPE_ALERT_CREATED') return tr('notifications.PPE_ALERT_CREATED');
  if (item.event.startsWith('DOCUMENT_')) return tr(`notifications.${item.event}`);
  if (
    i18n.exists(`notifications.${item.event}`) &&
    (item.title === item.event ||
      item.title === item.event.replaceAll('_', ' ') ||
      ['EARLY_EXIT', 'EXIT_DURATION_EXCEEDED', 'MAX_EXITS_EXCEEDED'].includes(item.event))
  ) {
    return tr(`notifications.${item.event}`);
  }
  return localizeMessage(localizedLabel(item.title));
}
