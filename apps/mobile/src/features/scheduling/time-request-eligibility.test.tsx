import { afterEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { ShiftResponse, WorkerScheduleResponse } from '@smartsite/api-client';
import { requestScheduleIssue, useEligibleTimeSchedules } from './time-request-eligibility';

const shift: ShiftResponse = {
  id: 'shift',
  siteId: 'site',
  name: 'Morning',
  startsAt: '2026-01-01T01:00:00Z',
  endsAt: '2026-01-01T10:00:00Z',
  timezone: 'Asia/Ho_Chi_Minh',
  createdAt: '',
};
const schedule: WorkerScheduleResponse = {
  id: 'schedule',
  siteId: 'site',
  workerId: 'worker',
  shiftId: 'shift',
  scheduleVersionId: 'version',
  workDate: '2026-11-21',
  isActive: true,
  createdAt: '',
};
let root: ReactTestRenderer | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  vi.useRealTimers();
});

it('removes planned leave one millisecond after the inclusive 24-hour deadline without reopening', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-20T01:00:00Z'));
  let ids: string[] = [];
  function Probe() {
    ids = useEligibleTimeSchedules([schedule], [shift], 'LEAVE', 'PLANNED').eligible.map(
      (s) => s.id,
    );
    return null;
  }
  await act(async () => {
    root = create(createElement(Probe));
  });
  expect(ids).toEqual(['schedule']);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(ids).toEqual([]);
});
it('removes the current shift at its exact end for overtime', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-21T09:59:59.999Z'));
  let ids: string[] = [];
  function Probe() {
    ids = useEligibleTimeSchedules([schedule], [shift], 'OVERTIME', 'PLANNED').eligible.map(
      (s) => s.id,
    );
    return null;
  }
  await act(async () => {
    root = create(createElement(Probe));
  });
  expect(ids).toEqual(['schedule']);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(ids).toEqual([]);
});
it('fails closed when schedule times are missing and uses the assigned timezone', () => {
  expect(requestScheduleIssue(schedule.workDate, undefined, 'LEAVE', 'PLANNED')).toBe(
    'SHIFT_TIME_UNAVAILABLE',
  );
  expect(
    requestScheduleIssue(
      schedule.workDate,
      shift,
      'LEAVE',
      'EMERGENCY',
      new Date('2026-11-20T17:00:00Z'),
    ),
  ).toBeNull();
});
