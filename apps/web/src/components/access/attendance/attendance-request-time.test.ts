import { expect, it } from 'vitest';
import type { ShiftResponse } from '@smartsite/contracts';
import { requestShiftTimes, requestTimeInstant } from './attendance-request-time';

it('sends selected shift-local hours as UTC independently of device timezone', () => {
  expect(requestTimeInstant('2030-10-08T17:30', 'Asia/Ho_Chi_Minh').toISOString()).toBe(
    '2030-10-08T10:30:00.000Z',
  );
  expect(requestTimeInstant('2030-10-08T17:30', 'America/New_York').toISOString()).toBe(
    '2030-10-08T21:30:00.000Z',
  );
});

it('preserves the assigned date and next-day ending for overnight templates', () => {
  const shift: ShiftResponse = {
    id: 'shift',
    siteId: 'site',
    name: 'Night',
    startsAt: '2026-10-08T15:00:00Z',
    endsAt: '2026-10-09T01:00:00Z',
    timezone: 'Asia/Ho_Chi_Minh',
    createdAt: '2026-10-08T00:00:00Z',
  };
  expect(requestShiftTimes('2030-10-08', shift)).toEqual({
    startsAt: '2030-10-08T22:00',
    endsAt: '2030-10-09T08:00',
  });
});

it('rejects malformed, invalid and nonexistent local dates instead of silently shifting them', () => {
  expect(() => requestTimeInstant('', 'Asia/Ho_Chi_Minh')).toThrow();
  expect(() => requestTimeInstant('2030-02-30T17:00', 'Asia/Ho_Chi_Minh')).toThrow();
  expect(() => requestTimeInstant('2026-03-08T02:30', 'America/New_York')).toThrow(
    /does not exist/,
  );
});
