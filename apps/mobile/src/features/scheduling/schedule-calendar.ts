import type { ShiftResponse } from '@smartsite/api-client';

export function calendarDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

export function addCalendarDays(value: string, days: number): string {
  const date = calendarDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function calendarWeek(value: string): string[] {
  const weekday = calendarDate(value).getUTCDay();
  const monday = addCalendarDays(value, -((weekday + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => addCalendarDays(monday, index));
}

export function changeCalendarMonth(value: string, year: number, month: number): string {
  const day = calendarDate(value).getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

export function shiftClock(shift: ShiftResponse, edge: 'start' | 'end'): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: shift.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(edge === 'start' ? shift.startsAt : shift.endsAt));
}

export function shiftDayOffset(shift: ShiftResponse): number {
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone: shift.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const day = (value: string) => {
    const parts = format.formatToParts(new Date(value));
    const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value;
    return Date.UTC(Number(read('year')), Number(read('month')) - 1, Number(read('day')));
  };
  return Math.round((day(shift.endsAt) - day(shift.startsAt)) / 86400000);
}
