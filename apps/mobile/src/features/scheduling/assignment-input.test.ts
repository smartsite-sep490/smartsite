import { expect, it } from 'vitest';
import { assignmentEndDate, matchingVersions } from './assignment-input';

it('calculates day and week end dates', () => {
  expect(assignmentEndDate('DAY', '2026-11-16', '')).toBe('2026-11-16');
  expect(assignmentEndDate('WEEK', '2026-11-16', '')).toBe('2026-11-22');
  expect(assignmentEndDate('REPEAT', '2026-11-10', '2026-11-12')).toBe('2026-11-12');
});

it('selects versions covering the entire date range with an exclusive end', () => {
  const versions = [
    { id: 'old', effectiveFrom: '2026-01-01', effectiveUntil: '2026-11-20' },
    { id: 'current', effectiveFrom: '2026-11-01', effectiveUntil: '2027-01-01' },
  ];
  expect(matchingVersions(versions, '2026-11-16', '2026-11-22').map((v) => v.id)).toEqual([
    'current',
  ]);
});
