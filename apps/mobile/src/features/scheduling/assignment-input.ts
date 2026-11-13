import { addCalendarDays } from './schedule-calendar';

export function assignmentEndDate(mode: 'DAY' | 'WEEK' | 'REPEAT', from: string, to: string) {
  if (mode === 'DAY') return from;
  if (mode === 'WEEK')
    return /^\d{4}-\d{2}-\d{2}$/.test(from) && Number.isFinite(Date.parse(from))
      ? addCalendarDays(from, 6)
      : '';
  return to;
}

export function matchingVersions<
  T extends { effectiveFrom: string; effectiveUntil: string | null },
>(versions: T[], from: string, to: string): T[] {
  return versions.filter(
    (v) =>
      v.effectiveFrom.slice(0, 10) <= from &&
      (!v.effectiveUntil || v.effectiveUntil.slice(0, 10) > to),
  );
}
