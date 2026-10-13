import { workDateAt } from '../attendance/attendance-calculation.js';

/** A new workday must remain possible when yesterday has an unresolved checkout. */
export function isRepeatedGatePassage(
  direction: 'IN' | 'OUT',
  at: Date,
  previous: { direction: 'IN' | 'OUT'; occurredAt: Date } | null,
  day: { workDate: string; timezone: string; endsAt: Date | null } | null,
) {
  if (!previous || previous.direction !== direction) return false;
  const timezone = day?.timezone ?? 'Asia/Ho_Chi_Minh';
  const previousDate = day?.workDate ?? workDateAt(previous.occurredAt, timezone);
  return workDateAt(at, timezone) === previousDate || !!(day?.endsAt && at < day.endsAt);
}
