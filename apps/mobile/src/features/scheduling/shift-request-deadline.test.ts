import { expect, it } from 'vitest';
import { shiftRequestLocked } from './shift-request-deadline';

it('locks at the scheduled start and fails closed for unavailable shift data', () => {
  const shift = {
    startsAt: '2026-01-01T01:00:00Z',
    endsAt: '2026-01-01T10:00:00Z',
    timezone: 'Asia/Ho_Chi_Minh',
  };
  expect(shiftRequestLocked('2030-01-01', shift, new Date('2030-01-01T00:59:59.999Z'))).toBe(false);
  expect(shiftRequestLocked('2030-01-01', shift, new Date('2030-01-01T01:00:00Z'))).toBe(true);
  expect(shiftRequestLocked('2030-01-01', undefined)).toBe(true);
  expect(shiftRequestLocked('2030-02-30', shift)).toBe(true);
});
