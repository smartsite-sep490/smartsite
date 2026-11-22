// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import type { SmartSiteManagementClient } from '@smartsite/api-client';
import type { ShiftResponse, WorkerScheduleResponse } from '@smartsite/contracts';
import {
  attendanceRequestSchedules,
  useAttendanceRequestEligibility,
} from './useAttendanceRequestEligibility';

const shift = {
  id: 'day',
  siteId: 'site',
  name: 'Morning',
  startsAt: '2026-10-08T01:00:00Z',
  endsAt: '2026-10-08T10:00:00Z',
  timezone: 'Asia/Ho_Chi_Minh',
  createdAt: '2026-10-01T00:00:00Z',
} satisfies ShiftResponse;
const schedule = (workDate: string, shiftId = 'day') =>
  ({
    id: workDate + shiftId,
    workDate,
    shiftId,
    isActive: true,
  }) as WorkerScheduleResponse;
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it('accepts exactly 24 hours notice and excludes planned leave one millisecond later', () => {
  const schedules = [schedule('2030-10-09')];
  expect(
    attendanceRequestSchedules(
      schedules,
      [shift],
      'LEAVE',
      'PLANNED',
      new Date('2030-10-08T01:00:00Z'),
    ),
  ).toHaveLength(1);
  expect(
    attendanceRequestSchedules(
      schedules,
      [shift],
      'LEAVE',
      'PLANNED',
      new Date('2030-10-08T01:00:00.001Z'),
    ),
  ).toHaveLength(0);
});

it('includes ongoing overnight emergency leave and excludes ended, future-day and invalid shifts', () => {
  const night = {
    ...shift,
    id: 'night',
    startsAt: '2026-10-08T15:00:00Z',
    endsAt: '2026-10-09T01:00:00Z',
  };
  const schedules = [
    schedule('2030-10-07', 'night'),
    schedule('2030-10-08'),
    schedule('2030-10-09'),
    schedule('2030-10-07'),
    { ...schedule('2030-10-08'), isActive: false },
  ];
  const eligible = attendanceRequestSchedules(
    schedules,
    [shift, night],
    'LEAVE',
    'EMERGENCY',
    new Date('2030-10-08T00:30:00Z'),
  );
  expect(eligible.map((e) => e.schedule.id)).toEqual(['2030-10-07night', '2030-10-08day']);
  expect(
    attendanceRequestSchedules(
      [schedule('2030-10-07', 'night')],
      [night],
      'LEAVE',
      'EMERGENCY',
      new Date('2030-10-08T01:00:00Z'),
    ),
  ).toHaveLength(0);
  expect(
    attendanceRequestSchedules(
      [schedule('2030-10-08')],
      [{ ...shift, timezone: 'invalid' }],
      'LEAVE',
      'EMERGENCY',
      new Date('2030-10-08T00:30:00Z'),
    ),
  ).toHaveLength(0);
});

it('does not offer overtime for a shift ended earlier today and keeps future shifts', () => {
  expect(
    attendanceRequestSchedules(
      [schedule('2030-10-08'), schedule('2030-10-09')],
      [shift],
      'OVERTIME',
      'PLANNED',
      new Date('2030-10-08T10:00:00Z'),
    ).map((e) => e.schedule.workDate),
  ).toEqual(['2030-10-09']);
});

it('updates a planned deadline at +1ms, refreshes on foreground and isolates availability by Site', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2030-10-08T01:00:00Z'));
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const response = {
    items: [],
    total: 0,
    serverTime: new Date().toISOString(),
    leaveAvailableAt: null,
  };
  cache.setQueryData(['attendance-leave-availability', 'api', 'user', 'site'], response);
  const client = {
    myWorkerRequests: vi.fn().mockResolvedValue(response),
  } as unknown as SmartSiteManagementClient;
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={cache}>{children}</QueryClientProvider>
  );
  const { result, rerender, unmount } = renderHook(
    ({ siteId }) =>
      useAttendanceRequestEligibility({
        client,
        apiUrl: 'api',
        token: 'token',
        siteId,
        sessionScope: 'user',
        enabled: true,
        schedules: [schedule('2030-10-09')],
        shifts: [shift],
        kind: 'LEAVE',
        noticeType: 'PLANNED',
      }),
    { wrapper, initialProps: { siteId: 'site' } },
  );
  expect(result.current.availableSchedules).toHaveLength(1);
  act(() => vi.advanceTimersByTime(1));
  expect(result.current.availableSchedules).toHaveLength(0);
  act(() => window.dispatchEvent(new Event('focus')));
  expect(client.myWorkerRequests).toHaveBeenCalledWith('token', 'site', { limit: 1 });
  rerender({ siteId: 'other-site' });
  expect(result.current.ready).toBe(false);
  unmount();
  cache.clear();
});

it('unlocks leave at the server deadline despite a different device clock', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2030-10-01T00:00:00Z'));
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const response = {
    items: [],
    total: 0,
    serverTime: '2030-10-08T00:00:00Z',
    leaveAvailableAt: '2030-10-08T00:00:00.010Z',
  };
  cache.setQueryData(['attendance-leave-availability', 'api', 'user', 'site'], response);
  const client = {
    myWorkerRequests: vi.fn().mockResolvedValue(response),
  } as unknown as SmartSiteManagementClient;
  const { result, unmount } = renderHook(
    () =>
      useAttendanceRequestEligibility({
        client,
        apiUrl: 'api',
        token: 'token',
        siteId: 'site',
        sessionScope: 'user',
        enabled: true,
        schedules: [],
        shifts: [],
        kind: 'LEAVE',
        noticeType: 'PLANNED',
      }),
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={cache}>{children}</QueryClientProvider>
      ),
    },
  );
  expect(result.current.locked).toBe(true);
  act(() => vi.advanceTimersByTime(10));
  expect(result.current.locked).toBe(false);
  unmount();
  cache.clear();
});
