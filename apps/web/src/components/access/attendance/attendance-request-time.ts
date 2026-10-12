import type { ShiftResponse } from '@smartsite/contracts';
import { attendanceDate } from './attendance-display';

function wallTime(date: Date, timezone: string) {
  const clock = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(date);
  return `${attendanceDate(date, timezone)}T${clock}`;
}

/** Form values are local to the selected shift, never implicitly device-local. */
export function requestTimeInstant(value: string, timezone: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Select a date and time.');
  const wall = `${value}:00`;
  const target = Date.parse(`${wall}Z`);
  if (!Number.isFinite(target) || new Date(target).toISOString().slice(0, 19) !== wall)
    throw new Error('Invalid request date or time.');
  let candidate = target;
  for (let i = 0; i < 4; i++)
    candidate += target - Date.parse(`${wallTime(new Date(candidate), timezone)}Z`);
  const matches = [
    candidate,
    candidate - 3600000,
    candidate + 3600000,
    candidate - 7200000,
    candidate + 7200000,
  ].filter((v) => wallTime(new Date(v), timezone) === wall);
  if (!matches.length) throw new Error('This time does not exist in the shift timezone.');
  return new Date(Math.min(...matches));
}

export function requestShiftTimes(workDate: string, shift: ShiftResponse) {
  const start = new Date(shift.startsAt),
    end = new Date(shift.endsAt);
  if (!(end > start)) throw new Error('Shift hours unavailable.');
  const offset =
    Date.parse(`${attendanceDate(end, shift.timezone)}T00:00:00Z`) -
    Date.parse(`${attendanceDate(start, shift.timezone)}T00:00:00Z`);
  const endsDate = new Date(Date.parse(`${workDate}T00:00:00Z`) + offset)
    .toISOString()
    .slice(0, 10);
  const startsAt = `${workDate}T${wallTime(start, shift.timezone).slice(11, 16)}`;
  const endsAt = `${endsDate}T${wallTime(end, shift.timezone).slice(11, 16)}`;
  requestTimeInstant(startsAt, shift.timezone);
  requestTimeInstant(endsAt, shift.timezone);
  return { startsAt, endsAt };
}

export const requestWallTime = (date: Date, timezone: string) =>
  wallTime(date, timezone).slice(0, 16);
