import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  SmartSiteManagementClient,
  type ScheduleAssignmentBatchResponse,
} from '@smartsite/api-client';
import type { useWorkspace } from '../workspace/workspace-context';
import { ScheduleBatchSheet } from './schedule-batch-sheet';
import { ContractorTeamAttendancePanel } from './team-attendance-panel';
import { Choice } from '../shared/ui';
import { translate as t, setLanguage } from '../../i18n';
vi.mock('../workspace/workspace-context', () => ({ useWorkspace: () => workspace }));
let workspace: ReturnType<typeof useWorkspace>, root: ReactTestRenderer, cache: QueryClient;
const batch: ScheduleAssignmentBatchResponse = {
  id: 'batch',
  version: 7,
  teamId: 'team',
  targetName: 'Synthetic Crew',
  input: {
    contractorId: 'contractor',
    scheduleVersionId: 'version',
    shiftId: 'current',
    target: 'TEAM',
    teamId: 'team',
    mode: 'DAY',
    fromDate: '2099-01-02',
    toDate: '2099-01-02',
    weekdays: [],
  },
  members: [],
  dates: ['2099-01-02'],
  createdAt: '',
};
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
async function mount(element: React.ReactNode) {
  await act(async () => {
    root = create(<QueryClientProvider client={cache}>{element}</QueryClientProvider>);
  });
  await settle();
}
function button(label: string) {
  return root.root.findAll(
    (node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === label,
  )[0]!;
}
async function click(label: string) {
  expect(button(label)).toBeDefined();
  await act(async () => button(label).props.onPress());
  await settle();
}
beforeEach(async () => {
  await setLanguage('vi');
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const client = new SmartSiteManagementClient('https://api.example.test');
  workspace = {
    client,
    token: 'test-token',
    workerId: '',
    queryKey: ['mobile', 'schedule-management'],
    user: {
      id: 'rep',
      username: 'rep',
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
  vi.spyOn(client, 'listScheduleAssignments').mockResolvedValue({ items: [batch], total: 1 });
  vi.spyOn(client, 'listShifts').mockResolvedValue({
    items: [
      {
        id: 'current',
        siteId: 'site',
        name: 'Current shift',
        startsAt: '2020-01-01T08:00:00Z',
        endsAt: '2020-01-01T16:00:00Z',
        timezone: 'UTC',
      },
      {
        id: 'allowed',
        siteId: 'site',
        name: 'Allowed shift',
        startsAt: '2020-01-01T09:00:00Z',
        endsAt: '2020-01-01T17:00:00Z',
        timezone: 'UTC',
      },
      {
        id: 'foreign',
        siteId: 'site',
        name: 'Foreign shift',
        startsAt: '2020-01-01T09:00:00Z',
        endsAt: '2020-01-01T17:00:00Z',
        timezone: 'UTC',
      },
    ].map((row) => ({ ...row, createdAt: '' })),
    total: 3,
  });
  vi.spyOn(client, 'listShiftContractorAssignments').mockResolvedValue({
    items: [
      { id: 'grant', siteId: 'site', contractorId: 'contractor', shiftId: 'allowed' },
      { id: 'foreign-grant', siteId: 'site', contractorId: 'other', shiftId: 'foreign' },
    ].map((row) => ({ ...row, createdAt: '' })),
    total: 2,
  });
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  cache.clear();
  vi.restoreAllMocks();
});
it('cancels a chosen batch with a reason, scope and expected version; preserves protected schedule counts', async () => {
  const change = vi
    .spyOn(workspace.client, 'changeScheduleAssignment')
    .mockResolvedValue({ id: 'batch', version: 8, changedCount: 2, skippedCount: 1 });
  await mount(<ScheduleBatchSheet onClose={vi.fn()} />);
  await click(t('scheduleManage.cancel'));
  expect(button(t('scheduleManage.confirmCancel')).props.disabled).toBe(true);
  await act(async () => root.root.findByType(Choice).props.onChange('UNSTARTED'));
  await act(async () =>
    root.root
      .findAll(
        (node) =>
          String(node.type) === 'TextInput' &&
          node.props.accessibilityLabel === t('scheduleManage.reason'),
      )[0]!
      .props.onChangeText('Updated work plan'),
  );
  await click(t('scheduleManage.confirmCancel'));
  expect(change).toHaveBeenCalledWith(
    'test-token',
    'site',
    'batch',
    expect.objectContaining({
      action: 'CANCEL',
      scope: 'UNSTARTED',
      expectedVersion: 7,
      reason: 'Updated work plan',
      requestId: expect.any(String),
    }),
  );
  expect(JSON.stringify(root.toJSON())).toContain(
    t('scheduleManage.result', { changed: 2, skipped: 1 }),
  );
});
it('only offers shifts granted to this contractor and keeps the same request ID on a network retry', async () => {
  const change = vi
    .spyOn(workspace.client, 'changeScheduleAssignment')
    .mockRejectedValueOnce(new Error('Connection interrupted'))
    .mockResolvedValue({ id: 'batch', version: 8, changedCount: 1, skippedCount: 0 });
  await mount(<ScheduleBatchSheet onClose={vi.fn()} />);
  await click(t('scheduleManage.change'));
  await settle();
  const choice = root.root
    .findAllByType(Choice)
    .find((node) => node.props.label === t('schedule.shift'))!;
  expect(choice.props.options).toEqual([{ value: 'allowed', label: 'Allowed shift' }]);
  await act(async () => choice.props.onChange('allowed'));
  await act(async () =>
    root.root
      .findAll(
        (node) =>
          String(node.type) === 'TextInput' &&
          node.props.accessibilityLabel === t('scheduleManage.reason'),
      )[0]!
      .props.onChangeText('Move the crew'),
  );
  await click(t('common.save'));
  await click(t('common.save'));
  expect(change).toHaveBeenCalledTimes(2);
  expect(change.mock.calls[0]?.[3]).toEqual(change.mock.calls[1]?.[3]);
  expect(change.mock.calls[1]?.[3]).toMatchObject({
    action: 'CHANGE_SHIFT',
    scope: 'DAY',
    shiftId: 'allowed',
    expectedVersion: 7,
  });
});
it('loads the selected group shift roll call and opens the selected member attendance day', async () => {
  const load = vi.spyOn(workspace.client, 'contractorTeamAttendance').mockResolvedValue({
    teamId: 'team',
    teamName: 'Synthetic Crew',
    workDate: '2099-01-02',
    total: 1,
    present: 1,
    absent: 0,
    pending: 0,
    matched: 1,
    items: [
      {
        scheduleId: 'schedule',
        workerId: 'worker',
        displayName: 'Synthetic Worker',
        status: 'PRESENT',
        zoneName: 'Zone A',
        updatedAt: null,
        dayId: 'day',
        gateCheck: 'MATCHED',
      },
    ],
  });
  const open = vi.fn();
  await mount(
    <ContractorTeamAttendancePanel
      item={{
        teamId: 'team',
        teamName: 'Synthetic Crew',
        shiftId: 'current',
        scheduleVersionId: 'version',
        workDate: '2099-01-02',
        workerCount: 1,
      }}
      onDay={open}
    />,
  );
  expect(load).toHaveBeenCalledWith('test-token', 'site', 'contractor', 'team', {
    workDate: '2099-01-02',
    shiftId: 'current',
    scheduleVersionId: 'version',
    offset: 0,
    limit: 8,
  });
  expect(JSON.stringify(root.toJSON())).toContain('Zone A');
  expect(JSON.stringify(root.toJSON())).toContain(t('rollCall.gateMATCHED'));
  await click(t('attendance.dayDetail'));
  expect(open).toHaveBeenCalledWith('day');
});
