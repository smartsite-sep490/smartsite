import { uiLocale } from '../../../i18n';
import { translate as tr } from '../../../i18n';
export function formatShiftTime(timeStr?: string, timezone = 'Asia/Ho_Chi_Minh'): string {
  if (!timeStr) return '--:--';
  if (/^\d{2}:\d{2}/.test(timeStr)) {
    return timeStr.slice(0, 5);
  }
  try {
    const d = new Date(timeStr);
    if (!isNaN(d.getTime())) {
      return d.toLocaleTimeString(uiLocale(), {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
      });
    }
  } catch {
    // ignore
  }
  return timeStr;
}

export function formatShiftRange(
  startsAt?: string,
  endsAt?: string,
  timezone = 'Asia/Ho_Chi_Minh',
): string {
  const start = formatShiftTime(startsAt, timezone);
  const end = formatShiftTime(endsAt, timezone);
  let suffix = '';
  if (startsAt && endsAt) {
    const first = new Date(startsAt),
      last = new Date(endsAt);
    if (Number.isFinite(first.getTime()) && Number.isFinite(last.getTime())) {
      const calendar = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      const ordinal = (date: Date) => {
        const parts = calendar.formatToParts(date);
        const part = (type: Intl.DateTimeFormatPartTypes) =>
          Number(parts.find((p) => p.type === type)?.value);
        return Date.UTC(part('year'), part('month') - 1, part('day')) / 86400000;
      };
      const days = ordinal(last) - ordinal(first);
      if (days > 0) suffix = tr('time.nextDays', { count: days });
    }
  }
  return `${start} - ${end}${suffix}`;
}

export function formatDateTime(dateStr?: string): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      return d.toLocaleString(uiLocale(), {
        timeZone: 'Asia/Ho_Chi_Minh',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    }
  } catch {
    // ignore
  }
  return dateStr;
}

export function formatWorkDate(value?: string | null): string {
  if (!value) return tr('common.date_unavailable');
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}
