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
export { scheduledShiftWindow } from '@smartsite/contracts';
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

/** Calculates the net duration of an interval after subtracting all overlapping excluded windows. */
export function intervalNetMilliseconds(
  interval: WorkInterval,
  exclusions: WorkInterval[],
): number {
  if (interval.end <= interval.start) return 0;
  const clipped = exclusions
    .map((e) => ({
      start: Math.max(interval.start, e.start),
      end: Math.min(interval.end, e.end),
    }))
    .filter((e) => e.end > e.start);
  const unioned = unionIntervals(clipped);
  const excludedMs = unioned.reduce((total, e) => total + (e.end - e.start), 0);
  return Math.max(0, interval.end - interval.start - excludedMs);
}

export interface ShiftSubtractionInput {
  shiftWindow: {
    startsAt: Date;
    endsAt: Date;
    breakStartsAt?: Date | null;
    breakEndsAt?: Date | null;
  };
  policy?: {
    allowedExitMinutes?: number;
    maxExitCount?: number;
  };
  sessions: Array<{
    effectiveInAt: Date | null;
    effectiveOutAt: Date | null;
    status?: string;
  }>;
  leaveWindows?: WorkInterval[];
  overtimeWindows?: WorkInterval[];
  now?: Date;
}

export interface ShiftSubtractionResult {
  scheduledMinutes: number;
  regularMinutes: number;
  overtimeMinutes: number;
  provisionalMinutes: number;
  deductedMinutes: number;
  exitCount: number;
  violations: Array<'EXIT_DURATION_EXCEEDED' | 'MAX_EXITS_EXCEEDED'>;
  anomalies: string[];
  violationDetails: Array<{
    event: 'EXIT_DURATION_EXCEEDED' | 'MAX_EXITS_EXCEEDED';
    exitedAt: number;
    exitIndex: number;
    absentMinutes: number;
    deductedMinutes: number;
  }>;
}

export function calculateShiftAttendanceSubtraction(
  input: ShiftSubtractionInput,
): ShiftSubtractionResult {
  const {
    shiftWindow,
    policy,
    sessions,
    leaveWindows = [],
    overtimeWindows = [],
    now = new Date(),
  } = input;
  const shiftStart = +shiftWindow.startsAt;
  const shiftEnd = +shiftWindow.endsAt;
  const allowedExitMs = Math.max(0, (policy?.allowedExitMinutes ?? 15) * 60000);
  const maxExitCount = Math.max(0, policy?.maxExitCount ?? 2);

  const exclusions: WorkInterval[] = [
    ...leaveWindows,
    ...(shiftWindow.breakStartsAt && shiftWindow.breakEndsAt
      ? [{ start: +shiftWindow.breakStartsAt, end: +shiftWindow.breakEndsAt }]
      : []),
  ];

  const scheduledMs = intervalNetMilliseconds({ start: shiftStart, end: shiftEnd }, exclusions);
  const scheduledMinutes = Math.floor(scheduledMs / 60000);

  const cutoff = Math.max(shiftStart, Math.min(+now, shiftEnd));
  const validSessions = sessions.filter(
    (s) =>
      s.status !== 'IGNORED' &&
      s.effectiveInAt !== null &&
      +s.effectiveInAt <= +now &&
      (s.effectiveOutAt === null || +s.effectiveOutAt > +s.effectiveInAt),
  );
  // Union before finding gaps: a nested/duplicate session must not invent an exit.
  const presence = unionIntervals(
    validSessions.map((s) => ({
      start: +s.effectiveInAt!,
      end: Math.min(s.effectiveOutAt ? +s.effectiveOutAt : +now, +now),
    })),
  );
  const inShift = unionIntervals(
    presence.map((p) => ({ start: Math.max(shiftStart, p.start), end: Math.min(cutoff, p.end) })),
  );
  const elapsedScheduledMs = intervalNetMilliseconds(
    { start: shiftStart, end: cutoff },
    exclusions,
  );
  let totalDeductedMs = 0;
  let exitCount = 0;
  const violationDetails: ShiftSubtractionResult['violationDetails'] = [];

  const deductExit = (start: number, end: number, finalDeparture: boolean) => {
    const absentMs = intervalNetMilliseconds({ start, end }, exclusions);
    if (absentMs <= 0) return;
    exitCount += 1;
    const exceedsCount = exitCount > maxExitCount;
    const deductedMs =
      finalDeparture || exceedsCount ? absentMs : Math.max(0, absentMs - allowedExitMs);
    totalDeductedMs += deductedMs;
    const event = exceedsCount
      ? 'MAX_EXITS_EXCEEDED'
      : absentMs > allowedExitMs
        ? 'EXIT_DURATION_EXCEEDED'
        : null;
    if (event) {
      violationDetails.push({
        event,
        exitedAt: start,
        exitIndex: exitCount,
        absentMinutes: Math.floor(absentMs / 60000),
        deductedMinutes: Math.floor(deductedMs / 60000),
      });
    }
  };

  if (inShift.length === 0) {
    totalDeductedMs = elapsedScheduledMs;
  } else {
    totalDeductedMs = intervalNetMilliseconds(
      { start: shiftStart, end: inShift[0]!.start },
      exclusions,
    );
    for (let i = 1; i < inShift.length; i++) {
      deductExit(inShift[i - 1]!.end, inShift[i]!.start, false);
    }
    const lastEnd = inShift[inShift.length - 1]!.end;
    if (lastEnd < cutoff) {
      // A final departure loses all remaining work time, including the grace period.
      deductExit(lastEnd, cutoff, +now >= shiftEnd);
    }
  }

  const regularMs = Math.max(0, elapsedScheduledMs - totalDeductedMs);
  const regularMinutes = Math.floor(regularMs / 60000);
  const closedPresence = validSessions
    .filter((s) => s.effectiveOutAt !== null && +s.effectiveOutAt <= +now)
    .map((s) => ({ start: +s.effectiveInAt!, end: +s.effectiveOutAt! }));
  const overtimeMs = workedMilliseconds(closedPresence, overtimeWindows, leaveWindows);
  // Preserve rounding of the combined total, rather than each component.
  const overtimeMinutes = Math.floor((regularMs + overtimeMs) / 60000) - regularMinutes;
  const provisionalOvertimeMs = workedMilliseconds(presence, overtimeWindows, leaveWindows);
  const violationList = [...new Set(violationDetails.map((v) => v.event))];
  return {
    scheduledMinutes,
    regularMinutes,
    overtimeMinutes,
    provisionalMinutes: Math.floor((regularMs + provisionalOvertimeMs) / 60000),
    deductedMinutes: Math.floor(totalDeductedMs / 60000),
    exitCount,
    violations: violationList,
    anomalies: violationList,
    violationDetails,
  };
}
