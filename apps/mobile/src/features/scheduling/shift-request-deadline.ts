import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { isShiftStarted, scheduledShiftWindow, type ShiftResponse } from '@smartsite/api-client';

type ShiftClock = Pick<ShiftResponse, 'startsAt' | 'endsAt' | 'timezone'>;

export function shiftRequestLocked(
  workDate: string,
  shift?: ShiftClock,
  now = new Date(),
): boolean {
  if (!shift) return true;
  try {
    return isShiftStarted(workDate, shift, now);
  } catch {
    return true;
  }
}

/** Refresh at the boundary and when the app returns from the background. */
export function useShiftRequestLocked(workDate: string, shift?: ShiftClock): boolean {
  const [now, setNow] = useState(() => Date.now());
  let start: number | null = null;
  try {
    if (shift)
      start = +scheduledShiftWindow(
        {
          startsAt: new Date(shift.startsAt),
          endsAt: new Date(shift.endsAt),
          timezone: shift.timezone,
        },
        workDate,
      ).startsAt;
  } catch {
    /* Unknown dates remain locked. */
  }
  useEffect(() => {
    if (start === null || start <= now) return;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, Math.min(start - Date.now(), 2147483647)),
    );
    return () => clearTimeout(timer);
  }, [start, now]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', () => setNow(Date.now()));
    return () => subscription.remove();
  }, []);
  return shiftRequestLocked(workDate, shift, new Date(now));
}
