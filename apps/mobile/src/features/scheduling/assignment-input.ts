import { addCalendarDays } from './schedule-calendar';

export function assignmentEndDate(mode: 'DAY' | 'WEEK' | 'REPEAT', from: string, to: string) {
  if (mode === 'DAY') return from;
  if (mode === 'WEEK')
    return /^\d{4}-\d{2}-\d{2}$/.test(from) && Number.isFinite(Date.parse(from))
      ? addCalendarDays(from, 6)
      : '';
  return to;
}
