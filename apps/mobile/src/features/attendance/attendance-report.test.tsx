import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import type { useWorkspace } from '../workspace/workspace-context';
import { AttendanceReport } from './attendance-report';
import { translate as tr } from '../../i18n';

const transfer = vi.hoisted(() => ({
  writes: [] as string[],
  share: vi.fn(async () => {}),
}));
vi.mock('expo-sharing', () => ({
  isAvailableAsync: async () => true,
  shareAsync: transfer.share,
}));
vi.mock('expo-file-system', () => ({
  Paths: { cache: 'synthetic-cache' },
  File: class {
    uri = 'synthetic://report.csv';
    exists = true;
    create() {}
    write(text: string) {
      transfer.writes.push(text);
    }
    delete() {
      this.exists = false;
    }
  },
}));
vi.mock('../workspace/workspace-context', () => ({ useWorkspace: () => workspace }));

let workspace: ReturnType<typeof useWorkspace>;
let root: ReactTestRenderer | undefined;
let cache: QueryClient;
const metadata = {
  siteId: 'site-a',
  siteName: 'Synthetic Site',
  fromDate: '2026-11-01',
  toDate: '2026-11-07',
  timezone: 'Asia/Ho_Chi_Minh',
  today: '2026-11-07',
  asOf: '2026-11-07T10:00:00Z',
};
const row = {
  workerId: 'worker-a',
  workerCode: 'W000001',
  workerName: 'Synthetic Worker',
  contractorId: 'contractor-a',
  todayStatus: 'PRESENT' as const,
  todayFirstCheckInAt: null,
  todayLastCheckOutAt: null,
  regularMinutes: 480,
  overtimeMinutes: 60,
  totalMinutes: 540,
  provisionalMinutes: 0,
  confirmedDays: 1,
  requiredDays: 1,
  presentDays: 1,
  absentDays: 0,
  reviewDays: 0,
  attendanceRate: 100,
  isProvisional: false,
};

beforeEach(() => {
  transfer.writes.length = 0;
  transfer.share.mockClear();
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const client = new SmartSiteManagementClient('https://api.example.test');
  vi.spyOn(client, 'attendanceWorkers').mockResolvedValue({
    ...metadata,
    items: [row],
    total: 1,
    offset: 0,
    limit: 20,
  });
  workspace = {
    client,
    token: 'synthetic-token',
    workerId: 'worker-a',
    queryKey: ['mobile', 'report-test'],
    user: {
      id: 'user-a',
      username: 'worker-a',
      displayName: 'Synthetic Worker',
      isActive: true,
      mustChangePassword: false,
      roleAssignments: [{ role: 'WORKER', siteId: 'site-a' }],
    },
    scope: {
      role: 'worker',
      siteId: 'site-a',
      siteName: 'Synthetic Site',
      contractorId: 'contractor-a',
      contractorName: 'Synthetic Contractor',
    },
  };
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  cache.clear();
  vi.restoreAllMocks();
});

function buttons(label: string) {
  return root!.root.findAll(
    (node) => String(node.type) === 'Pressable' && node.props.accessibilityLabel === label,
  );
}
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
async function mount() {
  await act(async () => {
    root = create(
      <QueryClientProvider client={cache}>
        <AttendanceReport fromDate="2026-11-01" toDate="2026-11-07" onDay={() => {}} />
      </QueryClientProvider>,
    );
  });
  await act(async () => buttons(tr('attendance.workerReport'))[0]!.props.onPress());
  await settle();
}

it('keeps personal attendance readable while Worker cannot export or share a file', async () => {
  await mount();
  expect(JSON.stringify(root!.toJSON())).toContain('Synthetic Worker');
  expect(buttons(tr('attendance.shareCsv'))).toHaveLength(0);
  expect(transfer.writes).toHaveLength(0);
  expect(transfer.share).not.toHaveBeenCalled();
});

it('shares Contractor CSV from one authorized export snapshot instead of the paginated read API', async () => {
  workspace.scope.role = 'contractor';
  workspace.user.roleAssignments = [{ role: 'CONTRACTOR_REPRESENTATIVE', siteId: 'site-a' }];
  const exportData = vi.fn(async () => ({ ...metadata, items: [row], total: 1 }));
  Object.assign(workspace.client, { attendanceExport: exportData });
  await mount();
  await act(async () => buttons(tr('attendance.shareCsv'))[0]!.props.onPress());
  for (let attempt = 0; !transfer.writes.length && attempt < 20; attempt++) await settle();
  expect(exportData).toHaveBeenCalledWith(
    'synthetic-token',
    'site-a',
    expect.objectContaining({
      fromDate: '2026-11-01',
      toDate: '2026-11-07',
      contractorId: 'contractor-a',
    }),
    { signal: expect.any(AbortSignal) },
  );
  expect(transfer.writes[0]).toContain('Synthetic Worker');
  expect(transfer.writes[0]).toContain('540');
  expect(transfer.share).toHaveBeenCalledTimes(1);
});

it('cancels pending export after a site switch and never shares the previous site file', async () => {
  workspace.scope.role = 'contractor';
  workspace.user.roleAssignments = [{ role: 'CONTRACTOR_REPRESENTATIVE', siteId: 'site-a' }];
  let finish!: (value: { items: (typeof row)[]; total: number } & typeof metadata) => void;
  const exportData = vi.fn(
    () =>
      new Promise<{ items: (typeof row)[]; total: number } & typeof metadata>((resolve) => {
        finish = resolve;
      }),
  );
  Object.assign(workspace.client, { attendanceExport: exportData });
  await mount();
  await act(async () => buttons(tr('attendance.shareCsv'))[0]!.props.onPress());
  workspace = {
    ...workspace,
    scope: { ...workspace.scope, siteId: 'site-b' },
    queryKey: ['mobile', 'report-test', 'site-b'],
  };
  await act(async () => {
    root!.update(
      <QueryClientProvider client={cache}>
        <AttendanceReport fromDate="2026-11-01" toDate="2026-11-07" onDay={() => {}} />
      </QueryClientProvider>,
    );
  });
  await act(async () => finish({ ...metadata, items: [row], total: 1 }));
  await settle();
  expect(transfer.writes).toHaveLength(0);
  expect(transfer.share).not.toHaveBeenCalled();
});
