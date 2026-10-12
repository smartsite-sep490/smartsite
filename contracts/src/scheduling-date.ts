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

/** Templates supply local clock times; workDate supplies the scheduled calendar date. */
export function isShiftEnded(
  workDate: string,
  shift: { startsAt: string | Date; endsAt: string | Date; timezone: string },
  now = new Date(),
): boolean {
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone: shift.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = (date: Date) =>
    Object.fromEntries(
      format
        .formatToParts(date)
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, Number(part.value)]),
    );
  const day = (value: Record<string, number>) =>
    Date.UTC(value.year!, value.month! - 1, value.day!);
  const wall = (value: Record<string, number>) =>
    day(value) + ((value.hour! * 60 + value.minute!) * 60 + value.second!) * 1000;
  const start = new Date(shift.startsAt);
  const end = new Date(shift.endsAt);
  const base = new Date(`${workDate}T00:00:00Z`);
  if (
    !Number.isFinite(+base) ||
    base.toISOString().slice(0, 10) !== workDate ||
    !Number.isFinite(+now) ||
    !(end > start)
  )
    throw new RangeError('Invalid shift date');
  const startParts = parts(start),
    endParts = parts(end);
  const offset = day(endParts) - day(startParts);
  const target = +base + offset + wall(endParts) - day(endParts);
  let candidate = target;
  for (let attempt = 0; attempt < 4; attempt++)
    candidate += target - wall(parts(new Date(candidate)));
  if (wall(parts(new Date(candidate))) !== target)
    throw new RangeError('Shift end time does not exist on this work date');
  // When clocks repeat, use the earliest matching instant, as attendance does.
  const matches = [
    candidate,
    candidate - 3600000,
    candidate + 3600000,
    candidate - 7200000,
    candidate + 7200000,
  ].filter((value) => wall(parts(new Date(value))) === target);
  return +now >= Math.min(...matches) + end.getUTCMilliseconds();
}
