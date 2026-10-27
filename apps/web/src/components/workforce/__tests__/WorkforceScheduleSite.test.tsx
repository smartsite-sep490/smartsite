// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ApiError, SmartSiteManagementClient } from '@smartsite/api-client';
import { WorkforceScheduleTab } from '../components/WorkforceScheduleTab';
import i18n from '../../../i18n';

let queries: QueryClient;

beforeEach(() => {
  vi.spyOn(SmartSiteManagementClient.prototype, 'attendanceDays').mockResolvedValue({
    items: [],
    total: 0,
    requests: [],
    canReview: false,
    canRequest: true,
  });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2030-01-01T10:00:00Z'));
  for (const method of ['listShifts', 'listWorkers', 'listCoworkers'] as const) {
    vi.spyOn(SmartSiteManagementClient.prototype, method).mockResolvedValue({
      items: [],
      total: 0,
    });
  }
  vi.spyOn(SmartSiteManagementClient.prototype, 'myContractorTeam').mockResolvedValue({
    workerId: 'worker-a',
    displayName: 'Worker A',
    membershipId: 'mem-1',
    teamId: 'team-paint',
    teamName: 'Painting Squad',
    zones: [
      {
        id: 'grant',
        contractorZonePermissionId: 'parent',
        zoneId: 'zone',
        name: 'Painting Zone',
        validFrom: '2026-01-01T00:00:00Z',
        validUntil: '2030-01-01T00:00:00Z',
        revokedAt: null,
        effective: true,
      },
    ],
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listShiftRequests').mockResolvedValue({
    items: [],
    total: 0,
    pendingCount: 0,
    incomingCount: 0,
    pendingScheduleIds: [],
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'getSite').mockImplementation(
    async (_token, id) => ({
      id,
      code: id,
      name: id === 'site-1' ? 'Demo Construction Site' : 'Thu Duc Site',
      createdAt: '2030-01-01T00:00:00Z',
    }),
  );
  vi.spyOn(SmartSiteManagementClient.prototype, 'listWorkerSchedules').mockImplementation(
    async (_token, siteId) => ({
      items: ['morning', 'evening'].map((shiftId) => ({
        id: `${siteId}-${shiftId}`,
        siteId,
        workerId: 'worker-a',
        shiftId,
        scheduleVersionId: 'version-1',
        workDate: '2030-01-01',
        isActive: true,
        createdAt: '2030-01-01T00:00:00Z',
      })),
      total: 2,
    }),
  );
});

afterEach(async () => {
  cleanup();
  queries?.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
  await i18n.changeLanguage('en');
});

function mount(siteId = 'site-1') {
  queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (id: string) => (
    <QueryClientProvider client={queries}>
      <MemoryRouter>
        <WorkforceScheduleTab
          apiUrl="https://api.example.test"
          siteId={id}
          token="synthetic-token"
          currentUserId="user-a"
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const result = render(view(siteId));
  return { changeSite: (id: string) => result.rerender(view(id)) };
}

it.each(['timetable', 'list'])('shows backend ABSENT in the %s schedule view', async (mode) => {
  vi.mocked(SmartSiteManagementClient.prototype.attendanceDays).mockResolvedValue({
    items: [
      {
        id: 'absent-day',
        workerId: 'worker-a',
        workerName: 'Worker A',
        workDate: '2030-01-01',
        timezone: 'Asia/Ho_Chi_Minh',
        scheduleId: 'site-1-morning',
        shiftName: 'Morning',
        startsAt: '2030-01-01T01:00:00Z',
        endsAt: '2030-01-01T10:00:00Z',
        breakStartsAt: null,
        breakEndsAt: null,
        status: 'ABSENT',
        regularMinutes: 0,
        overtimeMinutes: 0,
        provisionalMinutes: 0,
        confirmedMinutes: null,
        presence: 'OUTSIDE',
        anomalies: [],
        version: 1,
        canRequest: false,
      },
    ],
    total: 1,
    requests: [],
    canReview: false,
    canRequest: true,
  });
  mount();
  if (mode === 'list') fireEvent.click(await screen.findByRole('button', { name: 'List' }));
  expect(await screen.findByText('Absent')).toBeTruthy();
  expect(screen.queryByText('ABSENT')).toBeNull();
  await act(async () => {
    await i18n.changeLanguage('vi');
  });
  expect(await screen.findByText('Vắng mặt')).toBeTruthy();
  expect(SmartSiteManagementClient.prototype.attendanceDays).toHaveBeenCalledWith(
    'synthetic-token',
    'site-1',
    expect.objectContaining({ workerId: 'worker-a' }),
  );
});

it.each([
  ['site-1', 'Demo Construction Site', 'timetable'],
  ['site-1', 'Demo Construction Site', 'list'],
  ['site-2', 'Thu Duc Site', 'timetable'],
  ['site-2', 'Thu Duc Site', 'list'],
])(
  'shows the schedule Site %s (%s) in %s view and shares its lookup across shifts',
  async (id, name, mode) => {
    mount(id);
    if (mode === 'list') fireEvent.click(await screen.findByRole('button', { name: 'List' }));
    const labels = await screen.findAllByText(name);
    expect(labels).toHaveLength(2);
    expect(labels.every((label) => label.getAttribute('title') === name)).toBe(true);
    expect(screen.queryByText('Main Construction Area')).toBeNull();
    expect(SmartSiteManagementClient.prototype.getSite).toHaveBeenCalledExactlyOnceWith(
      'synthetic-token',
      id,
    );
  },
);

it('does not reuse the previous Site name when switching Sites', async () => {
  const { changeSite } = mount();
  await screen.findAllByText('Demo Construction Site');
  changeSite('site-2');
  await screen.findAllByText('Thu Duc Site');
  expect(screen.queryByText('Demo Construction Site')).toBeNull();
});

it('lets keyboard users switch views using the summary cards', async () => {
  const user = userEvent.setup();
  mount();
  const requests = await screen.findByRole('button', { name: /Shift Requests/ });
  requests.focus();
  await user.keyboard('{Enter}');
  expect(requests.getAttribute('aria-pressed')).toBe('true');
  const schedule = screen.getByRole('button', { name: /Upcoming shifts/ });
  schedule.focus();
  await user.keyboard(' ');
  expect(schedule.getAttribute('aria-pressed')).toBe('true');
  expect(requests.getAttribute('aria-pressed')).toBe('false');
});

it('shows loading until the Site lookup finishes', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.getSite).mockImplementation(
    () => new Promise(() => {}),
  );
  mount();
  expect(await screen.findAllByText('Loading site...')).toHaveLength(2);
});

