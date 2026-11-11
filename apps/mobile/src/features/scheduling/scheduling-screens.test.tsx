import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  SmartSiteManagementClient,
  type WorkerScheduleResponse,
  type ShiftRequestResponse,
} from '@smartsite/api-client';
import { ScheduleScreen, ShiftRequestsScreen } from './scheduling-screens';
import type { useWorkspace } from '../workspace/workspace-context';
import { localDate } from '../shared/data';
let workspace: ReturnType<typeof useWorkspace>;
vi.mock('../workspace/workspace-context', () => ({ useWorkspace: () => workspace }));
let root: ReactTestRenderer;
let cache: QueryClient;
const schedule: WorkerScheduleResponse = {
  id: 'own-schedule',
  siteId: 'site-a',
  workerId: 'own-worker',
  scheduleVersionId: 'version',
  shiftId: 'shift-a',
  workDate: '2026-11-20',
  isActive: true,
  createdAt: '2026-10-17T00:00:00Z',
};
function buttons(label: string) {
  return root.root.findAll(
    (n) => String(n.type) === 'Pressable' && n.props.accessibilityLabel === label,
  );
}
async function click(label: string) {
  for (let attempt = 0; !buttons(label).length && attempt < 80; attempt++) await settle();
  expect(buttons(label).length).toBeGreaterThan(0);
  await act(async () => {
    buttons(label)[0]!.props.onPress();
  });
}
async function text(label: string, value: string) {
  await act(async () => {
    root.root
      .findAll((n) => String(n.type) === 'TextInput' && n.props.accessibilityLabel === label)[0]!
      .props.onChangeText(value);
  });
}
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}
async function mount(component: React.ReactNode) {
  await act(async () => {
    root = create(createElement(QueryClientProvider, { client: cache }, component));
  });
  await settle();
}
beforeEach(() => {
  cache = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const client = new SmartSiteManagementClient('https://api.example.test');
  workspace = {
    workerId: 'own-worker',
    client,
    token: 'token',
    queryKey: ['mobile', 'user-a', 1, 'site-a', 'worker'],
    user: {
      id: 'user-a',
      username: 'worker',
      displayName: 'Synthetic Worker',
      isActive: true,
      mustChangePassword: false,
      roleAssignments: [{ role: 'WORKER', siteId: 'site-a' }],
    },
    scope: {
      role: 'worker',
      siteId: 'site-a',
      siteName: 'Synthetic Site',
      contractorId: '',
      contractorName: '',
    },
  };
  vi.spyOn(client, 'listWorkerSchedules').mockResolvedValue({ items: [schedule], total: 1 });
  vi.spyOn(client, 'listShifts').mockResolvedValue({
    items: [
      {
        id: 'shift-a',
        siteId: 'site-a',
        name: 'Morning',
        startsAt: '2026-11-20T01:00:00Z',
        endsAt: '2026-11-20T10:00:00Z',
        timezone: 'Asia/Ho_Chi_Minh',
        createdAt: '2026-10-17T00:00:00Z',
      },
    ],
    total: 1,
  });
  vi.spyOn(client, 'listWorkers').mockResolvedValue({
    items: [
      {
        id: 'own-worker',
        siteId: 'site-a',
        contractorId: 'contractor',
        userId: 'user-a',
        externalId: 'W000001',
        displayName: 'Synthetic Worker',
        isActive: true,
        createdAt: '',
      },
    ],
    total: 1,
  });
  vi.spyOn(client, 'myContractorTeam').mockResolvedValue({
    workerId: 'own-worker',
    displayName: 'Synthetic Worker',
    membershipId: null,
    teamId: null,
    teamName: null,
  });
  vi.spyOn(client, 'listAbsenceRequests').mockResolvedValue({ items: [], total: 0 });
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  cache.clear();
  vi.restoreAllMocks();
});
it('opens a real swap form for the selected schedule and submits its coworker schedule, rather than a leave request', async () => {
  vi.spyOn(workspace.client, 'listEligibleShifts').mockResolvedValue({ items: [], total: 0 });
  vi.spyOn(workspace.client, 'listSwapCandidates').mockResolvedValue({
    items: [
      {
        candidateWorkerId: 'peer',
        candidateWorkerDisplayName: 'Synthetic Peer',
        candidateWorkerScheduleId: 'peer-schedule',
        workDate: '2026-11-21',
        currentShift: {
          id: 'shift-b',
          name: 'Afternoon',
          startsAt: '',
          endsAt: '',
          timezone: 'Asia/Ho_Chi_Minh',
        },
      },
    ],
    total: 1,
  });
  const swap = vi.spyOn(workspace.client, 'createShiftSwapRequest').mockResolvedValue({} as never);
  const leave = vi.spyOn(workspace.client, 'createAbsenceRequest');
  await mount(createElement(ScheduleScreen, { initialDate: '2026-11-20' }));
  await click('Chi tiết');
  await click('Đổi ca / hoán đổi / xin nghỉ');
  await settle();
  await click('Đổi sang ca khác ▾');
  await act(async () => {
    root.root
      .findAll((n) => String(n.type) === 'Pressable' && n.props.accessibilityRole === 'radio')[1]!
      .props.onPress();
  });
  await settle();
  await click('Chọn… ▾');
  await act(async () => {
    root.root
      .findAll((n) => String(n.type) === 'Pressable' && n.props.accessibilityRole === 'radio')[0]!
      .props.onPress();
  });
  await text('Lý do', 'Agreed with peer');
  await click('Gửi yêu cầu');
  await settle();
  expect(swap).toHaveBeenCalledWith('token', 'site-a', {
    requesterWorkerScheduleId: 'own-schedule',
    coworkerWorkerScheduleId: 'peer-schedule',
    reason: 'Agreed with peer',
  });
  expect(leave).not.toHaveBeenCalled();
});
function request(overrides: Partial<ShiftRequestResponse> = {}): ShiftRequestResponse {
  return {
    requestType: 'CHANGE',
    id: 'change-id',
    siteId: 'site-a',
    workerId: 'own-worker',
    workerScheduleId: 'own-schedule',
    fromShiftId: 'shift-a',
    toShiftId: 'shift-b',
    expectedScheduleVersionId: 'version',
    status: 'PENDING_MANAGER',
    requestedByUserId: 'requester',
    reason: 'Need change',
    reviewedByUserId: null,
    reviewedAt: null,
    reviewReason: null,
    appliedAt: null,
    createdAt: '2026-10-17T00:00:00Z',
    ...overrides,
  } as ShiftRequestResponse;
}
it('does not offer contractor approval to a worker, or permit a representative to approve their own request', async () => {
  vi.spyOn(workspace.client, 'listShiftRequests').mockResolvedValue({
    items: [request({ requestedByUserId: 'user-a' })],
    total: 1,
    pendingCount: 1,
    incomingCount: 0,
    pendingScheduleIds: [],
  });
  await mount(createElement(ShiftRequestsScreen, {}));
  await click('Xem yêu cầu');
  expect(buttons('Phê duyệt yêu cầu')).toHaveLength(0);
  await act(async () => root.unmount());
  workspace = {
    ...workspace,
    scope: { ...workspace.scope, role: 'contractor', contractorId: 'contractor' },
  };
  await mount(createElement(ShiftRequestsScreen, {}));
  await click('Xem yêu cầu');
  expect(buttons('Phê duyệt yêu cầu')).toHaveLength(0);
});
it('approves the chosen change request through the correct API and refreshes the queue', async () => {
  workspace = {
    ...workspace,
    scope: { ...workspace.scope, role: 'contractor', contractorId: 'contractor' },
  };
  const list = vi.spyOn(workspace.client, 'listShiftRequests').mockResolvedValue({
    items: [request()],
    total: 1,
    pendingCount: 1,
    incomingCount: 0,
    pendingScheduleIds: [],
  });
  const approve = vi
    .spyOn(workspace.client, 'approveShiftChangeRequest')
    .mockResolvedValue(request() as never);
  await mount(createElement(ShiftRequestsScreen, {}));
  await click('Xem yêu cầu');
  await click('Phê duyệt yêu cầu');
  await settle();
  expect(approve).toHaveBeenCalledWith('token', 'site-a', 'change-id');
  expect(list.mock.calls.length).toBeGreaterThan(1);
});
it('renders worker name, shift transition, and labeled reason for shift change requests', async () => {
  workspace = {
    ...workspace,
    scope: { ...workspace.scope, role: 'contractor', contractorId: 'contractor' },
  };
  vi.spyOn(workspace.client, 'listShiftRequests').mockResolvedValue({
    items: [
      request({
        workerId: 'own-worker',
        fromShiftId: 'shift-a',
        toShiftId: 'shift-b',
        reason: 'Need change',
      }),
    ],
    total: 1,
    pendingCount: 1,
    incomingCount: 0,
    pendingScheduleIds: [],
  });
  await mount(createElement(ShiftRequestsScreen, {}));
  const listJson = JSON.stringify(root.toJSON());
  expect(listJson).toContain('Synthetic Worker');
  expect(listJson).toContain('Morning');
  expect(listJson).toContain('Need change');

  await click('Xem yêu cầu');
  const detailJson = JSON.stringify(root.toJSON());
  expect(detailJson).toContain('Synthetic Worker');
  expect(detailJson).toContain('Morning');
  expect(detailJson).toContain('Lý do');
  expect(detailJson).toContain('Need change');
});
it('shows a retriable error when schedules cannot load instead of rendering synthetic shifts', async () => {
  vi.mocked(workspace.client.listWorkerSchedules).mockRejectedValue(new Error('offline'));
  await mount(createElement(ScheduleScreen, {}));
  expect(buttons('Thử lại')).toHaveLength(1);
  expect(buttons('Đổi ca / hoán đổi / xin nghỉ')).toHaveLength(0);
});

