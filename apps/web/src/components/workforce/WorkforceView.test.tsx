import { describe, it, expect } from 'vitest';
import { getWorkforceTabs } from './WorkforceView';

describe('WorkforceView - getWorkforceTabs', () => {
  it('Worker sees only Worker actions', () => {
    const tabs = getWorkforceTabs(['WORKER']);
    expect(tabs.showSchedule).toBe(true);
    expect(tabs.showReview).toBe(false);
    expect(tabs.defaultTab).toBe('schedule');
  });

  it('Contractor Representative sees Contractor actions', () => {
    const tabs = getWorkforceTabs(['CONTRACTOR_REPRESENTATIVE']);
    expect(tabs.showSchedule).toBe(true);
    expect(tabs.showReview).toBe(false);
    expect(tabs.defaultTab).toBe('schedule');
  });

  it('Site Manager sees review actions', () => {
    const tabs = getWorkforceTabs(['SITE_MANAGER']);
    expect(tabs.showSchedule).toBe(false);
    expect(tabs.showReview).toBe(true);
    expect(tabs.defaultTab).toBe('review');
  });

  it('Admin without manager role defaults to schedule tab', () => {
    const tabs = getWorkforceTabs(['ADMIN']);
    expect(tabs.showSchedule).toBe(false);
    expect(tabs.showReview).toBe(false);
    expect(tabs.defaultTab).toBe('schedule');
  });

  it('Multiple roles combines visibility correctly', () => {
    const tabs = getWorkforceTabs(['WORKER', 'SITE_MANAGER']);
    expect(tabs.showSchedule).toBe(true);
    expect(tabs.showReview).toBe(true);
    expect(tabs.defaultTab).toBe('review');
  });

  // ── Hard-refresh / empty-cache behaviour ─────────────────────────────────────
  // After F5, TanStack Query starts with an empty in-memory cache.
  // WorkforceView must NOT call useQuery(['auth','session']) without a queryFn
  // (which logs a TanStack warning and returns undefined forever).
  // Instead it calls useCurrentUser → GET /auth/me once accessToken is restored.
  // The role-tab logic must degrade gracefully to an empty-role state.

  it('empty roleAssignments (hard-refresh: user not yet fetched) shows no tabs', () => {
    // Simulate the transient state while /auth/me is in-flight: roles = []
    const tabs = getWorkforceTabs([]);
    expect(tabs.showSchedule).toBe(false);
    expect(tabs.showReview).toBe(false);
    // defaultTab falls through to 'schedule' — component will show the no-access
    // banner instead of rendering a tab with an empty role list.
    expect(tabs.defaultTab).toBe('schedule');
  });

  it('unknown role produces no visible tabs', () => {
    const tabs = getWorkforceTabs(['SAFETY_OFFICER']);
    expect(tabs.showSchedule).toBe(false);
    expect(tabs.showReview).toBe(false);
  });
});
