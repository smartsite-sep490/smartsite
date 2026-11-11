import { expect, it } from 'vitest';
import type { ShiftResponse } from '@smartsite/api-client';
import {
  addCalendarDays,
  calendarWeek,
  changeCalendarMonth,
  shiftClock,
  shiftDayOffset,
  shiftRange,
} from './schedule-calendar';

it('keeps a Monday-to-Sunday week intact across month and year boundaries', () => {
  expect(calendarWeek('2027-01-01')).toEqual([
    '2026-12-28',
    '2026-12-29',
    '2026-12-30',
    '2026-12-31',
    '2027-01-01',
    '2027-01-02',
    '2027-01-03',
  ]);
  expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01');
});

it('clamps month selection to the last real day, including leap years', () => {
  expect(changeCalendarMonth('2026-01-31', 2026, 1)).toBe('2026-02-28');
  expect(changeCalendarMonth('2026-01-31', 2028, 1)).toBe('2028-02-29');
});

it('displays a night shift in its configured timezone and marks its following day', () => {
  const shift: ShiftResponse = {
    id: 'night',
    siteId: 'site',
    name: 'Night',
    startsAt: '2026-11-20T15:00:00Z',
    endsAt: '2026-11-20T23:00:00Z',
    timezone: 'Asia/Ho_Chi_Minh',
    createdAt: '',
  };
  expect(shiftClock(shift, 'start')).toBe('22:00');
  expect(shiftClock(shift, 'end')).toBe('06:00');
  expect(shiftDayOffset(shift)).toBe(1);
  expect(shiftRange(shift)).toBe('22:00 – 06:00');
});
