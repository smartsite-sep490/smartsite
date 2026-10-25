// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { ScheduleAssignmentForm } from '../components/ScheduleAssignmentForm';
const shifts = [
  {
    id: 'shift',
    siteId: 'site',
    name: 'Morning',
    startsAt: '2030-10-07T08:00:00Z',
    endsAt: '2030-10-07T17:00:00Z',
    timezone: 'UTC',
    createdAt: '2030-01-01',
    breakStartsAt: '2030-10-07T12:00:00Z',
    breakEndsAt: '2030-10-07T13:00:00Z',
  },
];
let cache: QueryClient;
beforeEach(() => {
  window.history.replaceState({}, '', '/');
  vi.spyOn(SmartSiteManagementClient.prototype, 'contractorDashboardScopes').mockResolvedValue({
    items: [
      {
        siteId: 'site',
        siteName: 'Synthetic site',
        siteCode: 'TEST',
        contractorId: 'contractor',
        contractorName: 'Synthetic contractor',
      },
    ],
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listContractorTeams').mockResolvedValue({
    items: [
      {
        id: 'team',
        siteId: 'site',
        contractorId: 'contractor',
        name: 'Team A',
        description: '',
        memberCount: 2,
        isActive: true,
        version: 1,
      },
    ],
    total: 1,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listContractorTeamWorkers').mockResolvedValue({
    items: ['a', 'b'].map((id) => ({
      workerId: id,
      displayName: `Worker ${id}`,
      membershipId: `mem-${id}`,
      teamId: 'team',
      teamName: 'Team A',
    })),
    total: 2,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listShiftContractorAssignments').mockResolvedValue(
    {
      items: [
        {
          id: 'grant',
          siteId: 'site',
          contractorId: 'contractor',
          shiftId: 'shift',
          createdAt: '2030-01-01',
        },
      ],
      total: 1,
    },
  );
  vi.spyOn(SmartSiteManagementClient.prototype, 'listScheduleAssignments').mockResolvedValue({
    items: [],
    total: 0,
  });
});
afterEach(() => {
  cleanup();
  cache?.clear();
  vi.restoreAllMocks();
});
it('allows only Mondays in the weekly calendar and sends Monday through Sunday', async () => {
  const preview = vi
    .spyOn(SmartSiteManagementClient.prototype, 'previewScheduleAssignment')
    .mockResolvedValue(previewData);
  mount();
  await select();
  fireEvent.change(screen.getByLabelText('Apply schedule'), { target: { value: 'WEEK' } });
  fireEvent.click(screen.getByLabelText(/Week starting Monday/));
  const tuesday = await screen.findByRole('button', { name: /Tuesday, October 8th, 2030/ });
  expect(tuesday).toHaveProperty('disabled', true);
  fireEvent.click(tuesday);
  fireEvent.click(screen.getByRole('button', { name: /Monday, October 14th, 2030/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Preview assignments' }));
  await waitFor(() =>
    expect(preview).toHaveBeenCalledWith(
      'token',
      'site',
      expect.objectContaining({ mode: 'WEEK', fromDate: '2030-10-14', toDate: '2030-10-20' }),
    ),
  );
});

it('requires an explicit Monday after switching from a non-Monday without changing the selected date silently', async () => {
  const preview = vi
    .spyOn(SmartSiteManagementClient.prototype, 'previewScheduleAssignment')
    .mockResolvedValue(previewData);
  mount();
  await select();
  fireEvent.change(screen.getByLabelText('Work date'), { target: { value: '2030-10-08' } });
  fireEvent.change(screen.getByLabelText('Apply schedule'), { target: { value: 'WEEK' } });
  expect(screen.getByText('Select a Monday to continue.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Preview assignments' })).toHaveProperty(
    'disabled',
    true,
  );
  expect(preview).not.toHaveBeenCalled();
});

it('does not load or assign a contractor outside the authenticated scopes from a URL', async () => {
  window.history.replaceState({}, '', '/?contractorId=other-contractor');
  mount();
  await screen.findByText('No active contractor assignment is available for this site.');
  expect(SmartSiteManagementClient.prototype.listContractorTeams).not.toHaveBeenCalled();
});
function mount() {
  cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={cache}>
      <ScheduleAssignmentForm
        apiUrl="https://synthetic.test"
        token="token"
        siteId="site"
        shifts={shifts}
        versions={[
          {
            id: 'version',
            siteId: 'site',
            version: 1,
            effectiveFrom: '2030-01-01',
            effectiveUntil: null,
            createdAt: '2030-01-01',
          },
        ]}
      />
    </QueryClientProvider>,
  );
}
const previewData = {
  fingerprint: 'a'.repeat(64),
  targetName: 'Team A',
  members: [
    { workerId: 'a', workerName: 'Worker a', membershipId: 'mem-a' },
    { workerId: 'b', workerName: 'Worker b', membershipId: 'mem-b' },
  ],
  dates: ['2030-10-07'],
  assignmentCount: 2,
  conflicts: [],
};
const batchData = {
  id: 'batch',
  version: 1,
  teamId: 'team',
  targetName: 'Team A',
  input: {
    contractorId: 'contractor',
    scheduleVersionId: 'version',
    shiftId: 'shift',
    target: 'TEAM' as const,
    teamId: 'team',
    mode: 'REPEAT' as const,
    fromDate: '2030-10-07',
    toDate: '2030-11-01',
    weekdays: [1, 2, 3, 4, 5],
  },
  members: previewData.members,
  dates: ['2030-10-07', '2030-10-08'],
  createdAt: '2030-01-01',
};
it('shows batch dates as day/month/year with the target and counts separately', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.listScheduleAssignments).mockResolvedValue({
    items: [batchData],
    total: 1,
  });
  mount();
  expect(await screen.findByRole('heading', { name: 'Team A' })).toBeTruthy();
  expect(screen.getByText('07/10/2030')).toBeTruthy();
  expect(screen.getByText('08/10/2030')).toBeTruthy();
  expect(screen.getByText('2 worker(s) across 2 day(s)')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Edit' }).getAttribute('aria-expanded')).toBe('false');
});

it('shows a single-day batch date once', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.listScheduleAssignments).mockResolvedValue({
    items: [{ ...batchData, dates: ['2030-10-07'] }],
    total: 1,
  });
  mount();
  expect(await screen.findByText('07/10/2030')).toBeTruthy();
  expect(screen.getAllByText('07/10/2030')).toHaveLength(1);
  expect(screen.queryByText('2030-10-07')).toBeNull();
});

