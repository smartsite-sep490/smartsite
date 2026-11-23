// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  SmartSiteManagementClient,
  type ContractorTeamResponse,
  type ScheduleTeamAttendanceResponse,
  type WorkerScheduleResponse,
} from '@smartsite/api-client';
import i18n from '../../i18n';
import { attendanceLabel } from '../access/attendance/attendance-display';
import { TeamAttendanceDialog } from './TeamAttendanceDialog';
import { TeamLeaderDialog } from './TeamLeaderDialog';
import { TeamAttendanceReportDialog } from './TeamAttendanceReportDialog';

const props = {
  apiUrl: 'https://api.example.test',
  token: 'synthetic-token',
  sessionScope: 'session-a',
  siteId: 'site-a',
  onClose: vi.fn(),
};
const leaderKey = [
  'team-leader',
  props.apiUrl,
  props.sessionScope,
  props.siteId,
  'contractor',
  'team',
];
const attendanceKey = [
  'team-zone-attendance',
  props.apiUrl,
  props.sessionScope,
  props.siteId,
  'schedule-a',
];
const schedule: WorkerScheduleResponse = {
  id: 'schedule-a',
  siteId: props.siteId,
  workerId: 'worker-a',
  shiftId: 'shift',
  scheduleVersionId: 'version',
  workDate: '2030-01-01',
  isActive: true,
  createdAt: '2029-12-01T00:00:00Z',
};
let cache: QueryClient;
let team: ContractorTeamResponse;
let attendance: ScheduleTeamAttendanceResponse;

