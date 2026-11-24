// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkerAttendanceSummary } from './WorkerAttendanceSummary';

const api = vi.hoisted(() => ({
  attendanceDays: vi.fn(),
  attendanceTimesheets: vi.fn(),
  attendanceWorkers: vi.fn(),
  listWorkers: vi.fn(),
  attendanceDayDetail: vi.fn(),
}));
vi.mock('@smartsite/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@smartsite/api-client')>()),
  SmartSiteManagementClient: class {
    constructor() {
      return api;
    }
  },
}));
let cache: QueryClient;
const today = {
  id: 'today',
  workDate: '2026-10-10',
  timezone: 'Asia/Ho_Chi_Minh',
  provisionalMinutes: 42,
  shiftName: 'Morning',
  startsAt: null,
  endsAt: null,
};
function mount(selectedDayId = '') {
  cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={cache}>
      <WorkerAttendanceSummary
        apiUrl="https://example.test"
        token="synthetic"
        siteId="site"
        sessionScope="worker"
        selectedDayId={selectedDayId}
      />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-10T03:00:00Z'));
  api.attendanceDays.mockImplementation(async (_token, _site, query) => ({
    items: [today],
    total: query.status ? 31 : 1,
    canRequest: true,
    canReview: false,
    requests: [],
  }));
  api.attendanceTimesheets.mockResolvedValue({
    items: [{ totalMinutes: 760, overtimeMinutes: 90 }],
  });
  api.attendanceDayDetail.mockResolvedValue({ day: today, sessions: [] });
  api.attendanceWorkers.mockResolvedValue({
    items: [{ workerId: 'mine', presentDays: 2, requiredDays: 3, reviewDays: 31 }],
  });
  api.listWorkers.mockResolvedValue({ items: [{ id: 'mine', userId: 'worker' }], total: 1 });
});
afterEach(() => {
  cleanup();
  cache?.clear();
  vi.useRealTimers();
});

it('opens the latest shift and lets the Worker inspect both shifts on the same date', async () => {
  const first = {
    ...today,
    id: 'first',
    shiftName: 'First shift',
    startsAt: '2026-10-10T01:00:00Z',
    endsAt: '2026-10-10T02:00:00Z',
  };
  const second = {
    ...today,
    id: 'second',
    shiftName: 'Second shift',
    startsAt: '2026-10-10T02:00:00Z',
    endsAt: '2026-10-10T02:30:00Z',
  };
  api.attendanceDays.mockResolvedValue({ items: [first, second], total: 2 });
  api.attendanceDayDetail.mockImplementation(async (_token, _site, id) => ({
    day: id === 'first' ? first : second,
    sessions: [],
  }));
  mount();
  await waitFor(() =>
    expect(api.attendanceDayDetail).toHaveBeenCalledWith('synthetic', 'site', 'second'),
  );
  fireEvent.click(screen.getByRole('button', { name: /View details/i }));
  const select = await screen.findByRole('combobox', { name: 'Select attendance shift' });
  expect((select as HTMLSelectElement).value).toBe('second');
  fireEvent.change(select, { target: { value: 'first' } });
  await waitFor(() =>
    expect(api.attendanceDayDetail).toHaveBeenCalledWith('synthetic', 'site', 'first'),
  );
});
it('uses independent full-month aggregates, minutes and scoped attention totals', async () => {
  mount();
  await screen.findByText('12h 40m');
  expect(screen.getByText('1h 30m')).toBeTruthy();
  expect(await screen.findByText('0h 42m')).toBeTruthy();
  expect(await screen.findByText('31')).toBeTruthy();
  expect(screen.getByText('Asia/Ho_Chi_Minh · 10/10/2026')).toBeTruthy();
  expect(api.attendanceTimesheets).toHaveBeenCalledWith('synthetic', 'site', {
    fromDate: '2026-10-01',
    toDate: '2026-10-31',
  });
  expect(api.attendanceDays).toHaveBeenCalledWith('synthetic', 'site', {
    fromDate: '2026-10-10',
    toDate: '2026-10-10',
    limit: 100,
  });
  expect(api.attendanceDayDetail).toHaveBeenCalledWith('synthetic', 'site', 'today');
});

it('opens a notification day and does not show an ignored duplicate marker as checkout', async () => {
  api.attendanceDayDetail.mockResolvedValue({
    day: { ...today, id: 'old', workDate: '2026-10-08' },
    sessions: [
      {
        id: 'duplicate',
        status: 'IGNORED',
        rawInAt: '2026-10-08T02:28:00Z',
        rawOutAt: null,
        effectiveInAt: null,
        effectiveOutAt: '2026-10-08T02:29:00Z',
        workedMinutes: null,
      },
    ],
  });
  mount('old');
  const toggle = screen.getByRole('button', { name: /View details/i });
  fireEvent.click(toggle);
  await screen.findByText('Duplicate ignored');
  expect(screen.getByRole('heading', { name: 'Attendance intervals · 08/10/2026' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: "Today's attendance intervals" })).toBeNull();
  expect(screen.getByText(/Duplicate check-in.*09:28/)).toBeTruthy();
  expect(screen.queryByText(/09:29/)).toBeNull();
  expect(api.attendanceDayDetail).toHaveBeenCalledWith('synthetic', 'site', 'old');
});

it('shows unavailable rather than zero when monthly totals fail', async () => {
  api.attendanceTimesheets.mockRejectedValue(new Error('offline'));
  mount();
  await waitFor(() => expect(screen.getAllByText('Unavailable')).toHaveLength(2));
  expect(screen.getByRole('button', { name: 'Retry Confirmed Hours This Month' })).toBeTruthy();
  expect(screen.queryByText('0h 0m')).toBeNull();
});

it('shows no attendance today without importing previous-day sessions', async () => {
  api.attendanceDays.mockImplementation(async (_token, _site, query) => ({
    items: query.fromDate ? [] : [today],
    total: 0,
  }));
  mount();
  const toggle = screen.getByRole('button', { name: /View details/i });
  fireEvent.click(toggle);
  await screen.findByText('No attendance recorded today.');
  expect(api.attendanceDayDetail).not.toHaveBeenCalled();
});

it('shows the worker personal days present for the full current month', async () => {
  mount();
  expect(await screen.findByText('2 / 3')).toBeTruthy();
  expect(screen.getByText('Days Present This Month')).toBeTruthy();
  expect(api.attendanceWorkers).toHaveBeenCalledWith('synthetic', 'site', {
    fromDate: '2026-10-01',
    toDate: '2026-10-31',
    timezone: 'Asia/Ho_Chi_Minh',
    workerId: 'mine',
    limit: 1,
  });
});

it('does not turn a failed days-present report into zero', async () => {
  api.attendanceWorkers.mockRejectedValue(new Error('offline'));
  mount();
  expect(await screen.findByText('Days Present This Month')).toBeTruthy();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Retry Days Present This Month' })).toBeTruthy(),
  );
  expect(screen.queryByText('0 / 0')).toBeNull();
});

it('requests the logged-in worker even when another role can see a wider roster', async () => {
  api.listWorkers.mockResolvedValue({
    items: [
      { id: 'other', userId: 'other-user' },
      { id: 'mine', userId: 'worker' },
    ],
    total: 2,
  });
  mount();
  await screen.findByText('2 / 3');
  expect(api.attendanceWorkers).toHaveBeenCalledWith('synthetic', 'site', {
    fromDate: '2026-10-01',
    toDate: '2026-10-31',
    timezone: 'Asia/Ho_Chi_Minh',
    workerId: 'mine',
    limit: 1,
  });
});
