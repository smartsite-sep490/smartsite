import { translate, uiLanguage } from './index';
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
  // A person's Vietnamese name does not make an English server error Vietnamese.
  // Only catalog matches establish a translated system message.
  return (
    resolveMessage(message) ?? (uiLanguage() === 'vi' ? translate('errors.unexpected') : message)
  );
}
