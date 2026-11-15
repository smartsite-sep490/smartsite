import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  SmartSiteManagementClient,
  type AttendanceTimeRequestResponse,
} from '@smartsite/api-client';
import { TimeRequestsPanel } from './time-requests-panel';
import { TimeRequestModal } from './time-request-modal';
import { WorkerRequestModal } from '../../components/modals/WorkerRequestModal';
import type { useWorkspace } from '../workspace/workspace-context';
import { translate as tr } from '../../i18n';
import { localDate, minutes } from '../shared/data';
import { ScrollDateTimePicker } from '../shared/scroll-date-time-picker';

vi.mock('../workspace/workspace-context', () => ({ useWorkspace: () => workspace }));
let workspace: ReturnType<typeof useWorkspace>, cache: QueryClient, root: ReactTestRenderer;
const row: AttendanceTimeRequestResponse = {
  id: 'leave',
  kind: 'LEAVE',
  workerId: 'worker',
  workerName: 'Synthetic Worker',
  scheduleId: 'schedule',
  startsAt: '2026-11-13T01:00:00Z',
  endsAt: '2026-11-13T10:00:00Z',
  reason: 'Sudden illness',
  status: 'PENDING_MANAGER',
  reviewNote: null,
  noticeType: 'EMERGENCY',
  shortNotice: true,
  requestedByUserId: 'worker-user',
  createdAt: '2026-11-14T12:00:00Z',
};
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
async function mount(component: React.ReactNode) {
  await act(async () => {
    root = create(createElement(QueryClientProvider, { client: cache }, component));
  });
  await settle();
  await settle();
}
const buttons = (label: string) =>
  root.root.findAll((n) => String(n.type) === 'Pressable' && n.props.accessibilityLabel === label);
async function click(label: string) {
  for (let n = 0; !buttons(label).length && n < 40; n++) await settle();
  expect(buttons(label).length).toBeGreaterThan(0);
  await act(async () => {
    buttons(label)[0]!.props.onPress();
  });
  await settle();
}
async function choose(current: string, next: string) {
  await click(current);
  const content = (node: import('react-test-renderer').ReactTestInstance): string =>
    node.children.map((child) => (typeof child === 'string' ? child : content(child))).join('');
  const option = root.root.findAll(
    (n) =>
      String(n.type) === 'Pressable' &&
      n.props.accessibilityRole === 'radio' &&
      content(n).includes(next),
  )[0];
  expect(option).toBeDefined();
  await act(async () => {
    option!.props.onPress();
  });
  await settle();
}
async function text(label: string, value: string) {
  const input = root.root.findAll(
    (n) => String(n.type) === 'TextInput' && n.props.accessibilityLabel === label,
  )[0];
  expect(input).toBeDefined();
  await act(async () => {
    input!.props.onChangeText(value);
  });
}
beforeEach(() => {
  cache = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const client = new SmartSiteManagementClient('https://api.example.test');
  workspace = {
    client,
    token: 'token',
    workerId: '',
    queryKey: ['mobile', 'leave-test'],
    user: {
      id: 'rep',
      username: 'rep',
      displayName: 'Representative',
      isActive: true,
      mustChangePassword: false,
      roleAssignments: [{ siteId: 'site', role: 'CONTRACTOR_REPRESENTATIVE' }],
    },
    scope: {
      role: 'contractor',
      siteId: 'site',
      siteName: 'Site',
      contractorId: 'contractor',
      contractorName: 'Contractor',
    },
  };
  vi.spyOn(client, 'listWorkers').mockResolvedValue({
    items: [
      {
        id: 'worker',
        siteId: 'site',
        contractorId: 'contractor',
        userId: 'worker-user',
        displayName: 'Synthetic Worker',
        externalId: 'W000001',
        isActive: true,
        createdAt: '',
      },
    ],
    total: 1,
  });
  vi.spyOn(client, 'listWorkerSchedules').mockResolvedValue({
    items: [
      {
        id: 'schedule',
        siteId: 'site',
        workerId: 'worker',
        shiftId: 'shift',
        scheduleVersionId: 'version',
        workDate: '2026-11-13',
        isActive: true,
        createdAt: '',
      },
      {
        id: 'private-schedule',
        siteId: 'site',
        workerId: 'other-worker',
        shiftId: 'shift',
        scheduleVersionId: 'version',
        workDate: '2026-11-12',
        isActive: true,
        createdAt: '',
      },
    ],
    total: 2,
  });
  vi.spyOn(client, 'listShifts').mockResolvedValue({
    items: [
      {
        id: 'shift',
        siteId: 'site',
        name: 'Morning',
        startsAt: '2026-01-01T01:00:00Z',
        endsAt: '2026-01-01T10:00:00Z',
        timezone: 'Asia/Ho_Chi_Minh',
        createdAt: '',
      },
    ],
    total: 1,
  });
  vi.spyOn(client, 'attendanceTimeRequests').mockResolvedValue({ items: [], total: 0 });
  vi.spyOn(client, 'requestAttendanceTime').mockResolvedValue({ id: 'new' });
  vi.spyOn(client, 'reviewAttendanceTime').mockResolvedValue({ id: 'leave' });
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  cache.clear();
  vi.restoreAllMocks();
});

