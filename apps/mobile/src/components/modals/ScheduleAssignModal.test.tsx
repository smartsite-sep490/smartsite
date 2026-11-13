import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ScheduleAssignModal } from './ScheduleAssignModal';
import type { SmartSiteManagementClient } from '@smartsite/api-client';

vi.mock('../../features/workspace/workspace-context', () => ({ useWorkspace: () => workspace }));
vi.mock('../../features/workspace/use-scoped-workers', () => ({
  useScopedWorkers: () => ({
    data: [{ id: 'worker', displayName: 'An', isActive: true }],
    isPending: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('../../features/shared/ui', () => ({
  Button: (props: object) => React.createElement('TestButton', props),
  Choice: (props: object) => React.createElement('TestChoice', props),
  Field: (props: object) => React.createElement('TestField', props),
}));

const page = (items: unknown[]) => Promise.resolve({ items, total: items.length });
const previewResult: Awaited<ReturnType<SmartSiteManagementClient['previewScheduleAssignment']>> = {
  fingerprint: 'a'.repeat(64),
  targetName: 'An',
  members: [{ workerId: 'worker', workerName: 'An', membershipId: null }],
  dates: ['2026-11-16'],
  assignmentCount: 1,
  conflicts: [],
};
const client = {
  listShifts: vi.fn(() =>
    page([
      {
        id: 'shift',
        name: 'Morning',
        startsAt: '2026-11-16T01:00:00Z',
        endsAt: '2026-11-16T10:00:00Z',
        timezone: 'Asia/Ho_Chi_Minh',
      },
    ]),
  ),
  listScheduleVersions: vi.fn(() =>
    page([{ id: 'version', version: 1, effectiveFrom: '2026-01-01', effectiveUntil: null }]),
  ),
  listContractorTeams: vi.fn(() => page([{ id: 'team', name: 'Team A' }])),
  listContractorTeamWorkers: vi.fn(() =>
    page([{ workerId: 'worker', displayName: 'An', teamId: 'team' }]),
  ),
  listShiftContractorAssignments: vi.fn(() =>
    page([{ contractorId: 'contractor', shiftId: 'shift' }]),
  ),
  previewScheduleAssignment: vi.fn(async () => previewResult),
  createScheduleAssignment: vi.fn(),
};
const workspace = {
  client,
  token: 'token',
  queryKey: ['mobile', 'test'],
  scope: {
    siteId: 'site',
    contractorId: 'contractor',
    siteName: 'Site',
    contractorName: 'Contractor',
  },
};
let root: ReactTestRenderer;
afterEach(() => {
  root?.unmount();
  vi.clearAllMocks();
});
const settle = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
};
const choice = (label: string, value: string) =>
  act(() =>
    root.root
      .findAllByType('TestChoice' as never)
      .find((n) => n.props.label === label)!
      .props.onChange(value),
  );
const field = (label: string, value: string) =>
  act(() =>
    root.root
      .findAllByType('TestField' as never)
      .find((n) => n.props.label === label)!
      .props.onChangeText(value),
  );
const button = async (label: string) => {
  await act(async () => {
    root.root
      .findAllByType('TestButton' as never)
      .find((n) => n.props.label === label)!
      .props.onPress();
  });
  await settle();
};

it('previews team assignments and preserves the request ID after a network failure', async () => {
  client.createScheduleAssignment
    .mockRejectedValueOnce(new Error('Network error'))
    .mockResolvedValueOnce({});
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root = create(
      <QueryClientProvider client={cache}>
        <ScheduleAssignModal visible onClose={vi.fn()} />
      </QueryClientProvider>,
    );
  });
  await settle();
  choice('Phân công cho', 'TEAM');
  choice('Tổ', 'team');
  choice('Ca làm việc', 'shift');
  choice('Cách phân lịch', 'WEEK');
  field('Từ ngày (YYYY-MM-DD)', '2026-11-16');
  await button('Xem trước');
  expect(client.previewScheduleAssignment).toHaveBeenCalledWith(
    'token',
    'site',
    expect.objectContaining({
      target: 'TEAM',
      teamId: 'team',
      selectedWorkerIds: ['worker'],
      mode: 'WEEK',
      fromDate: '2026-11-16',
      toDate: '2026-11-22',
    }),
  );
  await button('Lưu');
  await button('Lưu');
  const first = client.createScheduleAssignment.mock.calls[0]![2] as { requestId: string };
  const second = client.createScheduleAssignment.mock.calls[1]![2] as { requestId: string };
  expect(first.requestId).toMatch(/^[0-9a-f-]{36}$/i);
  expect(second.requestId).toBe(first.requestId);
});

it('previews an individual day and a repeating range', async () => {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root = create(
      <QueryClientProvider client={cache}>
        <ScheduleAssignModal visible onClose={vi.fn()} />
      </QueryClientProvider>,
    );
  });
  await settle();
  choice('Công nhân', 'worker');
  choice('Ca làm việc', 'shift');
  field('Ngày làm việc (YYYY-MM-DD)', '2026-11-16');
  await button('Xem trước');
  expect(client.previewScheduleAssignment).toHaveBeenLastCalledWith(
    'token',
    'site',
    expect.objectContaining({
      target: 'WORKER',
      workerId: 'worker',
      mode: 'DAY',
      fromDate: '2026-11-16',
      toDate: '2026-11-16',
    }),
  );
  choice('Cách phân lịch', 'REPEAT');
  field('Đến ngày (YYYY-MM-DD)', '2026-11-22');
  await button('Xem trước');
  expect(client.previewScheduleAssignment).toHaveBeenLastCalledWith(
    'token',
    'site',
    expect.objectContaining({
      target: 'WORKER',
      mode: 'REPEAT',
      fromDate: '2026-11-16',
      toDate: '2026-11-22',
      weekdays: [1, 2, 3, 4, 5],
    }),
  );
});

it('does not allow saving when the preview reports a conflict', async () => {
  client.previewScheduleAssignment.mockResolvedValueOnce({
    ...previewResult,
    conflicts: [
      {
        workerId: 'worker',
        workerName: 'An',
        workDate: '2026-11-16',
        scheduleId: 'existing',
        shiftName: 'Morning',
      },
    ],
  });
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root = create(
      <QueryClientProvider client={cache}>
        <ScheduleAssignModal visible onClose={vi.fn()} />
      </QueryClientProvider>,
    );
  });
  await settle();
  choice('Công nhân', 'worker');
  choice('Ca làm việc', 'shift');
  field('Ngày làm việc (YYYY-MM-DD)', '2026-11-16');
  await button('Xem trước');
  const saveButton = root.root
    .findAllByType('TestButton' as never)
    .find((n) => n.props.label === 'Lưu');
  expect(saveButton?.props.disabled).toBe(true);
  expect(client.createScheduleAssignment).not.toHaveBeenCalled();
});
