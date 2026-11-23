import { translate as tr, uiLocale } from '../../../i18n';
import { localizedLabel } from '../../../i18n/labels';
import { teamText } from '../../team-attendance/team-attendance-copy';
export const attendanceLabel = (value: string) =>
  ({
    ZONE_ATTENDANCE_REVIEW_CONFLICT: teamText('teamWeb.zoneConflict'),
    ABSENCE_REVIEW_CONFLICT: teamText('teamWeb.absenceConflict'),
    ZONE_ATTENDANCE_PENDING: teamText('teamWeb.anomaly.ZONE_ATTENDANCE_PENDING'),
    ZONE_ATTENDANCE_ABSENT: teamText('teamWeb.anomaly.ZONE_ATTENDANCE_ABSENT'),
    ZONE_GATE_MISSING: teamText('teamWeb.anomaly.ZONE_GATE_MISSING'),
    ZONE_ATTENDANCE_MISMATCH: teamText('teamWeb.anomaly.ZONE_ATTENDANCE_MISMATCH'),
    ZONE_ASSIGNMENT_UNRESOLVED: teamText('teamWeb.anomaly.ZONE_ASSIGNMENT_UNRESOLVED'),
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

/** Display the recorded interval, independently of payable shift minutes. */
export function attendanceSessionDuration(start: string | null, end: string | null) {
  if (!start || !end) return '—';
  const elapsed = Date.parse(end) - Date.parse(start);
  if (!Number.isFinite(elapsed) || elapsed < 0) return '—';
  const seconds = Math.floor(elapsed / 1000);
  return tr('time.hoursMinutesSeconds', {
    hours: Math.floor(seconds / 3600),
    minutes: Math.floor((seconds % 3600) / 60),
    seconds: seconds % 60,
  });
}

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

export function attendanceTime(
  value: string | null | undefined,
  timezone: string,
  withSeconds = false,
) {
  return value
    ? new Intl.DateTimeFormat(uiLocale(), {
        timeZone: timezone,
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        ...(withSeconds ? { second: '2-digit' as const } : {}),
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
