import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  SmartSiteManagementClient,
  type AttendanceTimeRequestResponse,
} from '@smartsite/api-client';
import { WorkerTimeRequests } from './worker-time-requests';
import type { useWorkspace } from '../workspace/workspace-context';
import { translate as tr } from '../../i18n';

let workspace: ReturnType<typeof useWorkspace>, cache: QueryClient, root: ReactTestRenderer;
vi.mock('../workspace/workspace-context', () => ({ useWorkspace: () => workspace }));
const row: AttendanceTimeRequestResponse = {
  id: 'request',
  kind: 'LEAVE',
  workerId: 'own-worker',
  workerName: 'Synthetic Worker',
  scheduleId: 'schedule',
  startsAt: '2026-11-14T01:00:00Z',
  endsAt: '2026-11-14T03:00:00Z',
  reason: 'Medical appointment',
  status: 'REJECTED',
  reviewNote: 'Choose the correct shift',
  noticeType: 'PLANNED',
  createdAt: '2026-11-13T01:00:00Z',
};
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
function buttons(label: string) {
  return root.root.findAll(
    (n) => String(n.type) === 'Pressable' && n.props.accessibilityLabel === label,
  );
}
async function click(label: string) {
  await act(async () => buttons(label)[0]!.props.onPress());
  await settle();
}
async function mount(onCreate = vi.fn()) {
  await act(async () => {
    root = create(
      createElement(
        QueryClientProvider,
        { client: cache },
        createElement(WorkerTimeRequests, { onCreate }),
      ),
    );
  });
  await settle();
  await settle();
  return onCreate;
}
beforeEach(() => {
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  workspace = {
    client: new SmartSiteManagementClient('https://synthetic.test'),
    token: 'token',
    workerId: 'own-worker',
    queryKey: ['mobile', 'requests-test'],
    user: {
      id: 'user',
      username: 'worker',
      displayName: 'Synthetic Worker',
      isActive: true,
      mustChangePassword: false,
      roleAssignments: [],
    },
    scope: {
      role: 'worker',
      siteId: 'site',
      siteName: 'Synthetic site',
      contractorId: '',
      contractorName: '',
    },
  };
  vi.spyOn(workspace.client, 'attendanceTimeRequests').mockResolvedValue({
    items: [row],
    total: 1,
  });
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  cache.clear();
  vi.restoreAllMocks();
});

it('shows the real review result and reason while hiding records belonging to another worker', async () => {
  vi.mocked(workspace.client.attendanceTimeRequests).mockResolvedValue({
    items: [row, { ...row, id: 'private', workerId: 'other', reason: 'Private request' }],
    total: 2,
  });
  await mount();
  expect(workspace.client.attendanceTimeRequests).toHaveBeenCalledWith('token', 'site', {
    kind: 'LEAVE',
    workerId: 'own-worker',
    offset: 0,
    limit: 8,
  });
  const content = JSON.stringify(root.toJSON());
  expect(content).toContain('Medical appointment');
  expect(content).toContain('Choose the correct shift');
  expect(content).not.toContain('Private request');
});

it('filters approval status and overtime at the backend and opens the matching request form', async () => {
  const createRequest = await mount();
  await click(tr('attendanceUi.approved'));
  expect(workspace.client.attendanceTimeRequests).toHaveBeenLastCalledWith(
    'token',
    'site',
    expect.objectContaining({ status: 'APPROVED', offset: 0 }),
  );
  await click(tr('attendanceUi.overtimeAction'));
  expect(workspace.client.attendanceTimeRequests).toHaveBeenLastCalledWith(
    'token',
    'site',
    expect.objectContaining({ kind: 'OVERTIME', workerId: 'own-worker', offset: 0 }),
  );
  await click(tr('attendanceUi.newRequest'));
  expect(createRequest).toHaveBeenCalledWith('OVERTIME');
});

it('offers retry when requests are unavailable without claiming that the list is empty', async () => {
  vi.mocked(workspace.client.attendanceTimeRequests).mockRejectedValue(new Error('offline'));
  await mount();
  expect(buttons(tr('common.retry'))).toHaveLength(1);
  expect(JSON.stringify(root.toJSON())).not.toContain(tr('attendanceUi.emptyRequests'));
  vi.mocked(workspace.client.attendanceTimeRequests).mockResolvedValue({ items: [], total: 0 });
  await click(tr('common.retry'));
  expect(JSON.stringify(root.toJSON())).toContain(tr('attendanceUi.emptyRequests'));
});
