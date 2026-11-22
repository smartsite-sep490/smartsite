import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import {
  LEAVE_NOTICE_HOURS,
  scheduledShiftWindow,
  timeRequestTimingIssue,
  TIME_REQUEST_TIMING_MESSAGES,
  type LeaveNoticeType,
  type ShiftResponse,
  type WorkerScheduleResponse,
  type TimeRequestTimingIssue,
} from '@smartsite/api-client';
import { localizeMessage } from '../../i18n/messages';

export function requestScheduleIssue(
  workDate: string,
  shift: ShiftResponse | undefined,
  kind: 'LEAVE' | 'OVERTIME',
  noticeType: LeaveNoticeType,
  now = new Date(),
): TimeRequestTimingIssue | null {
  if (!shift) return 'SHIFT_TIME_UNAVAILABLE';
  try {
    return timeRequestTimingIssue(
      {
        ...scheduledShiftWindow(
          {
            startsAt: new Date(shift.startsAt),
            endsAt: new Date(shift.endsAt),
            timezone: shift.timezone,
          },
          workDate,
        ),
        timezone: shift.timezone,
      },
      kind,
      noticeType,
      now,
    );
  } catch {
    return 'SHIFT_TIME_UNAVAILABLE';
  }
}

export const requestTimingMessage = (issue: TimeRequestTimingIssue) =>
  localizeMessage(TIME_REQUEST_TIMING_MESSAGES[issue]);

/** Update at submission cutoffs, on foreground, and across local date changes. */
export function useEligibleTimeSchedules(
  schedules: readonly WorkerScheduleResponse[],
  shifts: readonly ShiftResponse[],
  kind: 'LEAVE' | 'OVERTIME',
  noticeType: LeaveNoticeType,
) {
  const [now, setNow] = useState(() => Date.now());
  let nextChange = now + 30000;
  for (const schedule of schedules) {
    const shift = shifts.find((s) => s.id === schedule.shiftId);
    if (!shift) continue;
    try {
      const window = scheduledShiftWindow(
        {
          startsAt: new Date(shift.startsAt),
          endsAt: new Date(shift.endsAt),
          timezone: shift.timezone,
        },
        schedule.workDate,
      );
      for (const boundary of [
        +window.startsAt,
        +window.endsAt,
        +window.startsAt - LEAVE_NOTICE_HOURS * 3600000 + 1,
      ])
        if (boundary > now) nextChange = Math.min(nextChange, boundary);
    } catch {
      /* Unavailable shifts are excluded below. */
    }
  }
  useEffect(() => {
    const timer = setTimeout(() => setNow(Date.now()), Math.max(1, nextChange - Date.now()));
    return () => clearTimeout(timer);
  }, [nextChange]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNow(Date.now());
    });
    return () => subscription.remove();
  }, []);
  return {
    now: new Date(now),
    eligible: schedules.filter(
      (s) =>
        s.isActive &&
        !requestScheduleIssue(
          s.workDate,
          shifts.find((shift) => shift.id === s.shiftId),
          kind,
          noticeType,
          new Date(now),
        ),
    ),
  };
}
