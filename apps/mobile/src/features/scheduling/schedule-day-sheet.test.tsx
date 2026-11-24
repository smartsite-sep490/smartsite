import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  SmartSiteManagementClient,
  type ShiftResponse,
  type ScheduleTeamAttendanceResponse,
  type WorkerScheduleResponse,
} from '@smartsite/api-client';
import { ScheduleDaySheet } from './schedule-day-sheet';
import { ScheduleAttendanceStatus } from './schedule-attendance-status';
import type { useWorkspace } from '../workspace/workspace-context';
import { setLanguage, translate as t } from '../../i18n';

let workspace: ReturnType<typeof useWorkspace>,
  root: ReactTestRenderer,
  cache: QueryClient,
  snapshot: ScheduleTeamAttendanceResponse;
vi.mock('../workspace/workspace-context', () => ({ useWorkspace: () => workspace }));
const schedule: WorkerScheduleResponse = {
  id: 'schedule-self',
  siteId: 'site',
  workerId: 'self',
  shiftId: 'shift',
  scheduleVersionId: 'version',
  workDate: '2026-11-20',
  isActive: true,
  createdAt: '',
};
const own = {
  scheduleId: schedule.id,
  membershipId: 'membership-self',
  workerId: 'self',
  displayName: 'Synthetic Leader',
  status: 'NOT_YET' as const,
  version: 0,
  updatedAt: null,
  gateCheck: 'NOT_YET' as const,
  locked: false,
};
function button(label: string) {
  return root.root.findAll(
    (n) => String(n.type) === 'Pressable' && n.props.accessibilityLabel === label,
  )[0];
}
async function click(label: string) {
  expect(button(label)).toBeTruthy();
  await act(async () => {
    button(label)!.props.onPress();
  });
}
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}
async function mount(shift?: ShiftResponse) {
  await act(async () => {
    root = create(
      <QueryClientProvider client={cache}>
        <ScheduleDaySheet
          schedule={schedule}
          shift={shift}
          onClose={() => {}}
          onRequest={() => {}}
        />
      </QueryClientProvider>,
    );
  });
  await settle();
}
beforeEach(async () => {
  await setLanguage('en');
  cache = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const client = new SmartSiteManagementClient('https://api.example.test');
  workspace = {
    client,
    token: 'test-only',
    queryKey: ['mobile', 'roll-call'],
    workerId: 'self',
    scope: {
      role: 'worker',
      siteId: 'site',
      siteName: 'Synthetic Site',
      contractorId: '',
      contractorName: '',
    },
    user: {
      id: 'self',
      displayName: 'Synthetic Leader',
      username: 'self',
      isActive: true,
      mustChangePassword: false,
      roleAssignments: [{ role: 'WORKER', siteId: 'site' }],
    },
  };
  snapshot = {
    own: { ...own },
    teamId: 'team',
    teamName: 'Synthetic Team',
    zoneId: 'zone',
    zoneName: 'Zone A',
    canManage: false,
    canSubmit: false,
    members: [],
  };
  vi.spyOn(client, 'scheduleTeamAttendance').mockImplementation(async () =>
    structuredClone(snapshot),
  );
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  cache.clear();
  vi.restoreAllMocks();
  await setLanguage('vi');
});

it('shows the worker status in the day modal and refreshes without exposing team actions', async () => {
  await mount();
  expect(JSON.stringify(root.toJSON())).toContain('Not yet');
  expect(button(t('rollCall.action'))).toBeUndefined();
  snapshot.own = { ...snapshot.own, status: 'PRESENT', version: 1, gateCheck: 'MATCHED' };
  await act(async () => {
    await cache.invalidateQueries({ queryKey: workspace.queryKey });
  });
  await settle();
  expect(JSON.stringify(root.toJSON())).toContain('Present');
  snapshot.own.status = 'ABSENT';
  await act(async () => {
    await cache.invalidateQueries({ queryKey: workspace.queryKey });
    await setLanguage('vi');
  });
  await settle();
  expect(JSON.stringify(root.toJSON())).toContain('Vắng mặt');
});

it.each(['vi', 'en'] as const)(
  'shows planned overnight times and zone attendance separately in the %s calendar modal',
  async (language) => {
    await setLanguage(language);
    await mount({
      id: 'shift',
      siteId: 'site',
      name: 'Synthetic Night Shift',
      startsAt: '2026-10-10T15:00:00Z',
      endsAt: '2026-10-10T23:00:00Z',
      timezone: 'Asia/Ho_Chi_Minh',
      createdAt: '',
    });
    const output = JSON.stringify(root.toJSON());
    expect(output).toContain(t('scheduleDay.title'));
    expect(output).toContain(t('scheduleDay.starts'));
    expect(output).toContain('22:00');
    expect(output).toContain('06:00');
    expect(output).toContain(t('schedule.nextDay', { count: 1 }));
    expect(output).toContain(t('scheduleDay.zoneAttendance'));
    expect(output).toContain(t('scheduleDay.waiting'));
    expect(output).toContain('Synthetic Team');
    expect(output).toContain('Zone A');
    expect(output).not.toContain('scheduleDay.');
    expect(button(t('rollCall.action'))).toBeUndefined();
  },
);

