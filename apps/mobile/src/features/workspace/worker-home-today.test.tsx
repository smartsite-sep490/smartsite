import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SmartSiteManagementClient, type WorkerScheduleResponse } from '@smartsite/api-client';
import type { useWorkspace } from './workspace-context';
import { HomeScreen } from './home-profile';
import { localDate } from '../shared/data';
import { translate as t } from '../../i18n';

vi.mock('../auth/auth-context', () => ({ useAuth: () => ({ session: {} }) }));
vi.mock('./workspace-context', () => ({ useWorkspace: () => workspace }));
vi.mock('../../components/worker/WorkerQrModal', () => ({ WorkerQrModal: () => null }));
vi.mock('../../components/modals/WorkerRequestModal', () => ({ WorkerRequestModal: () => null }));
vi.mock('../contractor/contractor-home', () => ({ ContractorHome: () => null }));
vi.mock('../shared/uploads', () => ({ Attachments: () => null, EvidenceButton: () => null }));
let workspace: ReturnType<typeof useWorkspace>;
let cache: QueryClient;
let root: ReactTestRenderer;
let schedules: WorkerScheduleResponse[];

beforeEach(() => {
  const client = new SmartSiteManagementClient('https://api.example.test');
  schedules = [];
  vi.spyOn(client, 'listWorkerSchedules').mockImplementation(async () => ({
    items: schedules,
    total: schedules.length,
  }));
  vi.spyOn(client, 'myContractorTeam').mockResolvedValue({
    workerId: 'worker-a',
    displayName: 'Worker A',
    membershipId: null,
    teamId: null,
    teamName: null,
    zones: [],
  });
  vi.spyOn(client, 'attendanceDays').mockResolvedValue({
    items: [],
    total: 0,
    requests: [],
    canReview: false,
    canRequest: true,
  });
  vi.spyOn(client, 'listShifts').mockResolvedValue({
    items: [
      {
        id: 'shift-a',
        siteId: 'site-a',
        name: 'Assigned afternoon',
        startsAt: '2026-11-22T06:00:00Z',
        endsAt: '2026-11-22T14:00:00Z',
        timezone: 'Asia/Ho_Chi_Minh',
        breakStartsAt: '2026-11-22T10:00:00Z',
        breakEndsAt: '2026-11-22T10:30:00Z',
        createdAt: '',
      },
    ],
    total: 1,
  });
  workspace = {
    client,
    token: 'token',
    workerId: 'worker-a',
    queryKey: ['mobile', 'home-today'],
    user: {
      id: 'user-a',
      username: 'worker-a',
      displayName: 'Worker A',
      isActive: true,
      mustChangePassword: false,
      roleAssignments: [{ role: 'WORKER', siteId: 'site-a' }],
    },
    scope: {
      role: 'worker',
      siteId: 'site-a',
      siteName: 'Site A',
      contractorId: '',
      contractorName: '',
    },
  };
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  cache.clear();
  vi.restoreAllMocks();
});
const assignment = (patch: Partial<WorkerScheduleResponse> = {}): WorkerScheduleResponse => ({
  id: 'schedule-a',
  workerId: 'worker-a',
  siteId: 'site-a',
  shiftId: 'shift-a',
  workDate: localDate(),
  scheduleVersionId: 'version-a',
  isActive: true,
  createdAt: '',
  ...patch,
});
async function renderHome() {
  const navigate = vi.fn();
  await act(async () => {
    root = create(
      <QueryClientProvider client={cache}>
        <HomeScreen navigate={navigate} />
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 50; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    if (!cache.isFetching()) break;
  }
  return navigate;
}

it('opens the calendar instead of inventing a shift when today has no assignment', async () => {
  const navigate = await renderHome();
  const content = JSON.stringify(root.toJSON());
  expect(content).toContain(t('workerHome.noShiftToday'));
  expect(content).not.toContain('08:00 – 17:00');
  expect(content).not.toContain(t('workerHome.shiftBreak'));
  expect(content).not.toContain(t('workerHome.shiftUpdated'));
  const card = root.root.findAll(
    (n) =>
      String(n.type) === 'Pressable' && n.props.accessibilityLabel === t('workerHome.viewSchedule'),
  )[0]!;
  await act(async () => card.props.onPress());
  expect(navigate).toHaveBeenCalledWith({ route: 'schedule' });
});

it.each([
  { workerId: 'another-worker' },
  { workDate: '2020-01-01' },
  { siteId: 'another-site' },
  { isActive: false },
])('does not display an unrelated or cancelled assignment %j', async (patch) => {
  schedules = [assignment(patch)];
  await renderHome();
  expect(JSON.stringify(root.toJSON())).toContain(t('workerHome.noShiftToday'));
  expect(JSON.stringify(root.toJSON())).not.toContain('Assigned afternoon');
});

it('uses the active worker assignment and its actual break instead of a different first row', async () => {
  schedules = [assignment({ workerId: 'another-worker' }), assignment()];
  await renderHome();
  const content = JSON.stringify(root.toJSON());
  expect(content).toContain('Assigned afternoon');
  expect(content).toContain('13:00 – 21:00');
  expect(content).toContain(t('workerHome.breakTime', { from: '17:00', to: '17:30' }));
  expect(workspace.client.listWorkerSchedules).toHaveBeenCalledWith(
    'token',
    'site-a',
    expect.objectContaining({ workerId: 'worker-a', status: 'ACTIVE' }),
  );
});

it('does not issue an unscoped request while the worker profile is unresolved', async () => {
  workspace.workerId = '';
  await renderHome();
  expect(workspace.client.listWorkerSchedules).not.toHaveBeenCalled();
  expect(workspace.client.attendanceDays).not.toHaveBeenCalled();
  expect(JSON.stringify(root.toJSON())).not.toContain(t('workerHome.noShiftToday'));
});

it('keeps a schedule API failure distinct from an empty schedule', async () => {
  vi.mocked(workspace.client.listWorkerSchedules).mockRejectedValue(
    new Error('Schedule unavailable'),
  );
  await renderHome();
  expect(JSON.stringify(root.toJSON())).toContain(t('workerHome.scheduleUnavailable'));
  expect(JSON.stringify(root.toJSON())).not.toContain(t('workerHome.noShiftToday'));
});
