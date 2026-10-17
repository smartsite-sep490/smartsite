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
it('shows a retriable error when schedules cannot load instead of rendering synthetic shifts', async () => {
  vi.mocked(workspace.client.listWorkerSchedules).mockRejectedValue(new Error('offline'));
  await mount(createElement(ScheduleScreen, {}));
  expect(buttons('Thử lại')).toHaveLength(1);
  expect(buttons('Đổi ca / hoán đổi / xin nghỉ')).toHaveLength(0);
});
