/** Planned leave must be submitted this many hours before the assigned shift. */
export const LEAVE_NOTICE_HOURS = 24;
export type LeaveNoticeType = 'PLANNED' | 'EMERGENCY';

export const TIME_REQUEST_TIMING_MESSAGES = {
  SHIFT_ENDED: 'Requests cannot be submitted for a shift that has ended.',
  PLANNED_NOTICE_REQUIRED: 'Planned leave requires at least 24 hours before the shift starts.',
  EMERGENCY_TODAY_ONLY: 'Emergency leave is only available for shifts taking place today.',
  SHIFT_TIME_UNAVAILABLE: 'Shift times are unavailable. Reload the schedule and try again.',
} as const;
export type TimeRequestTimingIssue = keyof typeof TIME_REQUEST_TIMING_MESSAGES;

/** Submission eligibility only; existing requests and their review history remain valid. */
export function timeRequestTimingIssue(
  shift: { startsAt: Date; endsAt: Date; timezone: string },
  kind: 'LEAVE' | 'OVERTIME',
  noticeType: LeaveNoticeType = 'PLANNED',
  submittedAt = new Date(),
): TimeRequestTimingIssue | null {
  if (
    ![+shift.startsAt, +shift.endsAt, +submittedAt].every(Number.isFinite) ||
    shift.endsAt <= shift.startsAt
  )
    return 'SHIFT_TIME_UNAVAILABLE';
  if (shift.endsAt <= submittedAt) return 'SHIFT_ENDED';
  if (kind === 'OVERTIME') return null;
  if (noticeType === 'PLANNED')
    return +shift.startsAt - +submittedAt >= LEAVE_NOTICE_HOURS * 3600000
      ? null
      : 'PLANNED_NOTICE_REQUIRED';
  if (noticeType !== 'EMERGENCY') return 'SHIFT_TIME_UNAVAILABLE';
  try {
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: shift.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    // An overnight shift that is still running also takes place today.
    return shift.startsAt <= submittedAt || date.format(shift.startsAt) === date.format(submittedAt)
      ? null
      : 'EMERGENCY_TODAY_ONLY';
  } catch {
    return 'SHIFT_TIME_UNAVAILABLE';
  }
}

export function leaveNotice(
  shiftStartsAt: Date,
  noticeType: LeaveNoticeType = 'PLANNED',
  submittedAt = new Date(),
) {
  if (!Number.isFinite(+shiftStartsAt) || !Number.isFinite(+submittedAt))
    throw new RangeError('Invalid leave notice time');
  return {
    noticeType,
    shortNotice: +shiftStartsAt - +submittedAt < LEAVE_NOTICE_HOURS * 3600000,
  };
}
