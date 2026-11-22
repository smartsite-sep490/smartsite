import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LEAVE_NOTICE_HOURS,
  timeRequestTimingIssue,
  type LeaveNoticeType,
} from '@smartsite/contracts/leave-notice';
import { scheduledShiftWindow } from '@smartsite/contracts/scheduled-shift';
import type { ShiftResponse, WorkerScheduleResponse } from '@smartsite/contracts';
import type { SmartSiteManagementClient } from '@smartsite/api-client';
import { requestShiftTimes } from './attendance-request-time';

export function attendanceRequestSchedules(
  schedules: readonly WorkerScheduleResponse[],
  shifts: readonly ShiftResponse[],
  kind: 'OVERTIME' | 'LEAVE',
  noticeType: LeaveNoticeType,
  now: Date,
) {
  return schedules
    .flatMap((schedule) => {
      const shift = shifts.find((item) => item.id === schedule.shiftId);
      if (!schedule.isActive || !shift) return [];
      try {
        const window = scheduledShiftWindow(
          {
            timezone: shift.timezone,
            startsAt: new Date(shift.startsAt),
            endsAt: new Date(shift.endsAt),
          },
          schedule.workDate,
        );
        if (timeRequestTimingIssue({ ...window, timezone: shift.timezone }, kind, noticeType, now))
          return [];
        return [{ schedule, shift, ...requestShiftTimes(schedule.workDate, shift), window }];
      } catch {
        return [];
      }
    })
    .sort((a, b) => +a.window.startsAt - +b.window.startsAt);
}

export function useAttendanceRequestEligibility({
  client,
  apiUrl,
  token,
  siteId,
  sessionScope,
  enabled,
  schedules,
  shifts,
  kind,
  noticeType,
}: {
  client: SmartSiteManagementClient;
  apiUrl: string;
  token: string;
  siteId: string;
  sessionScope: string;
  enabled: boolean;
  schedules: readonly WorkerScheduleResponse[];
  shifts: readonly ShiftResponse[];
  kind: 'OVERTIME' | 'LEAVE';
  noticeType: LeaveNoticeType;
}) {
  const active = enabled && kind === 'LEAVE';
  const availability = useQuery({
    queryKey: ['attendance-leave-availability', apiUrl, sessionScope, siteId],
    queryFn: () => client.myWorkerRequests(token, siteId, { limit: 1 }),
    enabled: active,
    refetchInterval: active ? 15000 : false,
    staleTime: 0,
  });
  const [clock, setClock] = useState(() => Date.now());
  const serverTime = Date.parse(availability.data?.serverTime ?? '');
  const availableAt = availability.data?.leaveAvailableAt;
  const validAvailability =
    Number.isFinite(serverTime) &&
    (availableAt === null ||
      (typeof availableAt === 'string' && Number.isFinite(Date.parse(availableAt))));
  const instantAt = (localTime: number) =>
    new Date(
      validAvailability
        ? serverTime + Math.max(0, localTime - availability.dataUpdatedAt)
        : localTime,
    );
  const now = instantAt(clock);
  const availableSchedules = attendanceRequestSchedules(schedules, shifts, kind, noticeType, now);
  let delay = 30000;
  const boundaries: number[] = availableAt ? [Date.parse(availableAt)] : [];
  for (const schedule of schedules) {
    const shift = shifts.find((item) => item.id === schedule.shiftId);
    if (!shift || !schedule.isActive) continue;
    try {
      const window = scheduledShiftWindow(
        {
          timezone: shift.timezone,
          startsAt: new Date(shift.startsAt),
          endsAt: new Date(shift.endsAt),
        },
        schedule.workDate,
      );
      boundaries.push(
        +window.startsAt,
        +window.endsAt,
        +window.startsAt - LEAVE_NOTICE_HOURS * 3600000 + 1,
      );
    } catch {
      // Malformed or unavailable shift windows are excluded from the choices.
    }
  }
  for (const boundary of boundaries) if (boundary > +now) delay = Math.min(delay, boundary - +now);
  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(
      () => setClock(Date.now()),
      Math.max(1, delay - Math.max(0, Date.now() - clock)),
    );
    return () => clearTimeout(timer);
  }, [enabled, delay, clock, availability.dataUpdatedAt]);
  const { refetch } = availability;
  useEffect(() => {
    if (!enabled) return;
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      setClock(Date.now());
      if (active) void refetch();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [enabled, active, refetch]);
  return {
    availableSchedules,
    availability,
    availableAt,
    ready:
      !active ||
      (availability.isSuccess &&
        !availability.isFetching &&
        !availability.isRefetchError &&
        validAvailability),
    locked: active && !!availableAt && Date.parse(availableAt) > +now,
    getNow: () => instantAt(Date.now()),
  };
}
