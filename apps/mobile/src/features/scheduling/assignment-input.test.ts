import { expect, it } from 'vitest';
import { assignmentEndDate } from './assignment-input';

it('calculates day and week end dates', () => {
  expect(assignmentEndDate('DAY', '2026-11-16', '')).toBe('2026-11-16');
  expect(assignmentEndDate('WEEK', '2026-11-16', '')).toBe('2026-11-22');
  expect(assignmentEndDate('REPEAT', '2026-11-10', '2026-11-12')).toBe('2026-11-12');
});
