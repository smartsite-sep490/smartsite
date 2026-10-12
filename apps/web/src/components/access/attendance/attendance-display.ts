export const attendanceLabel = (value: string) =>
  ({
    IN_PROGRESS: 'In progress',
    NEEDS_REVIEW: 'Needs attention',
    CONFIRMED: 'Confirmed',
    MISSING_IN: 'Missing check-in',
    MISSING_OUT: 'Missing check-out',
    DUPLICATE_IN: 'Duplicate check-in',
    MATCHED: 'Check-in/out matched',
    CORRECTED: 'Corrected',
    IGNORED: 'Duplicate ignored',
    PENDING: 'Pending approval',
    PENDING_MANAGER: 'Pending approval',
    APPROVED: 'Approved',
    REJECTED: 'Rejected',
    EARLY_CHECKOUT: 'Early departure',
    SCHEDULE_CHANGED: 'Schedule changed',
  })[value] ?? value.replaceAll('_', ' ').toLowerCase();

export const attendanceHours = (minutes: number) => `${Math.floor(minutes / 60)}h ${minutes % 60}m`;

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
    ? new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(value))
    : '—';
}