it('loads the full selected week within the Worker scope and changes the daily agenda', async () => {
  await mount(createElement(ScheduleScreen, { initialDate: '2026-11-20' }));
  expect(workspace.client.listWorkerSchedules).toHaveBeenCalledWith('token', 'site-a', {
    fromDate: '2026-11-16',
    toDate: '2026-11-22',
    workerId: 'own-worker',
    status: 'ALL',
    offset: 0,
    limit: 100,
  });
  expect(buttons('Chi tiết')).toHaveLength(1);
  const days = root.root.findAll(
    (node) => String(node.type) === 'Pressable' && node.props.accessibilityRole === 'tab',
  );
  expect(days).toHaveLength(7);
  expect(days[4]!.props.accessibilityState.selected).toBe(true);
  expect(days[4]!.props.accessibilityLabel).toContain('Có ca làm việc');
  await act(async () => days[5]!.props.onPress());
  expect(buttons('Chi tiết')).toHaveLength(0);
  expect(JSON.stringify(root.toJSON())).toContain('Bạn không có lịch trực trong ngày này');
  expect(workspace.client.listWorkerSchedules).toHaveBeenCalledTimes(1);
});

it('navigates weeks, selects a month and year, and returns to today', async () => {
  await mount(createElement(ScheduleScreen, { initialDate: '2026-11-20' }));
  await click('Tuần sau');
  await settle();
  expect(workspace.client.listWorkerSchedules).toHaveBeenLastCalledWith(
    'token',
    'site-a',
    expect.objectContaining({ fromDate: '2026-11-23', toDate: '2026-11-29' }),
  );
  await click('Chọn tháng và năm');
  await click('Năm sau');
  const month = root.root.findAll(
    (node) =>
      String(node.type) === 'Pressable' &&
      /tháng 2.*2027/.test(node.props.accessibilityLabel ?? ''),
  )[0]!;
  expect(month).toBeDefined();
  await act(async () => month.props.onPress());
  await settle();
  expect(workspace.client.listWorkerSchedules).toHaveBeenLastCalledWith(
    'token',
    'site-a',
    expect.objectContaining({ fromDate: '2027-02-22', toDate: '2027-02-28' }),
  );
  await click('Hôm nay');
  await settle();
  const selectedDay = root.root.findAll(
    (node) =>
      String(node.type) === 'Pressable' &&
      node.props.accessibilityRole === 'tab' &&
      node.props.accessibilityState.selected,
  )[0]!;
  expect(selectedDay.props.accessibilityLabel).toContain(localDate().slice(8));
});