beforeEach(() => {
  cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  team = {
    id: 'team',
    siteId: props.siteId,
    contractorId: 'contractor',
    name: 'Painting team',
    description: '',
    version: 3,
    isActive: true,
    memberCount: 2,
    leaderWorkerId: null,
  };
  const members = ['a', 'b'].map((id) => ({
    scheduleId: `schedule-${id}`,
    membershipId: `membership-${id}`,
    workerId: `worker-${id}`,
    displayName: `Worker ${id.toUpperCase()}`,
    status: 'NOT_YET' as const,
    version: 0,
    updatedAt: null,
    gateCheck: 'GATE_ONLY' as const,
    locked: false,
  }));
  attendance = {
    own: members[0]!,
    teamId: 'team',
    teamName: 'Painting team',
    zoneId: 'zone',
    zoneName: 'Zone A',
    canManage: true,
    canSubmit: true,
    members,
  };
  vi.spyOn(SmartSiteManagementClient.prototype, 'contractorTeamDetail').mockImplementation(
    async () => team,
  );
  vi.spyOn(SmartSiteManagementClient.prototype, 'listContractorTeamWorkers').mockResolvedValue({
    items: members.map((m) => ({
      workerId: m.workerId,
      displayName: m.displayName,
      membershipId: m.membershipId,
      teamId: 'team',
      teamName: team.name,
    })),
    total: 2,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'setContractorTeamLeader').mockImplementation(
    async (_token, _site, _contractor, _team, input) => {
      team = { ...team, leaderWorkerId: input.workerId, version: team.version + 1 };
      return team;
    },
  );
  vi.spyOn(SmartSiteManagementClient.prototype, 'scheduleTeamAttendance').mockImplementation(
    async () => attendance,
  );
  vi.spyOn(SmartSiteManagementClient.prototype, 'listShifts').mockResolvedValue({
    items: [
      {
        id: 'shift',
        siteId: props.siteId,
        name: 'Morning',
        startsAt: '2030-01-01T01:00:00Z',
        endsAt: '2030-01-01T10:00:00Z',
        timezone: 'Asia/Ho_Chi_Minh',
        createdAt: '2029-12-01T00:00:00Z',
      },
    ],
    total: 1,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listScheduleVersions').mockResolvedValue({
    items: [
      {
        id: 'version',
        siteId: props.siteId,
        version: 1,
        effectiveFrom: '2029-01-01T00:00:00Z',
        effectiveUntil: null,
        createdAt: '2029-01-01T00:00:00Z',
      },
    ],
    total: 1,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'contractorTeamAttendance').mockResolvedValue({
    teamId: 'team',
    teamName: team.name,
    workDate: '2030-01-01',
    total: 2,
    present: 0,
    absent: 0,
    pending: 2,
    matched: 0,
    items: members.map((member) => ({ ...member, zoneName: 'Zone A', dayId: null })),
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'submitTeamAttendance').mockImplementation(
    async () => attendance,
  );
});
afterEach(() => {
  cleanup();
  cache.clear();
  vi.restoreAllMocks();
});

function mountLeader() {
  render(
    <QueryClientProvider client={cache}>
      <TeamLeaderDialog
        {...props}
        contractorId="contractor"
        teamId="team"
        teamName="Painting team"
      />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}
function mountAttendance() {
  const view = (sessionScope: string) => (
    <QueryClientProvider client={cache}>
      <TeamAttendanceDialog
        key={sessionScope}
        {...props}
        sessionScope={sessionScope}
        schedule={schedule}
      />
    </QueryClientProvider>
  );
  const result = render(view(props.sessionScope));
  return { user: userEvent.setup(), changeSession: (id: string) => result.rerender(view(id)) };
}

function mountReport() {
  render(
    <QueryClientProvider client={cache}>
      <TeamAttendanceReportDialog
        {...props}
        contractorId="contractor"
        teamId="team"
        teamName="Painting team"
      />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

it('lets the representative read scoped Zone results without attendance write controls', async () => {
  mountReport();
  await screen.findByText('Worker B');
  expect(SmartSiteManagementClient.prototype.contractorTeamAttendance).toHaveBeenCalledWith(
    props.token,
    props.siteId,
    'contractor',
    'team',
    {
      workDate: expect.any(String),
      shiftId: 'shift',
      scheduleVersionId: 'version',
      offset: 0,
      limit: 20,
    },
  );
  expect(screen.queryByRole('button', { name: 'Present' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Save attendance' })).toBeNull();
  expect(SmartSiteManagementClient.prototype.submitTeamAttendance).not.toHaveBeenCalled();
});

it('paginates the representative report through its scoped read API', async () => {
  const response = await vi.mocked(SmartSiteManagementClient.prototype.contractorTeamAttendance)(
    '',
    '',
    '',
    '',
    { workDate: '2030-01-01', shiftId: 'shift', scheduleVersionId: 'version' },
  );
  vi.mocked(SmartSiteManagementClient.prototype.contractorTeamAttendance)
    .mockClear()
    .mockResolvedValue({ ...response, total: 21 });
  const user = mountReport();
  await screen.findByText('Worker B');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByText('Worker B');
  expect(SmartSiteManagementClient.prototype.contractorTeamAttendance).toHaveBeenLastCalledWith(
    props.token,
    props.siteId,
    'contractor',
    'team',
    expect.objectContaining({ offset: 20 }),
  );
});

it('shows a failed representative report as unavailable rather than a zero attendance result', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.contractorTeamAttendance).mockRejectedValue(
    new Error('Unavailable'),
  );
  mountReport();
  await screen.findByRole('alert');
  expect(screen.queryByText(/0 present/)).toBeNull();
  expect(screen.queryByRole('table')).toBeNull();
});

it('assigns a current member as leader and refreshes the displayed name', async () => {
  const user = mountLeader();
  await user.selectOptions(await screen.findByLabelText('Select team leader'), 'worker-a');
  await user.click(screen.getByRole('button', { name: 'Save team leader' }));
  await screen.findByText('Current leader: Worker A');
  expect(SmartSiteManagementClient.prototype.setContractorTeamLeader).toHaveBeenCalledWith(
    props.token,
    props.siteId,
    'contractor',
    'team',
    { workerId: 'worker-a', expectedVersion: 3 },
  );
});

it.each(['worker-b', ''])('changes or removes an existing leader (%s)', async (choice) => {
  team.leaderWorkerId = 'worker-a';
  const user = mountLeader();
  await user.selectOptions(await screen.findByLabelText('Select team leader'), choice);
  await user.click(screen.getByRole('button', { name: 'Save team leader' }));
  await screen.findByText('Team leader updated.');
  expect(SmartSiteManagementClient.prototype.setContractorTeamLeader).toHaveBeenCalledWith(
    props.token,
    props.siteId,
    'contractor',
    'team',
    { workerId: choice || null, expectedVersion: 3 },
  );
});

it('loads all member pages and excludes records outside the selected team', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.listContractorTeamWorkers).mockImplementation(
    async (_token, _site, _contractor, query) => ({
      items: query?.offset
        ? [
            {
              workerId: 'worker-b',
              displayName: 'Worker B',
              membershipId: 'membership-b',
              teamId: 'team',
              teamName: team.name,
            },
          ]
        : [
            {
              workerId: 'foreign',
              displayName: 'Outside team',
              membershipId: 'foreign-membership',
              teamId: 'other-team',
              teamName: 'Other',
            },
          ],
      total: 2,
    }),
  );
  mountLeader();
  await screen.findByRole('option', { name: 'Worker B' });
  expect(screen.queryByRole('option', { name: 'Outside team' })).toBeNull();
  expect(SmartSiteManagementClient.prototype.listContractorTeamWorkers).toHaveBeenLastCalledWith(
    props.token,
    props.siteId,
    'contractor',
    { offset: 1, limit: 100, teamId: 'team' },
  );
});

it('blocks a stale leader assignment until the representative refreshes and selects again', async () => {
  const user = mountLeader();
  await user.selectOptions(await screen.findByLabelText('Select team leader'), 'worker-a');
  await act(async () =>
    cache.setQueryData(leaderKey, {
      ...cache.getQueryData<object>(leaderKey),
      team: { ...team, version: 4 },
    }),
  );
  await screen.findByText(/The team or attendance record has changed/);
  expect(screen.getByRole('button', { name: 'Save team leader' }).hasAttribute('disabled')).toBe(
    true,
  );
  expect(SmartSiteManagementClient.prototype.setContractorTeamLeader).not.toHaveBeenCalled();
});

it('shows leader read failures without allowing an assignment and supports retry', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.contractorTeamDetail).mockRejectedValueOnce(
    new Error('Unavailable'),
  );
  const user = mountLeader();
  await screen.findByRole('alert');
  expect(screen.queryByRole('combobox')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByLabelText('Select team leader');
  expect(SmartSiteManagementClient.prototype.setContractorTeamLeader).not.toHaveBeenCalled();
});

it('shows only personal status for an ordinary Worker', async () => {
  attendance.canManage = false;
  attendance.canSubmit = false;
  mountAttendance();
  await screen.findByText(/Your team leader records Zone attendance/);
  expect(screen.queryByRole('group')).toBeNull();
  expect(screen.queryByText('Worker B')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Save attendance' })).toBeNull();
});

it('submits only explicitly selected members with membership/version checks and refreshes attendance reports', async () => {
  cache.setQueryData(['attendance-summary', props.apiUrl, props.sessionScope, props.siteId], {
    total: 1,
  });
  const { user } = mountAttendance();
  const member = await screen.findByRole('group', { name: 'Worker A' });
  await user.click(within(member).getByRole('button', { name: 'Present' }));
  await user.click(screen.getByRole('button', { name: 'Save attendance' }));
  await screen.findByText(/Zone attendance saved/);
  expect(SmartSiteManagementClient.prototype.submitTeamAttendance).toHaveBeenCalledWith(
    props.token,
    props.siteId,
    schedule.id,
    {
      requestId: expect.any(String),
      teamId: 'team',
      zoneId: 'zone',
      entries: [
        {
          scheduleId: 'schedule-a',
          expectedMembershipId: 'membership-a',
          expectedVersion: 0,
          status: 'PRESENT',
        },
      ],
    },
  );
  expect(
    cache.getQueryState(['attendance-summary', props.apiUrl, props.sessionScope, props.siteId])
      ?.isInvalidated,
  ).toBe(true);
});

it('retains a stable request ID for retrying the same failed attendance command', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.submitTeamAttendance).mockRejectedValueOnce(
    new Error('Connection lost'),
  );
  const { user } = mountAttendance();
  await user.click(
    within(await screen.findByRole('group', { name: 'Worker A' })).getByRole('button', {
      name: 'Present',
    }),
  );
  await user.click(screen.getByRole('button', { name: 'Save attendance' }));
  await screen.findByRole('alert');
  await user.click(screen.getByRole('button', { name: 'Save attendance' }));
  await screen.findByText(/Zone attendance saved/);
  const calls = vi.mocked(SmartSiteManagementClient.prototype.submitTeamAttendance).mock.calls;
  expect(calls).toHaveLength(2);
  expect(calls[0]![3]).toEqual(calls[1]![3]);
});

it('requires a reason before correcting an existing attendance record', async () => {
  attendance.members[0] = { ...attendance.members[0]!, status: 'PRESENT', version: 2 };
  const { user } = mountAttendance();
  await user.click(
    within(await screen.findByRole('group', { name: 'Worker A' })).getByRole('button', {
      name: 'Absent',
    }),
  );
  const save = screen.getByRole('button', { name: 'Save attendance' });
  expect(save.hasAttribute('disabled')).toBe(true);
  await user.type(screen.getByLabelText('Reason for correction'), 'Checked with supervisor');
  await user.click(save);
  await screen.findByText(/Zone attendance saved/);
  expect(
    vi.mocked(SmartSiteManagementClient.prototype.submitTeamAttendance).mock.calls[0]![3],
  ).toMatchObject({
    reason: 'Checked with supervisor',
    entries: [{ expectedVersion: 2, status: 'ABSENT' }],
  });
});

it.each(['before-start', 'missing-zone', 'locked'] as const)(
  'blocks editing when attendance is unavailable: %s',
  async (kind) => {
    if (kind !== 'locked') attendance.canSubmit = false;
    if (kind === 'missing-zone') {
      attendance.zoneId = null;
      attendance.zoneName = null;
    }
    if (kind === 'locked') attendance.members[0] = { ...attendance.members[0]!, locked: true };
    mountAttendance();
    const member = await screen.findByRole('group', { name: 'Worker A' });
    expect(within(member).getByRole('button', { name: 'Present' }).matches(':disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Save attendance' }).hasAttribute('disabled')).toBe(
      true,
    );
  },
);

it('blocks stale membership drafts after a roster refresh', async () => {
  const { user } = mountAttendance();
  await user.click(
    within(await screen.findByRole('group', { name: 'Worker A' })).getByRole('button', {
      name: 'Present',
    }),
  );
  attendance = {
    ...attendance,
    members: attendance.members.map((m) => ({ ...m, membershipId: 'new-membership' })),
  };
  await act(async () => cache.setQueryData(attendanceKey, attendance));
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: 'Save attendance' }).hasAttribute('disabled')).toBe(
    true,
  );
  expect(SmartSiteManagementClient.prototype.submitTeamAttendance).not.toHaveBeenCalled();
});

