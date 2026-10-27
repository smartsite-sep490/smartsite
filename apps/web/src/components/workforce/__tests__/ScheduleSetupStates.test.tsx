// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError, SmartSiteManagementClient } from '@smartsite/api-client';
import { ScheduleSetupView } from '../components/ScheduleSetupView';

const session = vi.hoisted(() => ({ role: 'SITE_MANAGER' }));
vi.mock('../../../features/auth/auth-session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../features/auth/auth-session')>()),
  useAuth: () => ({ accessToken: 'synthetic-token' }),
  useCurrentUser: () => ({
    data: { roleAssignments: [{ role: session.role, siteId: 'site-1' }] },
  }),
}));
vi.mock('../components/ScheduleAssignmentForm', () => ({
  ScheduleAssignmentForm: ({
    onScopeChange,
  }: {
    onScopeChange: (scope: { siteId: string; contractorId: string }) => void;
  }) => {
    React.useEffect(() => {
      onScopeChange({ siteId: 'site-1', contractorId: 'contractor-1' });
    }, [onScopeChange]);
    return <input aria-label="Assignment draft" defaultValue="" />;
  },
}));

const site = {
  id: 'site-1',
  name: 'Synthetic site',
  code: 'TEST',
  createdAt: '2030-01-01T00:00:00Z',
};
const shift = {
  id: 'shift-1',
  siteId: 'site-1',
  name: 'Day shift',
  startsAt: '2030-01-01T08:00:00Z',
  endsAt: '2030-01-01T16:00:00Z',
  timezone: 'UTC',
  createdAt: '2030-01-01T00:00:00Z',
  archivedAt: null,
};
let cache: QueryClient;

beforeEach(() => {
  window.history.replaceState({}, '', '/');
  session.role = 'SITE_MANAGER';
  vi.spyOn(SmartSiteManagementClient.prototype, 'getSite').mockResolvedValue(site);
  vi.spyOn(SmartSiteManagementClient.prototype, 'listShifts').mockResolvedValue({
    items: [shift],
    total: 1,
  });
  for (const method of [
    'listContractors',
    'listScheduleVersions',
    'listWorkers',
    'listWorkerSchedules',
    'listShiftContractorAssignments',
    'listContractorTeams',
    'listContractorTeamWorkers',
  ] as const) {
    vi.spyOn(SmartSiteManagementClient.prototype, method).mockResolvedValue({
      items: [],
      total: 0,
    });
  }
});

afterEach(() => {
  cleanup();
  cache?.clear();
  vi.restoreAllMocks();
});

function mount() {
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cache}>
      <ScheduleSetupView apiUrl="https://synthetic.test" />
    </QueryClientProvider>,
  );
}

it('shows the contractor name on a shift instead of its generated code', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.listContractors).mockResolvedValue({
    items: [
      {
        id: 'contractor-1',
        siteId: 'site-1',
        name: 'CPR Land',
        code: 'CTR-SYNTHETIC',
        isActive: true,
        createdAt: '2030-01-01T00:00:00Z',
      },
    ],
    total: 1,
  });
  vi.mocked(SmartSiteManagementClient.prototype.listShiftContractorAssignments).mockResolvedValue({
    items: [
      {
        id: 'assignment-1',
        siteId: 'site-1',
        shiftId: 'shift-1',
        contractorId: 'contractor-1',
        createdAt: '2030-01-01T00:00:00Z',
      },
    ],
    total: 1,
  });
  mount();
  expect(await screen.findByText('CPR Land')).toBeTruthy();
  expect(screen.queryByText('CTR-SYNTHETIC')).toBeNull();
});

it('shows loading rather than denied access while scoped sites are loading', async () => {
  let resolve!: (value: typeof site) => void;
  vi.mocked(SmartSiteManagementClient.prototype.getSite).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  mount();
  expect(screen.queryByText('Access Restricted')).toBeNull();
  expect(screen.getByRole('status').textContent).toContain('Loading');
  await act(async () => {
    resolve(site);
  });
  expect(await screen.findByText('Day shift')).toBeTruthy();
});

it('lets a manager retry failed site discovery without claiming access was denied', async () => {
  const getSite = vi
    .mocked(SmartSiteManagementClient.prototype.getSite)
    .mockRejectedValue(new ApiError('network', 'INTERNAL_SITE_FAILURE'));
  mount();
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).not.toContain('INTERNAL_SITE_FAILURE');
  expect(screen.queryByText('Access Restricted')).toBeNull();
  expect(screen.queryByText('Configured Shifts')).toBeNull();
  getSite.mockResolvedValue(site);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('Day shift')).toBeTruthy();
});

it.each(['listShifts', 'listScheduleVersions'] as const)(
  'does not render zero summaries or empty lists when %s initially fails',
  async (method) => {
    vi.mocked(SmartSiteManagementClient.prototype[method]).mockRejectedValue(
      new ApiError('invalid-response', 'Backend returned invalid JSON.', 502),
    );
    mount();
    expect((await screen.findByRole('alert')).textContent).not.toContain('invalid JSON');
    expect(screen.queryByText('Configured Shifts')).toBeNull();
    expect(screen.queryByText('No Schedule Versions')).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  },
);