it('filters cancelled schedules without exposing another Worker or allowing requests on cancelled shifts', async () => {
  vi.mocked(workspace.client.listWorkerSchedules).mockResolvedValue({
    items: [
      schedule,
      { ...schedule, id: 'cancelled', isActive: false },
      { ...schedule, id: 'other', workerId: 'another-worker' },
    ],
    total: 3,
  });
  await mount(createElement(ScheduleScreen, { initialDate: '2026-11-20' }));
  expect(buttons('Chi tiết')).toHaveLength(1);
  await click('Bộ lọc');
  await click('Đã hủy');
  expect(buttons('Chi tiết')).toHaveLength(1);
  await click('Chi tiết');
  expect(JSON.stringify(root.toJSON())).toContain('Lịch đã hủy');
  expect(buttons('Đổi ca / hoán đổi / xin nghỉ')).toHaveLength(0);
});

it('loads later API pages before declaring the selected day empty', async () => {
  vi.mocked(workspace.client.listWorkerSchedules).mockImplementation(
    async (_token, _site, options) =>
      options?.offset === 0
        ? {
            items: Array.from({ length: 100 }, (_, index) => ({
              ...schedule,
              id: `old-${index}`,
              workDate: '2026-11-19',
              isActive: false,
            })),
            total: 101,
          }
        : { items: [schedule], total: 101 },
  );
  await mount(createElement(ScheduleScreen, { initialDate: '2026-11-20' }));
  for (let attempt = 0; !buttons('Chi tiết').length && attempt < 80; attempt++) await settle();
  expect(buttons('Chi tiết')).toHaveLength(1);
  expect(workspace.client.listWorkerSchedules).toHaveBeenCalledTimes(2);
  expect(workspace.client.listWorkerSchedules).toHaveBeenLastCalledWith(
    'token',
    'site-a',
    expect.objectContaining({ offset: 100, workerId: 'own-worker' }),
  );
});