async function select() {
  await screen.findByRole('option', { name: /^Team A \(2(?: members)?\)$/ });
  fireEvent.change(screen.getByLabelText('Team'), { target: { value: 'team' } });
  fireEvent.change(screen.getByLabelText('Shift'), { target: { value: 'shift' } });
  fireEvent.change(screen.getByLabelText('Work date'), { target: { value: '2030-10-07' } });
}
it('previews all members, invalidates preview after edits and saves only after confirmation', async () => {
  const preview = vi
    .spyOn(SmartSiteManagementClient.prototype, 'previewScheduleAssignment')
    .mockResolvedValue(previewData);
  const save = vi
    .spyOn(SmartSiteManagementClient.prototype, 'createScheduleAssignment')
    .mockResolvedValue({
      id: 'batch',
      version: 1,
      teamId: 'team',
      targetName: 'Team A',
      input: {
        contractorId: 'contractor',
        scheduleVersionId: 'version',
        shiftId: 'shift',
        target: 'TEAM',
        teamId: 'team',
        mode: 'DAY',
        fromDate: '2030-10-07',
        toDate: '2030-10-07',
        weekdays: [1, 2, 3, 4, 5],
      },
      members: previewData.members,
      dates: previewData.dates,
      createdAt: '2030-01-01',
    });
  mount();
  await select();
  fireEvent.click(screen.getByRole('button', { name: 'Preview assignments' }));
  await screen.findByText(/No conflicts found/);
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText('Worker b'));
  expect(screen.queryByRole('button', { name: 'Confirm assignments' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Preview assignments' }));
  await screen.findByText(/No conflicts found/);
  expect(preview.mock.calls.at(-1)?.[2].selectedWorkerIds).toEqual(['a']);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm assignments' }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      'token',
      'site',
      expect.objectContaining({
        requestId: expect.any(String),
        expectedFingerprint: previewData.fingerprint,
        selectedWorkerIds: ['a'],
      }),
    ),
  );
});
it('lists conflicts and blocks confirm; submits bounded weekly repetition with chosen weekdays', async () => {
  const preview = vi
    .spyOn(SmartSiteManagementClient.prototype, 'previewScheduleAssignment')
    .mockResolvedValue({
      ...previewData,
      conflicts: [
        {
          workerId: 'a',
          workerName: 'Worker a',
          workDate: '2030-10-07',
          scheduleId: 'old',
          shiftName: 'Evening',
        },
      ],
    });
  const save = vi.spyOn(SmartSiteManagementClient.prototype, 'createScheduleAssignment');
  mount();
  await select();
  fireEvent.change(screen.getByLabelText('Apply schedule'), { target: { value: 'REPEAT' } });
  fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2030-11-01' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview assignments' }));
  await screen.findByText(/Conflicts found/);
  expect(
    (screen.getByRole('button', { name: 'Confirm assignments' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(save).not.toHaveBeenCalled();
  expect(preview).toHaveBeenCalledWith(
    'token',
    'site',
    expect.objectContaining({
      mode: 'REPEAT',
      fromDate: '2030-10-07',
      toDate: '2030-11-01',
      weekdays: [1, 2, 3, 4, 5],
    }),
  );
});
it('reuses the same request ID after an unavailable response instead of creating another batch', async () => {
  vi.spyOn(SmartSiteManagementClient.prototype, 'previewScheduleAssignment').mockResolvedValue(
    previewData,
  );
  const save = vi
    .spyOn(SmartSiteManagementClient.prototype, 'createScheduleAssignment')
    .mockRejectedValueOnce(new Error('Response unavailable'))
    .mockResolvedValue(batchData);
  mount();
  await select();
  fireEvent.click(screen.getByRole('button', { name: 'Preview assignments' }));
  await screen.findByText(/No conflicts found/);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm assignments' }));
  await screen.findByText('Something went wrong. Please try again.');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm assignments' }));
  await waitFor(() => expect(save.mock.calls).toHaveLength(2));
  expect(save.mock.calls[0]?.[2].requestId).toBe(save.mock.calls[1]?.[2].requestId);
});
it('shows one batch edit entry and sends an explicit one-worker future cancellation', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.listScheduleAssignments).mockResolvedValue({
    items: [batchData],
    total: 1,
  });
  vi.mocked(SmartSiteManagementClient.prototype.listContractorTeamWorkers).mockResolvedValue({
    items: ['a', 'b', 'c'].map((id) => ({
      workerId: id,
      displayName: `Worker ${id}`,
      membershipId: `mem-${id}`,
      teamId: 'team',
      teamName: 'Team A',
    })),
    total: 3,
  });
  const change = vi
    .spyOn(SmartSiteManagementClient.prototype, 'changeScheduleAssignment')
    .mockResolvedValue({ id: 'batch', version: 2 });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  expect(screen.queryByRole('button', { name: 'Edit unstarted schedules' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Apply remaining dates to new members' })).toBeNull();
  expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('Apply change to'), { target: { value: 'FROM_DATE' } });
  fireEvent.change(screen.getByLabelText('Affected workers'), { target: { value: 'a' } });
  fireEvent.change(screen.getByLabelText('Change reason'), {
    target: { value: 'Moved to another team' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm schedule change' }));
  await waitFor(() =>
    expect(change).toHaveBeenCalledWith(
      'token',
      'site',
      'batch',
      expect.objectContaining({
        expectedVersion: 1,
        action: 'CANCEL',
        scope: 'FROM_DATE',
        workerId: 'a',
        reason: 'Moved to another team',
      }),
    ),
  );
});
it('edits all unstarted batch schedules without choosing dates and reports protected skips', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.listScheduleAssignments).mockResolvedValue({
    items: [batchData],
    total: 1,
  });
  const change = vi
    .spyOn(SmartSiteManagementClient.prototype, 'changeScheduleAssignment')
    .mockRejectedValueOnce(new Error('Response unavailable'))
    .mockResolvedValue({ id: 'batch', version: 2, changedCount: 3, skippedCount: 2 });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByLabelText('Apply change to'), { target: { value: 'UNSTARTED' } });
  fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'CHANGE_SHIFT' } });
  expect(screen.queryByLabelText('Change date')).toBeNull();
  expect((screen.getByLabelText('Apply change to') as HTMLSelectElement).value).toBe('UNSTARTED');
  fireEvent.change(screen.getByLabelText('Replacement shift'), { target: { value: 'shift' } });
  fireEvent.change(screen.getByLabelText('Change reason'), {
    target: { value: 'Correct future assignments' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm schedule change' }));
  await screen.findByText('Something went wrong. Please try again.');
  fireEvent.click(screen.getByRole('button', { name: 'Confirm schedule change' }));
  await screen.findByText(
    '3 schedule(s) updated. 2 started or attendance-protected schedule(s) skipped.',
  );
  expect(change.mock.calls[0]?.[3]).toEqual(
    expect.objectContaining({
      scope: 'UNSTARTED',
      action: 'CHANGE_SHIFT',
      shiftId: 'shift',
      expectedVersion: 1,
    }),
  );
  expect(change.mock.calls[0]?.[3].requestId).toBe(change.mock.calls[1]?.[3].requestId);
});
it('cancels unstarted schedules for one selected worker and keeps the form on conflict', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.listScheduleAssignments).mockResolvedValue({
    items: [batchData],
    total: 1,
  });
  const change = vi
    .spyOn(SmartSiteManagementClient.prototype, 'changeScheduleAssignment')
    .mockRejectedValue(new Error('No unstarted schedules without attendance remain in this batch'));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByLabelText('Apply change to'), { target: { value: 'UNSTARTED' } });
  fireEvent.change(screen.getByLabelText('Action'), { target: { value: 'CANCEL' } });
  expect(screen.queryByLabelText('Replacement shift')).toBeNull();
  fireEvent.change(screen.getByLabelText('Affected workers'), { target: { value: 'b' } });
  fireEvent.change(screen.getByLabelText('Change reason'), {
    target: { value: 'Cancel remaining assignments' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm schedule change' }));
  await screen.findByText('No unstarted schedules without attendance remain in this batch');
  expect(change.mock.calls[0]?.[3]).toEqual(
    expect.objectContaining({
      scope: 'UNSTARTED',
      action: 'CANCEL',
      workerId: 'b',
    }),
  );
  expect(change.mock.calls[0]?.[3]).not.toHaveProperty('shiftId');
  expect(screen.getByLabelText('Change reason')).toBeTruthy();
});