it('keeps loaded data and an entered shift draft visible when a background request fails', async () => {
  const listShifts = vi.mocked(SmartSiteManagementClient.prototype.listShifts);
  mount();
  expect(await screen.findByText('Day shift')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'New Shift' }));
  fireEvent.change(screen.getByLabelText(/Shift Name/), { target: { value: 'Keep this draft' } });
  listShifts.mockRejectedValue(new ApiError('network', 'INTERNAL_REFETCH_FAILURE'));
  await act(async () => {
    await cache.invalidateQueries({ queryKey: ['shifts', 'site-1'] });
  });
  expect((await screen.findByRole('alert')).textContent).not.toContain('INTERNAL_REFETCH_FAILURE');
  expect(screen.getByText('Day shift')).toBeTruthy();
  expect((screen.getByLabelText(/Shift Name/) as HTMLInputElement).value).toBe('Keep this draft');
  listShifts.mockResolvedValue({ items: [shift], total: 1 });
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect((screen.getByLabelText(/Shift Name/) as HTMLInputElement).value).toBe('Keep this draft');
});

it('refreshes site discovery along with shift and version data', async () => {
  mount();
  await screen.findByText('Day shift');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(SmartSiteManagementClient.prototype.getSite).toHaveBeenCalledTimes(2));
  expect(SmartSiteManagementClient.prototype.listShifts).toHaveBeenCalledTimes(2);
  expect(SmartSiteManagementClient.prototype.listScheduleVersions).toHaveBeenCalledTimes(2);
});

it('retains the refresh action without rendering a duplicate page heading inside the view', async () => {
  mount();
  await screen.findByText('Day shift');
  expect(screen.getByRole('button', { name: 'Refresh' })).toBeTruthy();
  expect(screen.queryByRole('heading', { level: 1, name: 'Schedule Setup' })).toBeNull();
  expect(screen.queryByText('Workforce Management')).toBeNull();
});

it('still denies a role without schedule configuration scope', async () => {
  session.role = 'WORKER';
  mount();
  expect(await screen.findByText('Access Restricted')).toBeTruthy();
  expect(SmartSiteManagementClient.prototype.getSite).not.toHaveBeenCalled();
  expect(SmartSiteManagementClient.prototype.listShifts).not.toHaveBeenCalled();
});

const assignedSchedule = {
  id: 'schedule-1',
  siteId: 'site-1',
  workerId: 'worker-1',
  shiftId: 'shift-1',
  scheduleVersionId: 'version-1',
  workDate: '2030-01-01',
  isActive: true,
  createdAt: '2030-01-01T00:00:00Z',
};
function mountAssignments() {
  session.role = 'CONTRACTOR_REPRESENTATIVE';
  window.history.replaceState({}, '', '/?tab=assignment');
  vi.mocked(SmartSiteManagementClient.prototype.listWorkers).mockResolvedValue({
    items: [
      {
        id: 'worker-1',
        siteId: 'site-1',
        contractorId: 'contractor-1',
        userId: null,
        externalId: 'TEST-1',
        displayName: 'Assigned Worker',
        isActive: true,
        createdAt: '2030-01-01T00:00:00Z',
      },
    ],
    total: 1,
  });
  mount();
}

it('shows a retryable assignment load error instead of an empty schedule list', async () => {
  const read = vi
    .mocked(SmartSiteManagementClient.prototype.listWorkerSchedules)
    .mockRejectedValue(new ApiError('network', 'INTERNAL_SCHEDULE_FAILURE'));
  mountAssignments();
  expect((await screen.findByRole('alert')).textContent).not.toContain('INTERNAL_SCHEDULE_FAILURE');
  expect(screen.queryByText('No worker schedules assigned yet.')).toBeNull();
  expect(screen.queryByText('Assigned Schedules')).toBeNull();
  read.mockResolvedValue({ items: [assignedSchedule], total: 1 });
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('Assigned Worker')).toBeTruthy();
});

it('preserves cached assignment rows and a draft during a failed background refresh', async () => {
  const read = vi
    .mocked(SmartSiteManagementClient.prototype.listWorkerSchedules)
    .mockResolvedValue({ items: [assignedSchedule], total: 1 });
  mountAssignments();
  await screen.findByText('Assigned Worker');
  fireEvent.change(screen.getByLabelText('Assignment draft'), {
    target: { value: 'Keep assignment' },
  });
  read.mockRejectedValue(new ApiError('network', 'INTERNAL_SCHEDULE_FAILURE'));
  await act(async () => {
    await cache.invalidateQueries({ queryKey: ['worker-schedules'] });
  });
  expect((await screen.findByRole('alert')).textContent).not.toContain('INTERNAL_SCHEDULE_FAILURE');
  expect(screen.getByText('Assigned Worker')).toBeTruthy();
  expect((screen.getByLabelText('Assignment draft') as HTMLInputElement).value).toBe(
    'Keep assignment',
  );
  read.mockResolvedValue({ items: [assignedSchedule], total: 1 });
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect((screen.getByLabelText('Assignment draft') as HTMLInputElement).value).toBe(
    'Keep assignment',
  );
});

it('removes cached assignment rows and actions when a refresh is forbidden', async () => {
  const read = vi
    .mocked(SmartSiteManagementClient.prototype.listWorkerSchedules)
    .mockResolvedValue({ items: [assignedSchedule], total: 1 });
  mountAssignments();
  await screen.findByText('Assigned Worker');
  read.mockRejectedValue(new ApiError('http', 'Forbidden', 403));
  await act(async () => {
    await cache.invalidateQueries({ queryKey: ['worker-schedules'] });
  });
  expect((await screen.findByRole('alert')).textContent).toContain('permission');
  expect(screen.queryByText('Assigned Worker')).toBeNull();
  expect(screen.queryByLabelText('Assignment draft')).toBeNull();
});
