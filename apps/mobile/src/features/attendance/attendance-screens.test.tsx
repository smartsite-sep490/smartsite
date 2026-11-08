import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SmartSiteManagementClient, type AttendanceDayResponse } from '@smartsite/api-client';
import { AttendanceScreen } from './attendance-screens';
import type { useWorkspace } from '../workspace/workspace-context';
import { localDate, minutes } from '../shared/data';

vi.mock('../workspace/workspace-context', () => ({ useWorkspace: () => workspace }));
vi.mock('./attendance-report', () => ({
  AttendanceReport: (props: { fromDate: string; toDate: string }) =>
    createElement('AttendanceReport', props),
}));
let workspace: ReturnType<typeof useWorkspace>;
let root: ReactTestRenderer;
let cache: QueryClient;
const today = localDate();
const day: AttendanceDayResponse = {
  id: 'own-day',
  workerId: 'own-worker',
  workerName: 'Synthetic Worker',
  workDate: today,
  timezone: 'Asia/Ho_Chi_Minh',
  scheduleId: 'schedule',
  shiftName: 'Morning shift',
  startsAt: `${today}T01:00:00Z`,
  endsAt: `${today}T10:00:00Z`,
  status: 'CONFIRMED',
  regularMinutes: 420,
  overtimeMinutes: 60,
  provisionalMinutes: 0,
  confirmedMinutes: 480,
  presence: 'OUTSIDE',
  anomalies: [],
  version: 1,
  canRequest: true,
};
function buttons(label: string) {
  return root.root.findAll(
    (node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === label,
  );
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
async function click(label: string) {
  for (let attempt = 0; !buttons(label).length && attempt < 50; attempt++) await settle();
  expect(buttons(label).length).toBeGreaterThan(0);
  await act(async () => buttons(label)[0]!.props.onPress());
  await settle();
}
async function mount(props: { initialDayId?: string } = {}) {
  await act(async () => {
    root = create(
      createElement(QueryClientProvider, { client: cache }, createElement(AttendanceScreen, props)),
    );
  });
  for (
    let attempt = 0;
    !JSON.stringify(root.toJSON()).includes('Synthetic Site') && attempt < 50;
    attempt++
  )
    await settle();
  await settle();
}
beforeEach(() => {
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const client = new SmartSiteManagementClient('https://api.example.test');
  workspace = {
    client,
    token: 'token',
    workerId: 'own-worker',
    queryKey: ['mobile', 'attendance-test'],
    user: {
      id: 'user',
      username: 'worker',
      displayName: 'Synthetic Worker',
      isActive: true,
      mustChangePassword: false,
      roleAssignments: [{ role: 'WORKER', siteId: 'site' }],
    },
    scope: {
      role: 'worker',
      siteId: 'site',
      siteName: 'Synthetic Site',
      contractorId: '',
      contractorName: '',
    },
  };
  vi.spyOn(client, 'listWorkers').mockResolvedValue({
    items: [
      {
        id: 'own-worker',
        userId: 'user',
        siteId: 'site',
        contractorId: 'contractor',
        displayName: 'Synthetic Worker',
        externalId: 'W000001',
        isActive: true,
        createdAt: '',
      },
    ],
    total: 1,
  });
  vi.spyOn(client, 'attendanceDays').mockResolvedValue({
    items: [day],
    total: 1,
    requests: [],
    canRequest: true,
    canReview: false,
  });
  vi.spyOn(client, 'attendanceSummary').mockResolvedValue({
    siteId: 'site',
    fromDate: `${today.slice(0, 8)}01`,
    toDate: today,
    today,
    asOf: `${today}T10:00:00Z`,
    timezone: 'Asia/Ho_Chi_Minh',
    regularMinutes: 420,
    overtimeMinutes: 60,
    totalMinutes: 480,
    provisionalMinutes: 125,
    confirmedDays: 1,
    requiredDays: 2,
    presentDays: 1,
    absentDays: 0,
    reviewDays: 1,
    attendanceRate: 50,
    isProvisional: true,
    totalWorkers: 1,
    absentTodayCount: 0,
    overtimeWorkerCount: 1,
    previousPeriod: { fromDate: '2026-01-01', toDate: '2026-01-02', totalMinutes: 0 },
    workingMinutesChangePercent: null,
  });
  vi.spyOn(client, 'attendanceTimesheets').mockResolvedValue({ items: [] });
  vi.spyOn(client, 'attendanceDayDetail').mockResolvedValue({
    day,
    sessions: [
      {
        id: 'session',
        workerId: day.workerId,
        workerName: day.workerName,
        effectiveInAt: day.startsAt,
        effectiveOutAt: day.endsAt,
        rawInAt: day.startsAt,
        rawOutAt: day.endsAt,
        status: 'CONFIRMED',
        version: 1,
        workedMinutes: 480,
      },
    ],
  });
  vi.spyOn(client, 'attendanceOverview').mockResolvedValue({
    sessions: [],
    corrections: [],
    canRequestCorrection: false,
    canReviewCorrection: false,
  });
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  cache.clear();
  vi.restoreAllMocks();
});

it('keeps confirmed, overtime and provisional totals distinct and opens the real daily timeline', async () => {
  await mount();
  const rendered = JSON.stringify(root.toJSON());
  expect(rendered).toContain(minutes(480));
  expect(rendered).toContain(minutes(60));
  expect(rendered).toContain(minutes(125));
  expect(rendered).toContain('Lịch sử chấm công');
  await click(`${today} Morning shift`);
  expect(workspace.client.attendanceDayDetail).toHaveBeenCalledWith('token', 'site', 'own-day');
  expect(JSON.stringify(root.toJSON())).toContain('Dòng thời gian các phiên làm việc');
  expect(buttons('Yêu cầu sửa phiên công')).toHaveLength(0);
});

it('moves reporting months and applies Today to the scoped API and report range', async () => {
  await mount();
  await click('Tháng trước');
  const year = Number(today.slice(0, 4)),
    month = Number(today.slice(5, 7)) - 1;
  const fromDate = new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10);
  const toDate = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  expect(workspace.client.attendanceSummary).toHaveBeenLastCalledWith(
    'token',
    'site',
    expect.objectContaining({ fromDate, toDate, workerId: 'own-worker' }),
  );
  const report = root.root.findAll((node) => String(node.type) === 'AttendanceReport')[0]!;
  expect(report.props.fromDate).toBe(fromDate);
  expect(report.props.toDate).toBe(toDate);
  await click('Hôm nay');
  expect(workspace.client.attendanceDays).toHaveBeenLastCalledWith(
    'token',
    'site',
    expect.objectContaining({ fromDate: today, toDate: today, workerId: 'own-worker' }),
  );
  await click('Bộ lọc');
  expect(JSON.stringify(root.toJSON())).toContain('Tùy chỉnh');
});

it('offers retry for unavailable attendance without displaying a false empty state', async () => {
  vi.mocked(workspace.client.attendanceDays).mockRejectedValue(new Error('offline'));
  await mount();
  expect(buttons('Thử lại')).toHaveLength(1);
  expect(JSON.stringify(root.toJSON())).not.toContain('Không có ngày công trong khoảng này.');
});

it('opens the month/year picker from the period pill and loads the whole chosen month', async () => {
  await mount();
  await click('Kỳ công');
  expect(buttons('Năm sau')).toHaveLength(1);
  expect(JSON.stringify(root.toJSON())).not.toContain('Tùy chỉnh');
  await click('Năm sau');
  const year = Number(today.slice(0, 4)) + 1;
  const fromDate = `${year}-02-01`;
  const toDate = new Date(Date.UTC(year, 2, 0)).toISOString().slice(0, 10);
  const label = new Intl.DateTimeFormat('vi-VN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${fromDate}T00:00:00Z`));
  await click(label);
  expect(buttons('Năm sau')).toHaveLength(0);
  expect(workspace.client.attendanceSummary).toHaveBeenLastCalledWith(
    'token',
    'site',
    expect.objectContaining({ fromDate, toDate, workerId: 'own-worker' }),
  );
  expect(workspace.client.attendanceDays).toHaveBeenLastCalledWith(
    'token',
    'site',
    expect.objectContaining({ fromDate, toDate, workerId: 'own-worker' }),
  );
  const report = root.root.findAll((node) => String(node.type) === 'AttendanceReport')[0]!;
  expect(report.props.fromDate).toBe(fromDate);
  expect(report.props.toDate).toBe(toDate);
  await click('Kỳ công');
  expect(buttons(label)[0]!.props.accessibilityState.selected).toBe(true);
});

it('keeps custom filters separate and dismisses the month picker without changing the report', async () => {
  await mount();
  await click('Bộ lọc');
  expect(JSON.stringify(root.toJSON())).toContain('Tùy chỉnh');
  const calls = vi.mocked(workspace.client.attendanceSummary).mock.calls.length;
  await click('Kỳ công');
  expect(buttons('Năm trước')).toHaveLength(1);
  expect(JSON.stringify(root.toJSON())).not.toContain('Tùy chỉnh');
  await click('Đóng');
  expect(buttons('Năm trước')).toHaveLength(0);
  expect(workspace.client.attendanceSummary).toHaveBeenCalledTimes(calls);
});

it('denies a deep-linked day outside the selected Worker scope', async () => {
  vi.mocked(workspace.client.attendanceDayDetail).mockResolvedValue({
    day: { ...day, workerId: 'other-worker', workerName: 'Private other worker' },
    sessions: [],
  });
  await mount({ initialDayId: 'other-day' });
  expect(JSON.stringify(root.toJSON())).toContain('Ngoài phạm vi đang chọn');
  expect(JSON.stringify(root.toJSON())).not.toContain('Private other worker');
  expect(workspace.client.attendanceOverview).not.toHaveBeenCalled();
});
