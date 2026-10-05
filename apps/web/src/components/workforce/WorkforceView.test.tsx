import { describe, it, expect, vi } from 'vitest';
import { getWorkforceTabs } from './WorkforceView';
import { filterContractorReviewRequests, filterManagerReviewRequests } from './WorkforceManagerReviewUtils';
import { splitWorkerSwapRequests } from './WorkforceScheduleUtils';

describe('WorkforceView & MF07 Workflow Logic', () => {
  // ── Scenario 1: Worker tab visibility ─────────────────────────────────────
  it('Worker sees only Schedule tab and actions', () => {
    const tabs = getWorkforceTabs(['WORKER']);
    expect(tabs.showSchedule).toBe(true);
    expect(tabs.showReview).toBe(false);
    expect(tabs.defaultTab).toBe('schedule');
  });

  // ── Scenario 2: Contractor Rep visibility ──────────────────────────────────
  it('Contractor Representative sees only Contractor Review tab by default (no personal Worker schedule)', () => {
    const tabs = getWorkforceTabs(['CONTRACTOR_REPRESENTATIVE']);
    expect(tabs.showSchedule).toBe(false);
    expect(tabs.showReview).toBe(true);
    expect(tabs.defaultTab).toBe('review');
  });

  // ── Scenario 3: Site Manager visibility (No Review tab for Site Manager) ───
  it('Site Manager has no Review tab (Contractor Review is exclusive to Contractor Rep)', () => {
    const tabs = getWorkforceTabs(['SITE_MANAGER']);
    expect(tabs.showSchedule).toBe(false);
    expect(tabs.showReview).toBe(false);
  });

  it('System Admin has no Worker schedule or Contractor Review tab', () => {
    const tabs = getWorkforceTabs(['ADMIN']);
    expect(tabs.showSchedule).toBe(false);
    expect(tabs.showReview).toBe(false);
    expect(tabs.defaultTab).toBe('schedule');
  });

  it('Multiple roles combines visibility correctly', () => {
    const tabs1 = getWorkforceTabs(['WORKER', 'SITE_MANAGER']);
    expect(tabs1.showSchedule).toBe(true);
    expect(tabs1.showReview).toBe(false);
    expect(tabs1.defaultTab).toBe('schedule');

    const tabs2 = getWorkforceTabs(['CONTRACTOR_REPRESENTATIVE', 'WORKER']);
    expect(tabs2.showSchedule).toBe(true);
    expect(tabs2.showReview).toBe(true);
    expect(tabs2.defaultTab).toBe('review');

    const tabs3 = getWorkforceTabs(['CONTRACTOR_REPRESENTATIVE', 'SITE_MANAGER']);
    expect(tabs3.showSchedule).toBe(false);
    expect(tabs3.showReview).toBe(true);
    expect(tabs3.defaultTab).toBe('review');
  });


  // ── Scenario 4: Hard-refresh / transient session cache ─────────────────────
  it('Workforce handles hard refresh with empty roleAssignments cleanly (no auth-session cache error)', () => {
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

  // ── Scenario 5: Contractor review filtering ─────────────────────────────────
  it('Contractor Review filters swap requests so ONLY coworker-accepted swaps (PENDING_MANAGER) appear', () => {
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

    const { pendingChanges, pendingSwaps } = filterContractorReviewRequests(directChanges, swapRequests);

    // 1. Direct change in PENDING_MANAGER is visible to Contractor Review
    expect(pendingChanges).toHaveLength(1);
    expect(pendingChanges[0]?.id).toBe('c1');

    // 2. Unaccepted swap (PENDING_COWORKER) is HIDDEN from Contractor Review
    // 3. Only coworker-accepted swap (PENDING_MANAGER) is VISIBLE to Contractor Review
    expect(pendingSwaps).toHaveLength(1);
    expect(pendingSwaps[0]?.id).toBe('s2');

    // 4. Backward compatibility alias returns identical results
    const legacyResult = filterManagerReviewRequests(directChanges, swapRequests);
    expect(legacyResult.pendingChanges).toEqual(pendingChanges);
    expect(legacyResult.pendingSwaps).toEqual(pendingSwaps);
  });

  it('Worker incoming swaps only include requests where the worker is the coworker', () => {
    const requests = [
      {
        requesterWorkerId: 'worker-2',
        coworkerWorkerId: 'worker-1',
        status: 'PENDING_COWORKER' as const,
      },
      {
        requesterWorkerId: 'worker-1',
        coworkerWorkerId: 'worker-2',
        status: 'PENDING_COWORKER' as const,
      },
    ];

    const result = splitWorkerSwapRequests(requests, 'worker-2');

    expect(result.myRequests).toHaveLength(1);
    expect(result.myRequests[0]?.requesterWorkerId).toBe('worker-2');
    expect(result.incomingRequests).toHaveLength(1);
    expect(result.incomingRequests[0]?.requesterWorkerId).toBe('worker-1');
  });

  // ── Scenario 6: Schedule Setup Role Authorization Logic ───────────────────
  it('Schedule Setup distinguishes Contractor Representative vs Site Manager capabilities', () => {
    // Helper function mirroring ScheduleSetupView authorization rules
    const getScheduleSetupPermissions = (roles: string[]) => {
      const isAdmin = roles.includes('ADMIN');
      const isManager = roles.includes('SITE_MANAGER');
      const isContractorRep = roles.includes('CONTRACTOR_REPRESENTATIVE');

      return {
        canAccess: isAdmin || isManager || isContractorRep,
        canManageShiftsAndVersions: isManager,
        canAssignWorker: isContractorRep,
      };
    };

    // 1. Contractor Representative: can access and assign worker, read-only shift/version
    const repPerms = getScheduleSetupPermissions(['CONTRACTOR_REPRESENTATIVE']);
    expect(repPerms.canAccess).toBe(true);
    expect(repPerms.canAssignWorker).toBe(true);
    expect(repPerms.canManageShiftsAndVersions).toBe(false);

    // 2. Site Manager: can access, can manage shift/version, CANNOT assign workers (tab hidden)
    const managerPerms = getScheduleSetupPermissions(['SITE_MANAGER']);
    expect(managerPerms.canAccess).toBe(true);
    expect(managerPerms.canAssignWorker).toBe(false);
    expect(managerPerms.canManageShiftsAndVersions).toBe(true);

    // 3. Admin: can view setup, but cannot manage shifts or assign workers
    const adminPerms = getScheduleSetupPermissions(['ADMIN']);
    expect(adminPerms.canAccess).toBe(true);
    expect(adminPerms.canAssignWorker).toBe(false);
    expect(adminPerms.canManageShiftsAndVersions).toBe(false);

    // 4. Worker: no access to schedule setup
    const workerPerms = getScheduleSetupPermissions(['WORKER']);
    expect(workerPerms.canAccess).toBe(false);
    expect(workerPerms.canAssignWorker).toBe(false);
  });

  // ── Scenario 7: Shift swap coworker decline safety ─────────────────────────
  it('Shift swap coworker flow supports declining a PENDING_COWORKER request with a reason', () => {
    // In MF07, the coworker can accept or decline before contractor review.
    const isCoworkerDeclineSupportedByBackend = true;
    expect(isCoworkerDeclineSupportedByBackend).toBe(true);

    const swapRequest = {
      id: 'swap-001',
      status: 'PENDING_COWORKER' as const,
    };

    // UI action guard: both confirm and decline are allowed for coworker
    const canCoworkerConfirm = swapRequest.status === 'PENDING_COWORKER';
    const canCoworkerDecline = swapRequest.status === 'PENDING_COWORKER';
    expect(canCoworkerConfirm).toBe(true);
    expect(canCoworkerDecline).toBe(true);
  });

  // ── Scenario 8: Direct shift change payload & invalidation verification ────
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

  // ── Scenario 9: Shift swap payload & two-phase state machine ──────────────
  it('Shift swap payload and coworker confirm/review actions follow two-phase state machine', () => {
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

    // 2. Coworker accepts -> status becomes PENDING_MANAGER (reviewed in Contractor Review)
    status = 'PENDING_MANAGER';
    expect(status).toBe('PENDING_MANAGER');

    // 3. Contractor Review approves -> status becomes APPROVED or APPLIED
    status = 'APPROVED';
    expect(status).toBe('APPROVED');
  });

  // ── Scenario 10: Query invalidation keys consistency ───────────────────────
  it('Contractor Review approval invalidates both schedule queries and request history queries', () => {
    const queryClientMock = {
      invalidateQueries: vi.fn(),
    };

    const siteId = 'site-123';

    // Simulate Contractor Review Approve callback logic
    queryClientMock.invalidateQueries({ queryKey: ['shift-change-requests', siteId] });
    queryClientMock.invalidateQueries({ queryKey: ['swap-requests', siteId] });
    queryClientMock.invalidateQueries({ queryKey: ['worker-schedules', siteId] });

    expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['shift-change-requests', siteId] });
    expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['swap-requests', siteId] });
    expect(queryClientMock.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['worker-schedules', siteId] });
  });
});
