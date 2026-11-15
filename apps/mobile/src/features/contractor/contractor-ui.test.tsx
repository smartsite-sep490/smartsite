import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SmartSiteManagementClient, type AttendanceDayResponse } from '@smartsite/api-client';
import type { useWorkspace } from '../workspace/workspace-context';
import { MobileLayoutProvider } from '../shared/mobile-layout';
import { translate as t } from '../../i18n';
import { ContractorHome } from './contractor-home';
import { ContractorSchedule } from './contractor-schedule';
import { WorkforceScreen } from './workforce-screen';
import { ProfileScreen } from '../workspace/home-profile';

vi.mock('../workspace/workspace-context', () => ({ useWorkspace: () => workspace }));
vi.mock('../auth/auth-context', () => ({ useAuth: () => ({ session: {} }) }));
vi.mock('../../components/modals/CreateWorkerModal', () => ({ CreateWorkerModal: () => null }));
vi.mock('../../components/modals/ScheduleAssignModal', () => ({ ScheduleAssignModal: () => null }));
vi.mock('./worker-documents', () => ({ WorkerDocuments: () => null }));
vi.mock('../shared/uploads', () => ({ Attachments: () => null, EvidenceButton: () => null }));
let workspace: ReturnType<typeof useWorkspace>;
let root: ReactTestRenderer;
let cache: QueryClient;
const people = Array.from({ length: 10 }, (_, index) => ({
  id: `worker-${index}`,
  userId: `user-${index}`,
  siteId: 'site',
  contractorId: 'contractor',
  externalId: `W${index}`,
  displayName: `Synthetic Worker ${index}`,
  isActive: true,
  createdAt: '',
}));
function buttons(label: string) {
  return root.root.findAll(
    (node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === label,
  );
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
}
async function mount(element: React.ReactNode) {
  await act(async () => {
    root = create(
      <QueryClientProvider client={cache}>
        <MobileLayoutProvider compact>{element}</MobileLayoutProvider>
      </QueryClientProvider>,
    );
  });
  await settle();
  await settle();
}
async function click(label: string) {
  for (let attempt = 0; !buttons(label).length && attempt < 30; attempt++) await settle();
  expect(buttons(label).length).toBeGreaterThan(0);
  await act(async () => buttons(label)[0]!.props.onPress());
  await settle();
}
beforeEach(() => {
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const client = new SmartSiteManagementClient('https://api.example.test');
  workspace = {
    client,
    token: 'token',
    workerId: '',
    queryKey: ['mobile', 'contractor-ui'],
    canSwitchScope: true,
    user: {
      id: 'rep',
      username: 'representative',
      displayName: 'Synthetic Representative',
      isActive: true,
      mustChangePassword: false,
      roleAssignments: [{ role: 'CONTRACTOR_REPRESENTATIVE', siteId: 'site' }],
    },
    scope: {
      role: 'contractor',
      siteId: 'site',
      siteName: 'Synthetic Site',
      contractorId: 'contractor',
      contractorName: 'Synthetic Contractor',
    },
  };
  vi.spyOn(client, 'contractorDashboard').mockResolvedValue({
    scope: { ...workspace.scope, siteCode: 'SITE' },
    workerCount: 10,
    teamCount: 3,
    unassignedWorkerCount: 2,
  });
  vi.spyOn(client, 'listShiftRequests').mockResolvedValue({
    items: [],
    total: 12,
    pendingCount: 4,
    incomingCount: 0,
    pendingScheduleIds: [],
  });
  vi.spyOn(client, 'listWorkers').mockResolvedValue({
    items: [
      ...people,
      {
        ...people[0]!,
        id: 'private-worker',
        contractorId: 'other-contractor',
        displayName: 'Private Other Worker',
      },
    ],
    total: 11,
  });
  vi.spyOn(client, 'listShifts').mockResolvedValue({
    items: [
      {
        id: 'shift',
        siteId: 'site',
        name: 'Synthetic Shift',
        startsAt: '2026-11-09T01:00:00Z',
        endsAt: '2026-11-09T10:00:00Z',
        timezone: 'Asia/Ho_Chi_Minh',
        createdAt: '',
      },
    ],
    total: 1,
  });
  vi.spyOn(client, 'listWorkerSchedules').mockResolvedValue({
    items: [
      {
        id: 'schedule',
        workerId: 'worker-0',
        siteId: 'site',
        shiftId: 'shift',
        scheduleVersionId: 'version',
        workDate: '2026-11-09',
        isActive: true,
        createdAt: '',
      },
    ],
    total: 1,
  });
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  cache.clear();
  vi.restoreAllMocks();
});

it('shows real workforce and pending totals and keeps secondary tools one tap away', async () => {
  const navigate = vi.fn();
  await mount(<ContractorHome navigate={navigate} />);
  expect(JSON.stringify(root.toJSON())).toContain(t('contractorUi.unassigned', { count: 2 }));
  expect(JSON.stringify(root.toJSON())).toContain(t('contractorUi.pending', { count: 4 }));
  expect(workspace.client.contractorDashboard).toHaveBeenCalledWith('token', 'site', 'contractor');
  expect(buttons(t('contractorHome.teamAttendance'))).toHaveLength(0);
  expect(buttons(t('teams.title'))).toHaveLength(0);
  await click(t('contractorUi.managementTools'));
  await click(t('teams.title'));
  expect(navigate).toHaveBeenCalledWith({ route: 'teams' });
});

it('paginates the contractor roster in eight compact rows without leaking another contractor', async () => {
  await mount(<WorkforceScreen />);
  const profiles = () =>
    root.root.findAll(
      (node) =>
        String(node.type) === 'Pressable' &&
        node.props.accessibilityLabel?.startsWith(`${t('workforce.workerProfile')}:`),
    );
  expect(profiles()).toHaveLength(8);
  expect(JSON.stringify(root.toJSON())).not.toContain('Private Other Worker');
  await click(t('common.next'));
  expect(profiles()).toHaveLength(2);
  await click(`${t('workforce.workerProfile')}: Synthetic Worker 8`);
  await click(t('workforce.editWorker'));
  expect(buttons(t('common.save'))).toHaveLength(1);
});

it('keeps contractor schedule filters collapsed and sends the contractor scope and page size', async () => {
  await mount(<ContractorSchedule initialDate="2026-11-09" />);
  expect(workspace.client.listWorkerSchedules).toHaveBeenCalledWith(
    'token',
    'site',
    expect.objectContaining({
      contractorId: 'contractor',
      limit: 8,
      fromDate: '2026-11-09',
      toDate: '2026-11-09',
    }),
  );
  expect(buttons(t('requests.filter'))[0]!.props.accessibilityState.expanded).toBe(false);
  expect(JSON.stringify(root.toJSON())).toContain('Synthetic Shift');
  expect(JSON.stringify(root.toJSON())).not.toContain(t('attendance.customRange'));
});

it('keeps the chosen contractor day and API range in sync while navigating weeks', async () => {
  await mount(<ContractorSchedule initialDate="2026-11-09" />);
  await click(t('schedule.nextWeek'));
  expect(workspace.client.listWorkerSchedules).toHaveBeenLastCalledWith(
    'token',
    'site',
    expect.objectContaining({
      fromDate: '2026-11-16',
      toDate: '2026-11-16',
      contractorId: 'contractor',
    }),
  );
  await click(t('schedule.previousWeek'));
  expect(workspace.client.listWorkerSchedules).toHaveBeenLastCalledWith(
    'token',
    'site',
    expect.objectContaining({ fromDate: '2026-11-09', toDate: '2026-11-09' }),
  );
  await click(t('requests.filter'));
  expect(JSON.stringify(root.toJSON())).toContain(t('attendance.customRange'));
  await click(t('requests.filter'));
  expect(JSON.stringify(root.toJSON())).not.toContain(t('attendance.customRange'));
});

it('scopes attendance before paging and opens real session details without fabricated clock times', async () => {
  const day: AttendanceDayResponse = {
    id: 'day',
    workerId: 'worker-0',
    workerName: 'Synthetic Worker 0',
    workDate: '2026-11-09',
    timezone: 'Asia/Ho_Chi_Minh',
    scheduleId: 'schedule',
    shiftName: 'Synthetic Shift',
    startsAt: '2026-11-09T01:00:00Z',
    endsAt: '2026-11-09T10:00:00Z',
    status: 'CONFIRMED',
    regularMinutes: 480,
    overtimeMinutes: 0,
    provisionalMinutes: 0,
    confirmedMinutes: 480,
    presence: 'OUTSIDE',
    anomalies: [],
    version: 1,
    canRequest: false,
  };
  vi.spyOn(workspace.client, 'attendanceDays').mockResolvedValue({
    items: [day, { ...day, id: 'private', workerId: 'other', workerName: 'Private Other Worker' }],
    total: 2,
    requests: [],
    canReview: false,
    canRequest: false,
  });
  vi.spyOn(workspace.client, 'attendanceSummary').mockResolvedValue({
    siteId: 'site',
    fromDate: day.workDate,
    toDate: day.workDate,
    today: day.workDate,
    asOf: day.endsAt!,
    timezone: day.timezone,
    regularMinutes: 480,
    overtimeMinutes: 0,
    totalMinutes: 480,
    provisionalMinutes: 0,
    confirmedDays: 1,
    requiredDays: 1,
    presentDays: 1,
    absentDays: 0,
    reviewDays: 0,
    attendanceRate: 100,
    isProvisional: false,
    totalWorkers: 1,
    absentTodayCount: 0,
    overtimeWorkerCount: 0,
    previousPeriod: { fromDate: day.workDate, toDate: day.workDate, totalMinutes: 0 },
    workingMinutesChangePercent: null,
  });
  vi.spyOn(workspace.client, 'attendanceDayDetail').mockResolvedValue({ day, sessions: [] });
  vi.spyOn(workspace.client, 'attendanceOverview').mockResolvedValue({
    sessions: [],
    corrections: [],
    canRequestCorrection: false,
    canReviewCorrection: false,
  });
  await mount(<ContractorSchedule initialDate="2026-11-09" />);
  await click(t('schedule.tabAttendance'));
  expect(JSON.stringify(root.toJSON())).not.toContain('Private Other Worker');
  expect(workspace.client.attendanceDays).toHaveBeenCalledWith('token', 'site', {
    fromDate: day.workDate,
    toDate: day.workDate,
    offset: 0,
    limit: 100,
  });
  await click('2026-11-09 Synthetic Worker 0');
  expect(workspace.client.attendanceDayDetail).toHaveBeenCalledWith('token', 'site', 'day');
  expect(JSON.stringify(root.toJSON())).toContain(t('attendance.noSessions'));
  await click(t('common.back'));
  expect(buttons(t('schedule.tabAttendance'))[0]!.props.accessibilityState.selected).toBe(true);
});

it('keeps the original representative profile and account actions', async () => {
  await mount(
    <MobileLayoutProvider compact={false}>
      <ProfileScreen onScopeChange={vi.fn()} />
    </MobileLayoutProvider>,
  );
  const output = JSON.stringify(root.toJSON());
  expect(output).toContain('Synthetic Representative');
  expect(output).toContain(t('scope.contractorRole'));
  expect(output).toContain(t('profile.generalSection'));
  expect(output).toContain(t('profile.personalInfo'));
  expect(workspace.client.listWorkers).not.toHaveBeenCalled();
  expect(buttons(t('scope.switchScope'))).toHaveLength(1);
  expect(buttons(t('common.logout'))).toHaveLength(1);
});