it('submits explicit choices only and requires a reason to correct existing attendance', async () => {
  snapshot = {
    ...snapshot,
    canManage: true,
    canSubmit: true,
    members: [
      { ...own },
      {
        ...own,
        scheduleId: 'schedule-peer',
        membershipId: 'membership-peer',
        workerId: 'peer',
        displayName: 'Synthetic Peer',
        status: 'PRESENT',
        version: 2,
      },
    ],
  };
  const submit = vi.spyOn(workspace.client, 'submitTeamAttendance').mockResolvedValue(snapshot);
  await mount();
  await click(t('rollCall.updateAction'));
  await click(t('rollCall.markMember', { name: 'Synthetic Peer', status: t('rollCall.ABSENT') }));
  expect(button(t('rollCall.saveChanges'))!.props.disabled).toBe(true);
  await act(async () => {
    root.root
      .findAll(
        (n) =>
          String(n.type) === 'TextInput' && n.props.accessibilityLabel === t('rollCall.reason'),
      )[0]!
      .props.onChangeText('Corrected after rechecking');
  });
  await click(t('rollCall.saveChanges'));
  await settle();
  expect(submit).toHaveBeenCalledWith('test-only', 'site', schedule.id, {
    requestId: expect.any(String),
    teamId: 'team',
    zoneId: 'zone',
    reason: 'Corrected after rechecking',
    entries: [
      {
        scheduleId: 'schedule-peer',
        expectedMembershipId: 'membership-peer',
        expectedVersion: 2,
        status: 'ABSENT',
      },
    ],
  });
  expect(JSON.stringify(root.toJSON())).toContain(t('rollCall.saved'));
});

it('preserves the version selected before a refresh and keeps failed changes available for retry', async () => {
  snapshot = { ...snapshot, canManage: true, canSubmit: true, members: [{ ...own }] };
  const submit = vi
    .spyOn(workspace.client, 'submitTeamAttendance')
    .mockRejectedValue(new Error('Synthetic conflict'));
  await mount();
  await click(t('rollCall.action'));
  await click(t('rollCall.markMember', { name: own.displayName, status: t('rollCall.PRESENT') }));
  snapshot.members[0] = { ...own, status: 'ABSENT', version: 1 };
  await act(async () => {
    await cache.invalidateQueries({ queryKey: workspace.queryKey });
  });
  await click(t('rollCall.submit'));
  await settle();
  expect(submit.mock.calls[0]![3].entries[0]!.expectedVersion).toBe(0);
  expect(JSON.stringify(root.toJSON())).toContain('Synthetic conflict');
  expect(button(t('rollCall.submit'))!.props.disabled).toBe(false);
});

it('does not convert unavailable attendance into Not yet or expose editing', async () => {
  vi.mocked(workspace.client.scheduleTeamAttendance).mockRejectedValue(
    new Error('Synthetic unavailable'),
  );
  await mount();
  expect(JSON.stringify(root.toJSON())).toContain('Synthetic unavailable');
  expect(JSON.stringify(root.toJSON())).not.toContain(t('rollCall.NOT_YET'));
  expect(button(t('rollCall.action'))).toBeUndefined();
  expect(button(t('common.retry'))).toBeTruthy();
});

it('does not silently submit an existing draft to a zone changed while the modal is open', async () => {
  snapshot = { ...snapshot, canManage: true, canSubmit: true, members: [{ ...own }] };
  const submit = vi.spyOn(workspace.client, 'submitTeamAttendance');
  await mount();
  await click(t('rollCall.action'));
  await click(t('rollCall.markMember', { name: own.displayName, status: t('rollCall.PRESENT') }));
  snapshot.zoneId = 'replacement-zone';
  await act(async () => {
    await cache.invalidateQueries({ queryKey: workspace.queryKey });
  });
  await settle();
  expect(button(t('rollCall.submit'))!.props.disabled).toBe(true);
  expect(JSON.stringify(root.toJSON())).toContain(t('rollCall.assignmentChanged'));
  expect(submit).not.toHaveBeenCalled();
});
it.each(['PRESENT', 'ABSENT', 'NOT_YET'] as const)(
  'shows %s directly on the shift card without opening details',
  async (status) => {
    snapshot.own = { ...snapshot.own, status };
    await act(async () => {
      root = create(
        <QueryClientProvider client={cache}>
          <ScheduleAttendanceStatus scheduleId={schedule.id} />
        </QueryClientProvider>,
      );
    });
    await settle();
    expect(JSON.stringify(root.toJSON())).toContain(t(`rollCall.${status}`));
    expect(workspace.client.scheduleTeamAttendance).toHaveBeenCalledWith(
      'test-only',
      'site',
      schedule.id,
    );
  },
);
it('does not turn unavailable card attendance into absent or not yet', async () => {
  vi.mocked(workspace.client.scheduleTeamAttendance).mockRejectedValue(new Error('Unavailable'));
  await act(async () => {
    root = create(
      <QueryClientProvider client={cache}>
        <ScheduleAttendanceStatus scheduleId={schedule.id} />
      </QueryClientProvider>,
    );
  });
  await settle();
  expect(JSON.stringify(root.toJSON())).not.toContain(t('rollCall.ABSENT'));
  expect(JSON.stringify(root.toJSON())).not.toContain(t('rollCall.NOT_YET'));
  expect(JSON.stringify(root.toJSON())).toContain(t('common.retry'));
});
