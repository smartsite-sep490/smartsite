import i18n, { translate, uiLocale } from './index';
import en from './locales/en.json';
import vi from './locales/vi.json';
import type { UserNotificationResponse } from '@smartsite/api-client';

const exact = new Map<string, string>();
const templates: { key: string; pattern: RegExp; names: string[] }[] = [];
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const catalog of [en, vi]) {
  for (const [section, entries] of Object.entries(catalog)) {
    for (const [name, message] of Object.entries(entries)) {
      const key = `${section}.${name}`;
      if (!message.includes('{{')) exact.set(message, key);
      else if (message.replace(/{{\w+}}/g, '').length >= 15 || key === 'validation.required') {
        const names: string[] = [];
        let cursor = 0;
        let pattern = '^';
        for (const match of message.matchAll(/{{(\w+)}}/g)) {
          pattern += escape(message.slice(cursor, match.index)) + '([\\s\\S]*?)';
          names.push(match[1]!);
          cursor = match.index + match[0].length;
        }
        templates.push({
          key,
          names,
          pattern: new RegExp(pattern + escape(message.slice(cursor)) + '$'),
        });
      }
    }
  }
}

/** Only system-owned messages; names, notes and authored descriptions stay unchanged. */
export function localizeMessage(message: string): string {
  const key = exact.get(message);
  if (key) return translate(key);
  for (const template of templates) {
    const match = template.pattern.exec(message);
    if (!match) continue;
    const values: Record<string, string> = {};
    if (
      !template.names.every((name, index) => {
        if (name in values && values[name] !== match[index + 1]) return false;
        const value = match[index + 1]!;
        const labelKey = name === 'label' ? exact.get(value) : undefined;
        values[name] = labelKey ? translate(labelKey) : value;
        return true;
      })
    )
      continue;
    return translate(template.key, values);
  }
  return message;
}

export function localizedLabel(value: string): string {
  const key = `labels.${value.toUpperCase()}`;
  return i18n.exists(key) ? translate(key) : value;
}

export function notificationTitle(
  item: Pick<UserNotificationResponse, 'event' | 'title' | 'processingStatus'>,
): string {
  if (item.processingStatus && ['MISSING_ATTENDANCE', 'MISSING_CHECKOUT'].includes(item.event))
    return translate('notifications.workflowMissingTitle');
  const key = `notifications.${item.event}`;
  if (
    i18n.exists(key) &&
    (item.event.startsWith('DOCUMENT_') ||
      item.event === 'ABSENCE_REVIEW_REQUIRED' ||
      item.event === 'ZONE_REVIEW_REQUIRED' ||
      item.title === item.event ||
      item.title === item.event.replaceAll('_', ' '))
  )
    return translate(key);
  return localizeMessage(item.title);
}

