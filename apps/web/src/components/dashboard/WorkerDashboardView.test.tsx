// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import { WorkerAbsenceSummary } from '../workforce/components/WorkerAbsenceSummary';
import { DashboardView } from './DashboardView';

vi.mock('../../features/auth/auth-session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../features/auth/auth-session')>()),
  useAuth: () => ({ accessToken: 'worker-token' }),
  useCurrentUser: () => ({
    data: { id: 'worker-user', roleAssignments: [{ role: 'WORKER', siteId: 'site-a' }] },
  }),
}));
let cache: QueryClient;
afterEach(() => {
  cleanup();
  cache?.clear();
  vi.restoreAllMocks();
});
function mount(view: React.ReactNode) {
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={cache}>{view}</QueryClientProvider>);
}
const result = (total: number) => ({
  items: [],
  total,
  requests: [],
  canReview: false,
  canRequest: true,
});

it('uses the Backend day total instead of the first page length and scopes to the worker/date range', async () => {
  const query = vi
    .spyOn(SmartSiteManagementClient.prototype, 'attendanceDays')
    .mockResolvedValue(result(125));
  mount(
    <WorkerAbsenceSummary
      apiUrl="https://api.example.test"
      token="worker-token"
      siteId="site-a"
      workerId="worker-a"
      sessionScope="worker-user"
      fromDate="2026-10-12"
      toDate="2026-10-18"
    />,
  );
  expect(await screen.findByText('125', { exact: false })).toBeTruthy();
  expect(query).toHaveBeenCalledWith('worker-token', 'site-a', {
    workerId: 'worker-a',
    fromDate: '2026-10-12',
    toDate: '2026-10-18',
    status: 'ABSENT',
    limit: 1,
  });
});

it('shows an unavailable state rather than zero and retries the count', async () => {
  const query = vi
    .spyOn(SmartSiteManagementClient.prototype, 'attendanceDays')
    .mockRejectedValueOnce(new Error('synthetic unavailable'))
    .mockResolvedValue(result(0));
  mount(
    <WorkerAbsenceSummary
      apiUrl="https://api.example.test"
      token="worker-token"
      siteId="site-a"
      workerId="worker-a"
      sessionScope="worker-user"
    />,
  );
  expect(await screen.findByRole('alert')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(query).toHaveBeenCalledTimes(2);
  expect(screen.getByText('0', { exact: false })).toBeTruthy();
});

it('does not fetch an unscoped count before the worker is resolved', () => {
  const query = vi.spyOn(SmartSiteManagementClient.prototype, 'attendanceDays');
  mount(
    <WorkerAbsenceSummary
      apiUrl="https://api.example.test"
      token="worker-token"
      siteId="site-a"
      sessionScope="worker-user"
    />,
  );
  expect(query).not.toHaveBeenCalled();
  expect(screen.getByRole('status')).toBeTruthy();
});

it('worker Dashboard shows real Site absence totals and opens the schedule', async () => {
  vi.spyOn(SmartSiteManagementClient.prototype, 'getSite').mockResolvedValue({
    id: 'site-a',
    code: 'SYNTHETIC',
    name: 'Synthetic Site',
    createdAt: '2026-01-01T00:00:00Z',
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'myContractorTeam').mockResolvedValue({
    workerId: 'worker-a',
    displayName: 'Synthetic Worker',
    membershipId: null,
    teamId: null,
    teamName: null,
    zones: [],
  });
  const query = vi
    .spyOn(SmartSiteManagementClient.prototype, 'attendanceDays')
    .mockResolvedValue(result(3));
  const navigate = vi.fn();
  mount(<DashboardView apiUrl="https://api.example.test" onNavigate={navigate} />);
  expect(await screen.findByText('Synthetic Site')).toBeTruthy();
  expect(await screen.findByText('3', { exact: false })).toBeTruthy();
  expect(screen.queryByText('328')).toBeNull();
  expect(query).toHaveBeenCalledWith(
    'worker-token',
    'site-a',
    expect.objectContaining({ workerId: 'worker-a', status: 'ABSENT' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'My Schedule' }));
  expect(navigate).toHaveBeenCalledWith('workforce');
});
