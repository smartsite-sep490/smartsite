// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  SmartSiteManagementClient,
  type AccountResponse,
  type ShiftSwapRequestResponse,
} from '@smartsite/api-client';
import { WorkforceView } from './WorkforceView';

let user: Pick<AccountResponse, 'id' | 'roleAssignments' | 'mustChangePassword'>;
vi.mock('../../features/auth/auth-session', () => ({
  useAuth: () => ({ accessToken: 'synthetic-token' }),
  useCurrentUser: () => ({ data: user, isLoading: false, isError: false }),
}));
const request: ShiftSwapRequestResponse = {
  id: 'older-request',
  siteId: 'site-2',
  requesterWorkerId: 'worker-a',
  coworkerWorkerId: 'worker-b',
  requesterWorkerScheduleId: 'schedule-a',
  coworkerWorkerScheduleId: 'schedule-b',
  requesterShiftId: 'morning',
  coworkerShiftId: 'evening',
  expectedScheduleVersionId: 'version-1',
  status: 'APPLIED',
  requestedByUserId: 'user-a',
  reason: 'Synthetic request outside first page',
  coworkerConfirmedAt: '2030-01-01T00:00:00Z',
  reviewedByUserId: 'rep-1',
  reviewedAt: '2030-01-01T01:00:00Z',
  reviewReason: null,
  appliedAt: '2030-01-01T01:00:00Z',
  createdAt: '2029-12-01T00:00:00Z',
};
let client: QueryClient;
function mount(tab: 'schedule' | 'review', view: string, targetRequest = request) {
  for (const method of [
    'listShifts',
    'listCoworkers',
    'listWorkerSchedules',
    'listShiftChangeRequests',
    'listShiftSwapRequests',
  ] as const) {
    vi.spyOn(SmartSiteManagementClient.prototype, method).mockResolvedValue({
      items: [],
      total: 0,
    });
  }
  vi.spyOn(SmartSiteManagementClient.prototype, 'listWorkers').mockResolvedValue({
    items: [
      {
        id: 'worker-b',
        userId: 'user-b',
        siteId: 'site-2',
        contractorId: 'contractor-1',
        displayName: 'Synthetic Worker B',
        externalId: 'B',
        isActive: true,
        createdAt: '2020-01-01T00:00:00Z',
      },
    ],
    total: 1,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'getShiftSwapRequest').mockResolvedValue(
    targetRequest,
  );
  vi.spyOn(SmartSiteManagementClient.prototype, 'listShiftRequests').mockResolvedValue({
    items: [],
    total: 0,
    pendingCount: 0,
    incomingCount: 0,
    pendingScheduleIds: [],
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter
        initialEntries={[
          `/workforce?siteId=site-2&tab=${tab}&view=${view}&requestType=SWAP&requestId=older-request`,
        ]}
      >
        <WorkforceView apiUrl="https://api.example.test" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  client?.clear();
  vi.restoreAllMocks();
});

describe('notification request navigation', () => {
  it('does not announce approval when the Backend reports a conflicted swap', async () => {
    user = {
      id: 'rep-1',
      mustChangePassword: false,
      roleAssignments: [{ role: 'CONTRACTOR_REPRESENTATIVE', siteId: 'site-2' }],
    };
    vi.spyOn(SmartSiteManagementClient.prototype, 'approveShiftSwapRequest').mockResolvedValue({
      ...request,
      status: 'CONFLICTED',
    });
    mount('review', 'pending', { ...request, status: 'PENDING_MANAGER' });
    fireEvent.click(await screen.findByRole('button', { name: 'Approve Swap' }, { timeout: 5000 }));
    expect(await screen.findByText('Shift Swap Could Not Be Applied')).toBeTruthy();
    expect(screen.queryByText('Shift Swap Approved')).toBeNull();
  });

  it('opens the correct Site and shows an already-applied incoming swap in worker history', async () => {
    user = {
      id: 'user-b',
      mustChangePassword: false,
      roleAssignments: [
        { role: 'WORKER', siteId: 'site-1' },
        { role: 'WORKER', siteId: 'site-2' },
      ],
    };
    mount('schedule', 'coworker');
    expect(await screen.findByText(/Selected shift swap · APPLIED/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Shift Swap')).toBeTruthy());
    expect(SmartSiteManagementClient.prototype.getShiftSwapRequest).toHaveBeenCalledWith(
      'synthetic-token',
      'site-2',
      'older-request',
    );
    expect(screen.queryByText('Accept Swap')).toBeNull();
  });

  it('opens contractor history when a pending notification refers to a request already handled', async () => {
    user = {
      id: 'rep-1',
      mustChangePassword: false,
      roleAssignments: [{ role: 'CONTRACTOR_REPRESENTATIVE', siteId: 'site-2' }],
    };
    mount('review', 'pending');
    expect(await screen.findByText(/Selected shift swap · APPLIED/)).toBeTruthy();
    expect(screen.queryByText('Approve Swap')).toBeNull();
    expect(await screen.findByText('APPLIED')).toBeTruthy();
  });

  it('denies a notification link to an unassigned Site before requesting its details', async () => {
    user = {
      id: 'user-b',
      mustChangePassword: false,
      roleAssignments: [{ role: 'WORKER', siteId: 'site-1' }],
    };
    mount('schedule', 'coworker');
    expect(await screen.findByText('No access')).toBeTruthy();
    expect(SmartSiteManagementClient.prototype.getShiftSwapRequest).not.toHaveBeenCalled();
  });
});