it.each(['network', 403] as const)(
  'shows unavailable with retry when the Site lookup fails (%s)',
  async (status) => {
    const siteLookup = vi.mocked(SmartSiteManagementClient.prototype.getSite);
    siteLookup.mockRejectedValueOnce(
      new ApiError(
        status === 'network' ? 'network' : 'http',
        'Synthetic private detail',
        status === 'network' ? undefined : status,
      ),
    );
    mount();
    expect(await screen.findAllByText('Site name unavailable')).toHaveLength(2);
    expect(screen.queryByText('Synthetic private detail')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry loading site name' })[0]!);
    expect(await screen.findAllByText('Demo Construction Site')).toHaveLength(2);
  },
);

it('does not label a shift with metadata for a different Site', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.getSite).mockResolvedValue({
    id: 'site-2',
    code: 'OTHER',
    name: 'Wrong Site',
    createdAt: '2030-01-01T00:00:00Z',
  });
  mount();
  expect(await screen.findAllByText('Site name unavailable')).toHaveLength(2);
  expect(screen.queryByText('Wrong Site')).toBeNull();
});

it.each(['timetable', 'list'])(
  'locks ended shifts in %s view while allowing an ongoing shift',
  async (mode) => {
    vi.setSystemTime(new Date('2030-01-01T10:00:00Z'));
    vi.mocked(SmartSiteManagementClient.prototype.listShifts).mockResolvedValue({
      items: ['morning', 'evening'].map((id) => ({
        id,
        siteId: 'site-1',
        name: id,
        startsAt: id === 'morning' ? '2026-01-01T08:00:00Z' : '2026-01-01T09:00:00Z',
        endsAt: id === 'morning' ? '2026-01-01T10:00:00Z' : '2026-01-01T17:00:00Z',
        timezone: 'UTC',
        createdAt: '2026-01-01T00:00:00Z',
      })),
      total: 2,
    });
    mount();
    if (mode === 'list') fireEvent.click(await screen.findByRole('button', { name: 'List' }));
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Request change' })).toHaveLength(1),
    );
    expect(screen.getAllByRole('button', { name: 'Swap shift' })).toHaveLength(1);
    expect(screen.getByText(/Shift ended/)).toBeTruthy();
  },
);

it.each(['Request change', 'Swap shift'])(
  'locks the open %s form when the shift ends',
  async (action) => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date('2030-01-01T09:59:59Z'));
    vi.mocked(SmartSiteManagementClient.prototype.listShifts).mockResolvedValue({
      items: ['morning', 'evening'].map((id) => ({
        id,
        siteId: 'site-1',
        name: id,
        startsAt: '2026-01-01T08:00:00Z',
        endsAt: '2026-01-01T10:00:00Z',
        timezone: 'UTC',
        createdAt: '2026-01-01T00:00:00Z',
      })),
      total: 2,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listEligibleShifts').mockResolvedValue({
      items: [],
      total: 0,
    });
    vi.spyOn(SmartSiteManagementClient.prototype, 'listSwapCandidates').mockResolvedValue({
      items: [],
      total: 0,
    });
    mount();
    fireEvent.click((await screen.findAllByRole('button', { name: action }))[0]!);
    expect(screen.queryByText('This shift has ended. Changes are no longer allowed.')).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(15_000);
    });
    expect(screen.getByRole('alert').textContent).toBe(
      'This shift has ended. Changes are no longer allowed.',
    );
    const name = action === 'Request change' ? 'Submit Change Request' : 'Submit Swap Request';
    expect(screen.getByRole('button', { name }).hasAttribute('disabled')).toBe(true);
  },
);