it('submits retrospective emergency leave with assigned date and keeps overtime out of a delegated form', async () => {
  await mount(
    createElement(TimeRequestModal, {
      visible: true,
      onClose: vi.fn(),
      onBehalfWorkerId: 'worker',
    }),
  );
  expect(JSON.stringify(root.toJSON())).not.toContain('Tăng ca ngoài ca chính');
  await click('Đột xuất / ốm đau');
  await choose('Chọn… ▾', '2026-11-13');
  expect(JSON.stringify(root.toJSON())).not.toContain('2026-11-12');
  await text('Lý do', 'Worker cannot use their phone after sudden illness');
  await click('Gửi đại diện nhà thầu');
  expect(workspace.client.requestAttendanceTime).toHaveBeenCalledWith(
    'token',
    'site',
    expect.objectContaining({
      workerScheduleId: 'schedule',
      kind: 'LEAVE',
      noticeType: 'EMERGENCY',
      startsAt: '2026-11-13T01:00:00.000Z',
      endsAt: '2026-11-13T10:00:00.000Z',
    }),
  );
});

it('keeps worker overtime on its API with no leave-only notice field', async () => {
  workspace.scope.role = 'worker';
  workspace.workerId = 'worker';
  const nextDate = localDate(new Date(Date.now() + 2 * 86400000));
  vi.mocked(workspace.client.listWorkerSchedules).mockResolvedValue({
    items: [
      {
        id: 'schedule',
        siteId: 'site',
        workerId: 'worker',
        shiftId: 'shift',
        scheduleVersionId: 'version',
        workDate: nextDate,
        isActive: true,
        createdAt: '',
      },
    ],
    total: 1,
  });
  await mount(createElement(TimeRequestModal, { visible: true, onClose: vi.fn() }));
  await click(tr('attendance.overtimeOutsideShift'));
  await choose('Chọn… ▾', nextDate);
  await text('Lý do', 'Complete the assigned task');
  await click('Gửi đại diện nhà thầu');
  expect(workspace.client.requestAttendanceTime).toHaveBeenCalledWith(
    'token',
    'site',
    expect.objectContaining({ kind: 'OVERTIME' }),
  );
  expect(vi.mocked(workspace.client.requestAttendanceTime).mock.calls[0]![2]).not.toHaveProperty(
    'noticeType',
  );
});

it('clears a cancelled draft and selects the requested type when reopening the form', async () => {
  workspace.scope.role = 'worker';
  workspace.workerId = 'worker';
  const onClose = vi.fn();
  await mount(createElement(TimeRequestModal, { visible: true, onClose }));
  await text('Lý do', 'Cancelled draft');
  await click('Đóng');
  expect(onClose).toHaveBeenCalledTimes(1);
  await act(async () =>
    root.update(
      createElement(
        QueryClientProvider,
        { client: cache },
        createElement(TimeRequestModal, { visible: false, onClose }),
      ),
    ),
  );
  expect(buttons(tr('leavePolicy.submit'))).toHaveLength(0);
  await act(async () =>
    root.update(
      createElement(
        QueryClientProvider,
        { client: cache },
        createElement(TimeRequestModal, { visible: true, initialKind: 'OVERTIME', onClose }),
      ),
    ),
  );
  await settle();
  expect(buttons(tr('attendance.overtimeOutsideShift'))[0]!.props.accessibilityState.checked).toBe(
    true,
  );
  const reason = root.root.findAll(
    (n) => String(n.type) === 'TextInput' && n.props.accessibilityLabel === 'Lý do',
  )[0]!;
  expect(reason.props.value).toBe('');
  expect(workspace.client.requestAttendanceTime).not.toHaveBeenCalled();
});

it('updates the duration and submitted time when editing the compact time control', async () => {
  workspace.scope.role = 'worker';
  workspace.workerId = 'worker';
  await mount(createElement(TimeRequestModal, { visible: true, onClose: vi.fn() }));
  expect(buttons(tr('leavePolicy.submit'))[0]!.props.disabled).toBe(true);
  await choose('Chọn… ▾', '2026-11-13');
  expect(JSON.stringify(root.toJSON())).toContain(minutes(540));
  await click(tr('common.chooseTime', { label: tr('common.end') }));
  const picker = root.root.findAllByType(ScrollDateTimePicker)[0]!;
  expect(picker.props.mode).toBe('time');
  await act(async () => {
    picker.props.onConfirm(new Date('2026-11-13T03:00:00Z'));
  });
  expect(JSON.stringify(root.toJSON())).toContain(minutes(120));
  await text('Lý do', 'Medical appointment');
  expect(buttons(tr('leavePolicy.submit'))[0]!.props.disabled).toBe(false);
  await click(tr('leavePolicy.submit'));
  expect(workspace.client.requestAttendanceTime).toHaveBeenCalledWith(
    'token',
    'site',
    expect.objectContaining({ endsAt: '2026-11-13T03:00:00.000Z' }),
  );
});

