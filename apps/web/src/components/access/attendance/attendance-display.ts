import { translate as tr, uiLocale } from '../../../i18n';
import { localizedLabel } from '../../../i18n/labels';
export const attendanceLabel = (value: string) =>
  ({
    IN_PROGRESS: tr('common.in_progress_c1f88e'),
    NEEDS_REVIEW: tr('common.needs_attention'),
    CONFIRMED: tr('common.confirmed'),
    MISSING_IN: tr('common.missing_check_in'),
    MISSING_OUT: tr('common.missing_check_out'),
    DUPLICATE_IN: tr('common.duplicate_check_in'),
    MATCHED: tr('common.check_in_out_matched'),
    CORRECTED: tr('common.corrected'),
    IGNORED: tr('common.duplicate_ignored'),
    PENDING: tr('common.pending_approval'),
    PENDING_MANAGER: tr('common.pending_approval'),
    APPROVED: tr('common.approved'),
    REJECTED: tr('common.rejected'),
    EARLY_CHECKOUT: tr('common.early_departure'),
    SCHEDULE_CHANGED: tr('common.schedule_changed'),
  })[value] ?? localizedLabel(value.replaceAll('_', ' ').toLowerCase());

export const attendanceHours = (minutes: number) =>
  tr('time.hoursMinutes', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });

export function attendanceDate(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function attendanceTime(value: string | null | undefined, timezone: string) {
  return value
    ? new Intl.DateTimeFormat(uiLocale(), {
        timeZone: timezone,
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(value))
    : '—';
}

export function formatWorkDate(value?: string | null): string {
  if (!value) return tr('common.date_unavailable');
  const [year, month, day] = value.split('-');
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}
