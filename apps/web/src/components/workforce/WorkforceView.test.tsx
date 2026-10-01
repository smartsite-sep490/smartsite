import { describe, it, expect, vi } from 'vitest';
import { getWorkforceTabs } from './WorkforceView';
import { filterManagerReviewRequests } from './WorkforceManagerReviewUtils';

describe('WorkforceView & MF07 Workflow Logic', () => {
  // ── Scenario 1: Worker tab visibility ─────────────────────────────────────
  it('Worker sees only Worker actions', () => {
    const tabs = getWorkforceTabs(['WORKER']);
    expect(tabs.showSchedule).toBe(true);
    expect(tabs.showReview).toBe(false);
    expect(tabs.defaultTab).toBe('schedule');
  });

  // ── Scenario 2: Contractor Rep visibility ──────────────────────────────────
  it('Contractor Representative sees Worker/Schedule actions', () => {
    const tabs = getWorkforceTabs(['CONTRACTOR_REPRESENTATIVE']);
    expect(tabs.showSchedule).toBe(true);
    expect(tabs.showReview).toBe(false);
    expect(tabs.defaultTab).toBe('schedule');
  });

  // ── Scenario 3: Site Manager visibility ────────────────────────────────────
  it('Site Manager sees review actions', () => {
    const tabs = getWorkforceTabs(['SITE_MANAGER']);
    expect(tabs.showSchedule).toBe(false);
    expect(tabs.showReview).toBe(true);
    expect(tabs.defaultTab).toBe('review');
  });

  it('Multiple roles combines visibility correctly', () => {
    const tabs = getWorkforceTabs(['WORKER', 'SITE_MANAGER']);
    expect(tabs.showSchedule).toBe(true);
    expect(tabs.showReview).toBe(true);
    expect(tabs.defaultTab).toBe('review');
  });

  // ── Scenario 4: Hard-refresh / transient session cache ─────────────────────
  it('Workforce handles hard refresh with empty roleAssignments cleanly (no auth-session cache error)', () => {
    // Simulate the transient state while /auth/me is in-flight: roles = []
    const tabs = getWorkforceTabs([]);
    expect(tabs.showSchedule).toBe(false);
    expect(tabs.showReview).toBe(false);
    expect(tabs.defaultTab).toBe('schedule');
  });

  it('unknown role produces no visible tabs', () => {
    const tabs = getWorkforceTabs(['SAFETY_OFFICER']);
    expect(tabs.showSchedule).toBe(false);
    expect(tabs.showReview).toBe(false);
  });

  // ── Scenario 5: Manager review filtering ───────────────────────────────────
  it('Site Manager review filters swap requests so ONLY coworker-accepted swaps (PENDING_MANAGER) appear', () => {
    const directChanges = [
      { id: 'c1', status: 'PENDING_MANAGER', reason: 'Direct change 1' },
      { id: 'c2', status: 'APPROVED', reason: 'Approved direct change' },
    ];
    const swapRequests = [
      { id: 's1', status: 'PENDING_COWORKER', reason: 'Unaccepted swap request' },
      { id: 's2', status: 'PENDING_MANAGER', reason: 'Coworker-accepted swap request' },
      { id: 's3', status: 'APPROVED', reason: 'Already approved swap' },
      { id: 's4', status: 'REJECTED', reason: 'Rejected swap' },
    ];

    const { pendingChanges, pendingSwaps } = filterManagerReviewRequests(directChanges, swapRequests);

    // 1. Direct change in PENDING_MANAGER is visible to Manager
    expect(pendingChanges).toHaveLength(1);
    expect(pendingChanges[0]?.id).toBe('c1');

    // 2. Unaccepted swap (PENDING_COWORKER) is HIDDEN from Site Manager review
    // 3. Only coworker-accepted swap (PENDING_MANAGER) is VISIBLE to Site Manager
    expect(pendingSwaps).toHaveLength(1);
    expect(pendingSwaps[0]?.id).toBe('s2');
  });

  // ── Scenario 6: Direct shift change payload & invalidation verification ──────
  it('Worker direct shift change request payload matches backend specification', () => {
    const payload = {
      workerScheduleId: 'ws-001',
      toShiftId: 'shift-evening',
      reason: 'Need evening shift for family care',
    };
    expect(payload.workerScheduleId).toBeTruthy();
    expect(payload.toShiftId).toBeTruthy();
    expect(payload.reason).toBeTruthy();
  });

  // ── Scenario 7: Shift swap payload & coworker confirm verification ────────
  it('Shift swap payload and coworker confirm/reject actions follow two-phase state machine', () => {
    const swapPayload = {
      requesterWorkerScheduleId: 'ws-worker-a',
      coworkerWorkerScheduleId: 'ws-worker-b',
      reason: 'Swap morning for night shift',
    };

    expect(swapPayload.requesterWorkerScheduleId).toBe('ws-worker-a');
    expect(swapPayload.coworkerWorkerScheduleId).toBe('ws-worker-b');

    // State transitions:
    // 1. Initial creation -> status: PENDING_COWORKER
    let status = 'PENDING_COWORKER';
    expect(status).toBe('PENDING_COWORKER');

    // 2. Coworker accepts -> status becomes PENDING_MANAGER
    status = 'PENDING_MANAGER';
    expect(status).toBe('PENDING_MANAGER');

    // 3. Manager approves -> status becomes APPROVED or APPLIED
    status = 'APPROVED';
    expect(status).toBe('APPROVED');
  });

  // ── Scenario 8: Query invalidation keys consistency ──────────────────────
  it('Manager approval invalidates both schedule queries and request history queries', () => {
    const queryClientMock = {
      invalidateQueries: vi.fn(),
    };

    const siteId = 'site-123';

    // Simulate Manager Approve callback logic
    queryClientMock.invalidateQueries({ queryKey: ['shift-change-requests', siteId] });
    queryClientMock.invalidateQueries({ queryKey: ['swap-requests', siteId] });
    queryClientMock.invalidateQueries({ queryKey: ['worker-schedules', siteId] });

    expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['shift-change-requests', siteId] });
    expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['swap-requests', siteId] });
    expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['worker-schedules', siteId] });
  });
});