it('hides roster controls if leadership is revoked after selection', async () => {
  const { user } = mountAttendance();
  await user.click(
    within(await screen.findByRole('group', { name: 'Worker A' })).getByRole('button', {
      name: 'Present',
    }),
  );
  await act(async () =>
    cache.setQueryData(attendanceKey, {
      ...attendance,
      canManage: false,
      canSubmit: false,
      members: [],
    }),
  );
  await screen.findByText(/Your team leader records Zone attendance/);
  expect(screen.queryByRole('button', { name: 'Save attendance' })).toBeNull();
  expect(SmartSiteManagementClient.prototype.submitTeamAttendance).not.toHaveBeenCalled();
});

it('keeps unavailable attendance as an error and clears drafts across sessions', async () => {
  const { user, changeSession } = mountAttendance();
  await user.click(
    within(await screen.findByRole('group', { name: 'Worker A' })).getByRole('button', {
      name: 'Present',
    }),
  );
  vi.mocked(SmartSiteManagementClient.prototype.scheduleTeamAttendance).mockRejectedValue(
    new Error('Unavailable'),
  );
  changeSession('session-b');
  await screen.findByRole('alert');
  expect(screen.queryByRole('group')).toBeNull();
  expect(SmartSiteManagementClient.prototype.submitTeamAttendance).not.toHaveBeenCalled();
});

it('translates the missing Zone attendance reason into a clear Vietnamese action', async () => {
  await i18n.changeLanguage('vi');
  expect(attendanceLabel('ZONE_ATTENDANCE_PENDING')).toBe('Chờ nhóm trưởng điểm danh khu vực');
  mountAttendance();
  await screen.findByRole('button', { name: 'Lưu điểm danh' });
  expect(screen.getByText('Danh sách điểm danh nhóm')).toBeTruthy();
});
