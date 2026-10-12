/** Millisecond intervals are unioned before rounding so repeated scans cannot double-count. */
export interface WorkInterval {
  start: number;
  end: number;
}
export function workDateAt(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}
/** Shift timestamps carry the template's local clock times; schedules supply the actual date. */
export function scheduledShiftWindow(
  shift: {
    startsAt: Date;
    endsAt: Date;
    timezone: string;
    breakStartsAt?: Date | null;
    breakEndsAt?: Date | null;
  },
  workDate: string,
): { startsAt: Date; endsAt: Date; breakStartsAt: Date | null; breakEndsAt: Date | null } {
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
  const parts = (at: Date) =>
    Object.fromEntries(
      format
        .formatToParts(at)
        .filter((p) => p.type !== 'literal')
        .map((p) => [p.type, Number(p.value)]),
    );
  const wall = (p: Record<string, number>) =>
    Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  const startParts = parts(shift.startsAt),
    endParts = parts(shift.endsAt);
  const dayOffset = Math.round(
    (Date.UTC(endParts.year!, endParts.month! - 1, endParts.day!) -
      Date.UTC(startParts.year!, startParts.month! - 1, startParts.day!)) /
      86400000,
  );
  const base = new Date(`${workDate}T00:00:00Z`);
  const resolve = (p: Record<string, number>, offset: number, milliseconds: number) => {
    const date = new Date(+base + offset * 86400000);
    const target = Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      p.hour!,
      p.minute!,
      p.second!,
    );
    let candidate = target;
    for (let attempt = 0; attempt < 4; attempt++)
      candidate += target - wall(parts(new Date(candidate)));
    if (wall(parts(new Date(candidate))) !== target)
      throw new Error('Shift local time does not exist on this work date');
    const valid = [
      candidate,
      candidate - 3600000,
      candidate + 3600000,
      candidate - 7200000,
      candidate + 7200000,
    ].filter((value) => wall(parts(new Date(value))) === target);
    return new Date(Math.min(...valid) + milliseconds);
  };
  const startsAt = resolve(startParts, 0, shift.startsAt.getUTCMilliseconds());
  const endsAt = resolve(endParts, dayOffset, shift.endsAt.getUTCMilliseconds());
  if (endsAt <= startsAt) throw new Error('Shift interval is invalid on this work date');
  const resolveBreak = (at: Date) => {
    const p = parts(at);
    const offset = Math.round(
      (Date.UTC(p.year!, p.month! - 1, p.day!) -
        Date.UTC(startParts.year!, startParts.month! - 1, startParts.day!)) /
        86400000,
    );
    return resolve(p, offset, at.getUTCMilliseconds());
  };
  const breakStartsAt = shift.breakStartsAt ? resolveBreak(shift.breakStartsAt) : null;
  const breakEndsAt = shift.breakEndsAt ? resolveBreak(shift.breakEndsAt) : null;
  if (
    Boolean(breakStartsAt) !== Boolean(breakEndsAt) ||
    (breakStartsAt &&
      breakEndsAt &&
      (breakStartsAt < startsAt || breakEndsAt > endsAt || breakEndsAt <= breakStartsAt))
  )
    throw new Error('Shift break is invalid on this work date');
  return { startsAt, endsAt, breakStartsAt, breakEndsAt };
}
export function unionIntervals(values: WorkInterval[]): WorkInterval[] {
  const sorted = values
    .filter((v) => v.end > v.start)
    .map((v) => ({ ...v }))
    .sort((a, b) => a.start - b.start);
  const result: WorkInterval[] = [];
  for (const value of sorted) {
    const previous = result[result.length - 1];
    if (previous && value.start <= previous.end) previous.end = Math.max(previous.end, value.end);
    else result.push(value);
  }
  return result;
}
export function workedMilliseconds(
  presence: WorkInterval[],
  windows: WorkInterval[],
  leave: WorkInterval[] = [],
): number {
  const matched = unionIntervals(
    presence.flatMap((p) =>
      windows.map((w) => ({ start: Math.max(p.start, w.start), end: Math.min(p.end, w.end) })),
    ),
  );
  const excluded = unionIntervals(leave);
  return matched.reduce(
    (total, p) =>
      total +
      p.end -
      p.start -
      excluded.reduce(
        (n, l) => n + Math.max(0, Math.min(p.end, l.end) - Math.max(p.start, l.start)),
        0,
      ),
    0,
  );
}
