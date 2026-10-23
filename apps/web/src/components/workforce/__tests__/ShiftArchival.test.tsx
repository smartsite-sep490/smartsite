// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { ScheduleSetupView } from '../components/ScheduleSetupView';

const session = vi.hoisted(() => ({ role: 'SITE_MANAGER' }));
vi.mock('../../../features/auth/auth-session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../features/auth/auth-session')>()),
  useAuth: () => ({ accessToken: 'synthetic-token' }),
  useCurrentUser: () => ({ data: { roleAssignments: [{ role: session.role, siteId: 'site-1' }] } }),
}));
let queries: QueryClient;
let shifts: Array<{
  id: string;
  siteId: string;
  name: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  createdAt: string;
  archivedAt: string | null;
}>;
beforeEach(() => {
  window.history.replaceState({}, '', '/');
  session.role = 'SITE_MANAGER';
  shifts = ['Day shift', 'Old shift'].map((name, index) => ({
    id: `shift-${index}`,
    siteId: 'site-1',
    name,
    startsAt: '2030-01-01T08:00:00Z',
    endsAt: '2030-01-01T16:00:00Z',
    timezone: 'UTC',
    createdAt: '2030-01-01T00:00:00Z',
    archivedAt: index ? '2030-01-02T00:00:00Z' : null,
  }));
  vi.spyOn(SmartSiteManagementClient.prototype, 'getSite').mockResolvedValue({
    id: 'site-1',
    name: 'Synthetic site',
    code: 'TEST',
    createdAt: '2030-01-01T00:00:00Z',
  });
  for (const method of [
    'listContractors',
    'listScheduleVersions',
    'listWorkers',
    'listWorkerSchedules',
    'listShiftContractorAssignments',
  ] as const) {
    vi.spyOn(SmartSiteManagementClient.prototype, method).mockResolvedValue({
      items: [],
      total: 0,
    });
  }
  vi.spyOn(SmartSiteManagementClient.prototype, 'listShifts').mockImplementation(async () => ({
    items: shifts,
    total: shifts.length,
  }));
  vi.spyOn(SmartSiteManagementClient.prototype, 'archiveShift').mockImplementation(
    async (_token, _siteId, id) => {
      shifts = shifts.map((shift) =>
        shift.id === id ? { ...shift, archivedAt: '2030-01-03T00:00:00Z' } : shift,
      );
      return shifts.find((shift) => shift.id === id)!;
    },
  );
});
it.each(['CONTRACTOR_REPRESENTATIVE', 'SITE_MANAGER'])(
  '%s shows assignments only for representatives and preserves manager shift setup',
  async (role) => {
    session.role = role;
    const worker = (index: number) => ({
      id: `worker-${index}`,
      siteId: 'site-1',
      contractorId: 'contractor',
      userId: null,
      externalId: `ID-${index}`,
      displayName: `Member ${index}`,
      isActive: true,
      createdAt: '2030-01-01',
    });
    const read = vi
      .mocked(SmartSiteManagementClient.prototype.listWorkers)
      .mockImplementation(async (_token, _site, options) => ({
        items: options?.offset
          ? [worker(100)]
          : Array.from({ length: 100 }, (_, index) => worker(index)),
        total: 101,
      }));
    vi.spyOn(SmartSiteManagementClient.prototype, 'contractorDashboardScopes').mockResolvedValue({
      items: [
        {
          siteId: 'site-1',
          siteName: 'Synthetic',
          siteCode: 'TEST',
          contractorId: 'contractor',
          contractorName: 'Synthetic',
        },
      ],
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listContractorTeams').mockResolvedValue({
      items: [],
      total: 0,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listContractorTeamWorkers').mockResolvedValue({
      items: [],
      total: 0,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listScheduleAssignments').mockResolvedValue({
      items: [],
      total: 0,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'accessSetup').mockResolvedValue({
      canReviewAssignments: true,
      canGrantContractorZones: true,
      canGrantWorkerZones: false,
      participations: [
        {
          id: 'p',
          contractorId: 'contractor',
          name: 'Synthetic',
          validFrom: '2020-01-01T00:00:00Z',
          validUntil: null,
        },
      ],
      workers: [],
      zones: [],
      assignments: [],
      contractorPermissions: [],
      workerPermissions: [],
    });
    if (role === 'SITE_MANAGER') {
      window.history.replaceState({}, '', '/schedule-setup?tab=assignment');
    }
    mount();
    if (role === 'SITE_MANAGER') {
      await screen.findByRole('tab', { name: /Shifts/ });
      expect(screen.queryByRole('tab', { name: /Worker Assignment/ })).toBeNull();
      expect(await screen.findByText('Day shift')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'New Shift' })).toBeTruthy();
      expect(screen.queryByText('Assign schedules')).toBeNull();
      expect(read).not.toHaveBeenCalled();
      expect(SmartSiteManagementClient.prototype.listWorkerSchedules).not.toHaveBeenCalled();
      return;
    }
    fireEvent.click(await screen.findByRole('tab', { name: /Worker Assignment/ }));
    await waitFor(() =>
      expect(read).toHaveBeenCalledWith('synthetic-token', 'site-1', { offset: 100, limit: 100 }),
    );
    await waitFor(() =>
      expect(SmartSiteManagementClient.prototype.listWorkerSchedules).toHaveBeenCalledWith(
        'synthetic-token',
        'site-1',
        expect.objectContaining({ contractorId: 'contractor' }),
      ),
    );
    expect(screen.getByPlaceholderText('Worker name or ID...')).toBeTruthy();
    if (role === 'CONTRACTOR_REPRESENTATIVE') {
      expect(await screen.findByText('Assign schedules')).toBeTruthy();
    } else {
      expect(screen.queryByText('Assign schedules')).toBeNull();
      expect(screen.queryByRole('button', { name: /Preview assignments/i })).toBeNull();
    }
    fireEvent.click(screen.getByText('All workers'));
    expect(await screen.findByText('Member 100')).toBeTruthy();
  },
);
afterEach(() => {
  cleanup();
  queries?.clear();
  vi.restoreAllMocks();
});
function mount() {
  queries = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queries}>
      <ScheduleSetupView apiUrl="https://synthetic.test" />
    </QueryClientProvider>,
  );
}
it('lets the site manager create a shift with an optional unpaid lunch break', async () => {
  const create = vi.spyOn(SmartSiteManagementClient.prototype, 'createShift').mockResolvedValue({
    ...shifts[0]!,
    breakStartsAt: '2026-10-01T05:00:00Z',
    breakEndsAt: '2026-10-01T06:00:00Z',
  });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'New Shift' }));
  fireEvent.change(screen.getByLabelText(/Shift Name/), { target: { value: 'Lunch shift' } });
  expect(screen.queryByLabelText(/Break Starts At/)).toBeNull();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Include an unpaid lunch break' }));
  expect(screen.getByLabelText(/Break Starts At/)).toBeTruthy();
  expect(screen.getByLabelText(/Break Ends At/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Create Shift' }));
  await waitFor(() =>
    expect(create).toHaveBeenCalledWith('synthetic-token', 'site-1', {
      name: 'Lunch shift',
      startsAt: '2026-10-01T01:00:00.000Z',
      endsAt: '2026-10-01T10:00:00.000Z',
      timezone: 'Asia/Ho_Chi_Minh',
      breakStartsAt: '2026-10-01T05:00:00.000Z',
      breakEndsAt: '2026-10-01T06:00:00.000Z',
    }),
  );
});
it('hides archived templates by default and lets readers show them without an archive action', async () => {
  session.role = 'CONTRACTOR_REPRESENTATIVE';
  mount();
  await screen.findByText('Day shift');
  expect(screen.queryByText('Old shift')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Show archived' }));
  expect(await screen.findByText('Old shift')).toBeTruthy();
  expect(screen.getByText('Archived')).toBeTruthy();
});
it('confirms archival, refreshes the list and retains the archived template for viewing', async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Archive' }));
  expect(screen.queryByRole('button', { name: /Delete/i })).toBeNull();
  expect(
    screen.getByText(/Existing schedules, attendance and request history will be kept/),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Archive Shift' }));
  await waitFor(() =>
    expect(SmartSiteManagementClient.prototype.archiveShift).toHaveBeenCalledWith(
      'synthetic-token',
      'site-1',
      'shift-0',
    ),
  );
  await waitFor(() => expect(screen.queryByText('Day shift')).toBeNull());
  fireEvent.click(screen.getByRole('checkbox', { name: 'Show archived' }));
  expect(await screen.findByText('Day shift')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
});
it('keeps the confirmation available with an error when archival fails', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.archiveShift).mockRejectedValue(
    new Error('Unable to archive shift'),
  );
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Archive' }));
  fireEvent.click(screen.getByRole('button', { name: 'Archive Shift' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Unable to archive shift');
  expect(screen.getByRole('button', { name: 'Archive Shift' })).toBeTruthy();
});
