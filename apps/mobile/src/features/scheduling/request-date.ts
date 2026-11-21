import { translate as tr, uiLocale } from '../../i18n';

export function formatRequestDate(workDate?: string | null, fallback?: string | null) {
  const calendarDate = !!workDate && /^\d{4}-\d{2}-\d{2}$/.test(workDate);
  const value = calendarDate ? `${workDate}T00:00:00Z` : workDate || fallback || '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return tr('common.notRecorded');
  return new Intl.DateTimeFormat(uiLocale(), {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(calendarDate ? { timeZone: 'UTC' } : {}),
  }).format(date);
}