it('retains a failed submission for retry and reuses the same request id before reporting success', async () => {
  workspace.scope.role = 'worker';
  workspace.workerId = 'worker';
  const onClose = vi.fn(),
    onSubmitted = vi.fn();
  vi.mocked(workspace.client.requestAttendanceTime).mockRejectedValueOnce(
    new Error('Temporary failure'),
  );
  await mount(createElement(TimeRequestModal, { visible: true, onClose, onSubmitted }));
  await choose('Chọn… ▾', '2026-11-13');
  await text('Lý do', 'Medical appointment');
  await click(tr('leavePolicy.submit'));
  expect(onClose).not.toHaveBeenCalled();
  expect(onSubmitted).not.toHaveBeenCalled();
  const reason = root.root.findAll(
    (n) => String(n.type) === 'TextInput' && n.props.accessibilityLabel === 'Lý do',
  )[0]!;
  expect(reason.props.value).toBe('Medical appointment');
  await click(tr('leavePolicy.submit'));
  const calls = vi.mocked(workspace.client.requestAttendanceTime).mock.calls;
  expect(calls).toHaveLength(2);
  expect(calls[1]![2].requestId).toBe(calls[0]![2].requestId);
  expect(onSubmitted).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('connects the home full-shift shortcut to emergency leave, including historical active shifts', async () => {
  workspace.scope.role = 'worker';
  workspace.workerId = 'worker';
  vi.spyOn(workspace.client, 'createAbsenceRequest').mockResolvedValue({} as never);
  await mount(createElement(WorkerRequestModal, { visible: true, onClose: vi.fn() }));
  await choose('Có kế hoạch ▾', 'Đột xuất / ốm đau');
  await click(tr('attendance.assignedShift'));
  await click('2026-11-13 · Morning');
  await text(tr('schedule.reason'), 'Could not notify earlier because of sudden illness');
  await click(tr('requests.submitRequest'));
  expect(workspace.client.createAbsenceRequest).toHaveBeenCalledWith('token', 'site', {
    workerScheduleId: 'schedule',
    noticeType: 'EMERGENCY',
    reason: 'Could not notify earlier because of sudden illness',
  });
});

it('reviews leave from either worker entry point and hides workers outside the selected contractor', async () => {
  vi.mocked(workspace.client.attendanceTimeRequests).mockResolvedValue({
    items: [row, { ...row, id: 'outside', workerId: 'private', workerName: 'Private worker' }],
    total: 2,
  });
  await mount(createElement(TimeRequestsPanel));
  expect(JSON.stringify(root.toJSON())).toContain('Sudden illness');
  expect(JSON.stringify(root.toJSON())).not.toContain('Private worker');
  await click('Xem yêu cầu');
  await click('Duyệt đơn');
  expect(workspace.client.reviewAttendanceTime).toHaveBeenCalledWith(
    'token',
    'site',
    'leave',
    'LEAVE',
    { approve: true },
  );
});

it('requires a rejection reason and preserves server errors instead of reporting success', async () => {
  vi.mocked(workspace.client.attendanceTimeRequests).mockResolvedValue({ items: [row], total: 1 });
  vi.mocked(workspace.client.reviewAttendanceTime).mockRejectedValue(
    new Error('Request changed; reload'),
  );
  await mount(createElement(TimeRequestsPanel));
  await click('Xem yêu cầu');
  expect(buttons('Từ chối đơn')[0]!.props.disabled).toBe(true);
  await text('Lý do từ chối / ghi chú duyệt', 'Please correct the dates');
  await click('Từ chối đơn');
  expect(workspace.client.reviewAttendanceTime).toHaveBeenCalledWith(
    'token',
    'site',
    'leave',
    'LEAVE',
    {
      approve: false,
      reviewNote: 'Please correct the dates',
    },
  );
  expect(JSON.stringify(root.toJSON())).toContain('Request changed; reload');
});

it('does not offer self-approval for a request recorded on behalf of a worker', async () => {
  vi.mocked(workspace.client.attendanceTimeRequests).mockResolvedValue({
    items: [{ ...row, requestedByUserId: 'rep', submittedOnBehalf: true }],
    total: 1,
  });
  await mount(createElement(TimeRequestsPanel));
  expect(JSON.stringify(root.toJSON())).toContain(
    'Đơn do bạn ghi nhận hộ cần một đại diện khác duyệt.',
  );
  expect(buttons('Xem yêu cầu')).toHaveLength(0);
});
