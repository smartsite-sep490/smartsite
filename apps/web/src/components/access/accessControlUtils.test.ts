import { describe, expect, it } from 'vitest';
import { grantState, toUtcIso, zoneDecisionLabel } from './accessControlUtils';

describe('access control presentation rules', () => {
  it('classifies revoked, scheduled, active, and expired grants', () => {
    const now = new Date('2026-09-28T12:00:00.000Z');
    expect(
      grantState(
        {
          validFrom: '2026-09-28T10:00:00.000Z',
          validUntil: null,
          revokedAt: '2026-09-28T11:00:00.000Z',
        },
        now,
      ),
    ).toBe('REVOKED');
    expect(
      grantState({ validFrom: '2026-09-28T13:00:00.000Z', validUntil: null, revokedAt: null }, now),
    ).toBe('SCHEDULED');
    expect(
      grantState(
        {
          validFrom: '2026-09-28T10:00:00.000Z',
          validUntil: '2026-09-28T13:00:00.000Z',
          revokedAt: null,
        },
        now,
      ),
    ).toBe('ACTIVE');
    expect(
      grantState(
        {
          validFrom: '2026-09-28T10:00:00.000Z',
          validUntil: '2026-09-28T11:00:00.000Z',
          revokedAt: null,
        },
        now,
      ),
    ).toBe('EXPIRED');
  });

  it('uses explicit user-facing labels for fail-closed decisions', () => {
    expect(zoneDecisionLabel('ALLOWED')).toBe('Allowed');
    expect(zoneDecisionLabel('DENIED')).toBe('Denied');
    expect(zoneDecisionLabel('UNAVAILABLE')).toBe('Authorization unavailable');
  });

  it('converts datetime-local values to RFC 3339 UTC and preserves empty optional values', () => {
    expect(toUtcIso('')).toBeNull();
    expect(toUtcIso('2026-09-28T12:30')).toMatch(/^2026-09-28T\d{2}:30:00\.000Z$/);
  });
});
