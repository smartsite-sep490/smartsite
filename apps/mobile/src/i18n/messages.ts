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

export function notificationTitle(item: Pick<UserNotificationResponse, 'event' | 'title'>): string {
  const key = `notifications.${item.event}`;
  if (
    i18n.exists(key) &&
    (item.event.startsWith('DOCUMENT_') ||
      item.title === item.event ||
      item.title === item.event.replaceAll('_', ' '))
  )
    return translate(key);
  return localizeMessage(item.title);
}

export function notificationMessage(
  item: Pick<UserNotificationResponse, 'event' | 'message' | 'workDate'>,
): string {
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
  return localizeMessage(item.message);
}