it('displays worker assigned team and enables eligible swap workflow', async () => {
  vi.spyOn(SmartSiteManagementClient.prototype, 'myContractorTeam').mockResolvedValue({
    workerId: 'worker-a',
    displayName: 'Worker A',
    membershipId: 'mem-1',
    teamId: 'team-paint',
    teamName: 'Painting Squad',
    zones: [
      {
        id: 'grant',
        contractorZonePermissionId: 'parent',
        zoneId: 'zone',
        name: 'Painting Zone',
        validFrom: '2026-01-01T00:00:00Z',
        validUntil: '2030-01-01T00:00:00Z',
        revokedAt: null,
        effective: true,
      },
    ],
  });
  mount();
  expect(await screen.findByText(/Team: Painting Squad/i)).not.toBeNull();
  expect(await screen.findByText('Zone: Painting Zone')).not.toBeNull();
  expect(screen.queryByText(/Member of Painting Squad/i)).toBeNull();
});

it('displays unassigned status and disables swap submission when worker is not in a team', async () => {
  vi.spyOn(SmartSiteManagementClient.prototype, 'myContractorTeam').mockResolvedValue({
    workerId: 'worker-a',
    displayName: 'Worker A',
    membershipId: null,
    teamId: null,
    teamName: null,
  });
  vi.mocked(SmartSiteManagementClient.prototype.listShifts).mockResolvedValue({
    items: ['morning'].map((id) => ({
      id,
      siteId: 'site-1',
      name: id,
      startsAt: '2030-01-01T08:00:00Z',
      endsAt: '2030-01-01T17:00:00Z',
      timezone: 'UTC',
      createdAt: '2026-01-01T00:00:00Z',
    })),
    total: 1,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listSwapCandidates').mockResolvedValue({
    items: [],
    total: 0,
  });
  mount();
  expect(await screen.findByText(/Unassigned/i)).not.toBeNull();

  // Open swap dialog
  fireEvent.click((await screen.findAllByRole('button', { name: 'Swap shift' }))[0]!);

  expect(screen.getAllByText(/Unassigned/i).length).toBeGreaterThan(0);
  const submitBtn = screen.getByRole('button', { name: 'Submit Swap Request' });
  expect(submitBtn.hasAttribute('disabled')).toBe(true);
});

it('displays loading indicator while fetching worker team status', async () => {
  vi.spyOn(SmartSiteManagementClient.prototype, 'myContractorTeam').mockImplementation(
    () => new Promise(() => {}),
  );
  mount();
  expect(await screen.findByLabelText('Loading worker team status')).not.toBeNull();
  expect(screen.getByText('Loading worker team status...')).not.toBeNull();
});

it('displays error and allows retry when myContractorTeam query fails', async () => {
  const myTeamSpy = vi.spyOn(SmartSiteManagementClient.prototype, 'myContractorTeam');
  myTeamSpy.mockRejectedValueOnce(new Error('Network error loading team'));
  mount();

  expect(await screen.findByText(/Failed to load/i)).not.toBeNull();
  expect(screen.getByText('Something went wrong. Please try again.')).not.toBeNull();

  // Retry loading team status
  myTeamSpy.mockResolvedValueOnce({
    workerId: 'worker-a',
    displayName: 'Worker A',
    membershipId: 'mem-2',
    teamId: 'team-carpentry',
    teamName: 'Carpentry Crew',
  });

  fireEvent.click(screen.getByRole('button', { name: 'Retry loading team status' }));

  expect(await screen.findByText(/Carpentry Crew/i)).not.toBeNull();
});

it('gates swap submission when worker team query fails', async () => {
  vi.spyOn(SmartSiteManagementClient.prototype, 'myContractorTeam').mockRejectedValueOnce(
    new Error('Out of scope'),
  );
  vi.mocked(SmartSiteManagementClient.prototype.listShifts).mockResolvedValue({
    items: ['morning'].map((id) => ({
      id,
      siteId: 'site-1',
      name: id,
      startsAt: '2030-01-01T08:00:00Z',
      endsAt: '2030-01-01T17:00:00Z',
      timezone: 'UTC',
      createdAt: '2026-01-01T00:00:00Z',
    })),
    total: 1,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listSwapCandidates').mockResolvedValue({
    items: [],
    total: 0,
  });
  mount();

  expect(await screen.findByText(/Failed to load/i)).not.toBeNull();

  // Open swap modal
  fireEvent.click((await screen.findAllByRole('button', { name: 'Swap shift' }))[0]!);

  expect(await screen.findByText(/Cannot verify team for shift swap/i)).not.toBeNull();
  const submitBtn = screen.getByRole('button', { name: 'Submit Swap Request' });
  expect(submitBtn.hasAttribute('disabled')).toBe(true);
});
