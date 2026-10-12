// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SmartSiteManagementClient, type ShiftChangeRequestResponse } from '@smartsite/api-client';
import { WorkforceManagerReviewTab } from '../components/WorkforceManagerReviewTab';

let queries: QueryClient;
afterEach(() => {
  cleanup();
  queries?.clear();
  vi.restoreAllMocks();
});

it.each(['list', 'notification', 'history', 'missing-date'])(
  'shows the scheduled date separately from the filing date in contractor change review (%s)',
  async (view) => {
    const change: ShiftChangeRequestResponse = {
      id: 'change-1',
      siteId: 'site-1',
      workerId: 'worker-1',
      workerScheduleId: 'schedule-1',
      workDate: view === 'missing-date' ? undefined : '2030-02-12',
      fromShiftId: 'morning',
      toShiftId: 'evening',
      expectedScheduleVersionId: 'version-1',
      status: view === 'history' ? 'REJECTED' : 'PENDING_MANAGER',
      requestedByUserId: 'worker-user',
      reason: 'Synthetic change reason',
      reviewedByUserId: null,
      reviewedAt: null,
      reviewReason: null,
      appliedAt: null,
      createdAt: '2029-12-01T00:00:00Z',
    };
    for (const method of ['listWorkers', 'listCoworkers'] as const) {
      vi.spyOn(SmartSiteManagementClient.prototype, method).mockResolvedValue({
        items: [],
        total: 0,
      });
    }
    vi.spyOn(SmartSiteManagementClient.prototype, 'listShifts').mockResolvedValue({
      items: ['morning', 'evening'].map((id) => ({
        id,
        siteId: 'site-1',
        name: id,
        startsAt: '08:00',
        endsAt: '17:00',
        timezone: 'Asia/Ho_Chi_Minh',
        createdAt: '2029-01-01T00:00:00Z',
      })),
      total: 2,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listShiftRequests').mockResolvedValue({
      items: view === 'notification' ? [] : [{ ...change, requestType: 'CHANGE' }],
      total: view === 'notification' ? 0 : 1,
      pendingCount: 1,
      incomingCount: 0,
      pendingScheduleIds: [],
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'getShiftChangeRequest').mockResolvedValue(
      change,
    );
    queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queries}>
        <MemoryRouter
          initialEntries={[
            `/workforce?requestType=CHANGE&requestId=${view === 'list' ? '' : 'change-1'}`,
          ]}
        >
          <WorkforceManagerReviewTab
            apiUrl="https://api.example.test"
            siteId="site-1"
            token="synthetic-token"
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const date = await screen.findByText(/Shift date:/);
    expect(date.textContent).toContain(view === 'missing-date' ? 'Date unavailable' : '12/02/2030');
    expect(date.textContent).not.toContain('01/12/2029');
    if (view === 'history') {
      expect(await screen.findByText('REJECTED')).toBeTruthy();
    } else {
      expect(screen.getByRole('button', { name: 'Approve Change' })).toBeTruthy();
    }
  },
);
