import { describe, expect, it } from 'vitest';
import { participationDates } from './participation-dates';

describe('participation date boundaries', () => {
  it('covers the entire selected local day, including the same-day case', () => {
    const range = participationDates('2026-10-27', '2026-10-27');
    expect(new Date(range.validFrom)).toEqual(new Date(2026, 9, 27));
    expect(new Date(range.validUntil!)).toEqual(new Date(2026, 9, 28));
  });

  it('keeps an open end and handles month transitions', () => {
    expect(participationDates('2026-01-31', '').validUntil).toBeNull();
    expect(new Date(participationDates('2026-01-31', '2026-01-31').validUntil!)).toEqual(
      new Date(2026, 1, 1),
    );
  });
});
