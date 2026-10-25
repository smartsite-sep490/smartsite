import { ApiError } from '@smartsite/api-client';
import { translate } from './index';
import en from './locales/en.json';
import vi from './locales/vi.json';

const exact = new Map<string, string>();
const templates: Array<{ key: string; pattern: RegExp; names: string[] }> = [];
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
for (const catalog of [en, vi]) {
  for (const [key, message] of Object.entries(catalog)) {
    if (!message.includes('{{')) exact.set(message, key);
    else if (message.replace(/{{\w+}}/g, '').length >= 25) {
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
        pattern: new RegExp(pattern + escape(message.slice(cursor)) + '$'),
        names,
      });
    }
  }
}

function resolveMessage(message: string): string | undefined {
  const key = exact.get(message);
  if (key) return translate(key);
  for (const template of templates) {
    const match = template.pattern.exec(message);
    if (!match) continue;
    const values: Record<string, string> = {};
    if (
      !template.names.every((name, index) => {
        if (name in values && values[name] !== match[index + 1]) return false;
        values[name] = match[index + 1]!;
        return true;
      })
    )
      continue;
    return translate(template.key, values);
  }
  return undefined;
}

/** For system-owned messages, including messages kept in local state across locale changes.
 * Never use this on user-authored names, comments, descriptions or audit payloads. */
export function localizeMessage(message: string): string {
  return resolveMessage(message) ?? message;
}

export function localizedError(message: string | undefined): string {
  if (!message) return translate('errors.unexpected');
  return resolveMessage(message) ?? translate('errors.unexpected');
}

export function userErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError))
    return localizedError(error instanceof Error ? error.message : undefined);
  if (error.code === 'network') return translate('errors.network');
  if (error.code === 'timeout') return translate('errors.timeout');
  if (error.code === 'cancelled') return translate('errors.cancelled');
  if (error.status === 429)
    return error.retryAfterSeconds
      ? translate('errors.rateLimitDelay', { seconds: error.retryAfterSeconds })
      : translate('errors.rateLimit');
  if (error.status !== undefined && error.status >= 500) return translate('errors.unavailable');
  if (error.status === 401) return translate('errors.sessionExpired');
  if (error.status === 403) return translate('errors.forbidden');
  if (error.status === 404) return translate('errors.notFound');
  if (error.status === 400 || error.status === 409) {
    return (
      resolveMessage(error.message) ??
      translate(error.status === 400 ? 'errors.validation' : 'errors.conflict')
    );
  }
  if (error.code === 'invalid-response') return translate('errors.unavailable');
  return translate('errors.unexpected');
}
