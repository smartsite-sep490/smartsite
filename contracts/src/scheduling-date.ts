/** A work date is a calendar date in the shift's timezone, not its UTC start time. */
export function isPastWorkDate(workDate: string, timezone: string, now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)!.value;
  return workDate < `${value('year')}-${value('month')}-${value('day')}`;
}
