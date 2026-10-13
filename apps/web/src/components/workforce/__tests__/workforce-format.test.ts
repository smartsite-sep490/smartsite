import { expect, it } from 'vitest';
import { formatShiftRange } from '../utils/workforce-format';

it('uses the shift timezone and marks the actual local calendar transition', () => {
  expect(formatShiftRange('2030-10-07T08:00:00Z', '2030-10-07T17:00:00Z', 'UTC')).toBe(
    '08:00 - 17:00',
  );
  expect(formatShiftRange('2030-10-07T11:00:00Z', '2030-10-08T05:00:00Z', 'Asia/Ho_Chi_Minh')).toBe(
    '18:00 - 12:00 (next day)',
  );
  // A UTC date transition is not necessarily a local date transition.
  expect(formatShiftRange('2030-10-07T23:00:00Z', '2030-10-08T02:00:00Z', 'Asia/Ho_Chi_Minh')).toBe(
    '06:00 - 09:00',
  );
});