export function notificationMessage(
  item: Pick<
    UserNotificationResponse,
    'event' | 'message' | 'workDate' | 'recipientRole' | 'workerName' | 'processingStatus'
  >,
): string {
  const personalize = (message: string) => {
    if (item.recipientRole !== 'WORKER' || !item.workerName) return message;
    for (const [prefix, replacement] of [
      [`Công nhân ${item.workerName}`, 'Bạn'],
      [`Worker ${item.workerName}`, 'You'],
    ] as const)
      if (message.startsWith(prefix)) return replacement + message.slice(prefix.length);
    return message;
  };
  if (item.event === 'ABSENT' && item.workerName && item.recipientRole)
    return translate(
      item.recipientRole === 'WORKER'
        ? 'notifications.workflowAbsentWorker'
        : 'notifications.workflowAbsentRepresentative',
      { name: item.workerName, date: item.workDate ?? '' },
    );
  const values = { name: item.workerName ?? '', date: item.workDate ?? '' };
  if (
    item.processingStatus &&
    item.recipientRole &&
    ['MISSING_ATTENDANCE', 'MISSING_CHECKOUT'].includes(item.event)
  )
    return translate(
      `notifications.workflowMissing_${item.recipientRole}_${item.processingStatus}`,
      values,
    );
  if (item.event === 'TIME_REQUESTED' && item.workerName && item.processingStatus === 'RESOLVED')
    return translate('notifications.workflowRequestResolved', values);
  if (
    item.event === 'TIME_REQUESTED' &&
    item.workerName &&
    item.processingStatus === 'PENDING_REVIEW' &&
    item.message.startsWith('Attendance correction requested: ')
  )
    return (
      translate('notifications.workflowRequestPending', values) +
      translate('notifications.reason', {
        reason: item.message.slice('Attendance correction requested: '.length),
      })
    );
  if (item.event === 'ASSIGNMENT_REVIEW' && item.workerName && item.recipientRole)
    return translate(
      item.recipientRole === 'WORKER'
        ? 'notifications.workflowAssignmentWorker'
        : 'notifications.workflowAssignmentRepresentative',
      values,
    );
  if (item.event.startsWith('DOCUMENT_') && item.recipientRole === 'WORKER' && item.workerName) {
    const separator = item.message.indexOf(' — ');
    if (separator > 0 && item.message.startsWith(item.workerName + ' ('))
      return (
        translate('notifications.workflowYourDocument') +
        ' ' +
        localizeMessage(item.message.slice(separator + 3))
      );
  }

  if (item.event === 'ZONE_REVIEW_REQUIRED') {
    const match =
      /^Worker ([\s\S]+) \(([^()]*)\) has complete Gate IN\/OUT on (\d{4}-\d{2}-\d{2}),/.exec(
        item.message,
      );
    return match
      ? translate('notifications.zoneReviewMessage', {
          name: match[1],
          code: match[2],
          date: match[3],
        })
      : localizeMessage(item.message);
  }
  if (item.event === 'ABSENCE_REVIEW_REQUIRED') {
    const missing =
      /^Worker ([\s\S]+) \(([^()]*)\) has no leader roll call on (\d{4}-\d{2}-\d{2}),/.exec(
        item.message,
      );
    if (missing)
      return translate('notifications.missingRollCallAbsenceMessage', {
        name: missing[1],
        code: missing[2],
        date: missing[3],
      });
    const match = /^Worker ([\s\S]+) \(([^()]*)\) was marked present on (\d{4}-\d{2}-\d{2}),/.exec(
      item.message,
    );
    return match
      ? translate('notifications.gateAbsenceReviewMessage', {
          name: match[1],
          code: match[2],
          date: match[3],
        })
      : localizeMessage(item.message);
  }
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
  const request = /^([\s\S]+) requested (overtime|leave): ([\s\S]*)$/.exec(item.message);
  if (item.event === 'TIME_REQUESTED' && request)
    return translate('notifications.time_request', {
      name: request[1],
      kind: localizedLabel(request[2]!).toLocaleLowerCase(uiLocale()),
      reason: request[3],
    });
  const review =
    /^(Attendance correction|overtime|leave) (approved|rejected)(?:: ([\s\S]*))?$/.exec(
      item.message,
    );
  if (['TIME_APPROVED', 'TIME_REJECTED'].includes(item.event) && review)
    return (
      translate('notifications.time_review', {
        kind: localizedLabel(review[1] === 'Attendance correction' ? 'CORRECTION' : review[1]!),
        status: localizedLabel(review[2]!),
      }) + (review[3] ? translate('notifications.reason', { reason: review[3] }) : '')
    );
  const reasonAt = item.message.indexOf(' Reason: ');
  if (reasonAt !== -1 && ['SWAP_DECLINED', 'REQUEST_REJECTED'].includes(item.event))
    return (
      localizeMessage(item.message.slice(0, reasonAt)) +
      translate('notifications.reason', { reason: item.message.slice(reasonAt + 9) })
    );
  return personalize(localizeMessage(item.message));
}
