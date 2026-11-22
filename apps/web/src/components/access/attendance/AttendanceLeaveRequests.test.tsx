// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AttendanceDaysView } from './AttendanceDaysView';
import i18n from '../../../i18n';

const api = vi.hoisted(() => ({
  attendanceDays: vi.fn(),
  attendanceTimeRequests: vi.fn(),
  listWorkerSchedules: vi.fn(),
  listShifts: vi.fn(),
  attendanceTimesheets: vi.fn(),
  myWorkerRequests: vi.fn(),
  requestAttendanceTime: vi.fn(),
  reviewAttendanceTime: vi.fn(),
  listWorkers: vi.fn(),
}));
vi.mock('@smartsite/api-client', async (original) => ({
  ...(await original<typeof import('@smartsite/api-client')>()),
  SmartSiteManagementClient: class {
    constructor() {
      return api;
    }
  },
}));
let cache: QueryClient;
const availability = () => ({
  items: [],
  total: 0,
  serverTime: new Date().toISOString(),
  leaveAvailableAt: null,
});
beforeEach(async () => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2030-10-08T00:30:00Z'));
  await i18n.changeLanguage('en');
  api.attendanceDays.mockResolvedValue({
    items: [],
    total: 0,
    requests: [],
    canRequest: true,
    canReview: false,
  });
  api.attendanceTimeRequests.mockResolvedValue({ items: [], total: 0 });
  api.attendanceTimesheets.mockResolvedValue({ items: [] });
  api.listWorkerSchedules.mockResolvedValue({
    items: [
      { id: 'today', shiftId: 'day', workDate: '2030-10-08', isActive: true },
      { id: 'tomorrow', shiftId: 'day', workDate: '2030-10-09', isActive: true },
      { id: 'overnight', shiftId: 'night', workDate: '2030-10-07', isActive: true },
      { id: 'ended', shiftId: 'day', workDate: '2030-10-07', isActive: true },
    ],
    total: 4,
  });
  api.listShifts.mockResolvedValue({
    items: [
      {
        id: 'day',
        name: 'Morning',
        startsAt: '2026-10-08T01:00:00Z',
        endsAt: '2026-10-08T10:00:00Z',
        timezone: 'Asia/Ho_Chi_Minh',
      },
      {
        id: 'night',
        name: 'Night',
        startsAt: '2026-10-08T15:00:00Z',
        endsAt: '2026-10-09T01:00:00Z',
        timezone: 'Asia/Ho_Chi_Minh',
      },
    ],
    total: 2,
  });
  api.myWorkerRequests.mockImplementation(async () => availability());
  api.requestAttendanceTime.mockResolvedValue({ id: 'request' });
});
afterEach(async () => {
  cleanup();
  cache?.clear();
  vi.useRealTimers();
  await i18n.changeLanguage('en');
});
function mount() {
  cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={cache}>
      <AttendanceDaysView
        apiUrl="https://synthetic.test"
        token="synthetic"
        siteId="site"
        sessionScope="worker"
        isWorker
      />
    </QueryClientProvider>,
  );
}
async function leave() {
  await screen.findByLabelText('Request Type');
  fireEvent.change(screen.getByLabelText('Request Type'), { target: { value: 'LEAVE' } });
  await waitFor(() => expect(api.myWorkerRequests).toHaveBeenCalled());
}
function selectShift(id: string) {
  fireEvent.change(screen.getByLabelText('Assigned shift'), { target: { value: id } });
  fireEvent.change(screen.getByLabelText('Reason'), {
    target: { value: 'Synthetic leave reason' },
  });
}
function submit() {
  fireEvent.submit(screen.getByRole('button', { name: 'Submit request' }).closest('form')!);
}

it('sends explicit planned leave, offers only eligible shifts and retains the same ID on a failed retry', async () => {
  api.requestAttendanceTime.mockRejectedValueOnce(new Error('offline'));
  mount();
  await leave();
  await screen.findByText(/Planned leave must be submitted/);
  expect(screen.getByRole('option', { name: /2030-10-09 · Morning/ })).toBeTruthy();
  expect(screen.queryByRole('option', { name: /2030-10-08 · Morning/ })).toBeNull();
  selectShift('tomorrow');
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Submit request' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  submit();
  await waitFor(() => expect(api.requestAttendanceTime).toHaveBeenCalledTimes(1));
  const input = api.requestAttendanceTime.mock.calls[0]![2];
  expect(input).toMatchObject({
    kind: 'LEAVE',
    noticeType: 'PLANNED',
    workerScheduleId: 'tomorrow',
    startsAt: '2030-10-09T01:00:00.000Z',
    endsAt: '2030-10-09T10:00:00.000Z',
  });
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect((screen.getByLabelText('Reason') as HTMLInputElement).value).toBe(
    'Synthetic leave reason',
  );
  expect(screen.queryByText('Request submitted.')).toBeNull();
  submit();
  await waitFor(() => expect(api.requestAttendanceTime).toHaveBeenCalledTimes(2));
  expect(api.requestAttendanceTime.mock.calls[1]![2].requestId).toBe(input.requestId);
  await screen.findByRole('region', { name: 'Submitted request' });
});

it('switches to emergency leave with a cleared draft and includes the ongoing previous-day night shift', async () => {
  mount();
  await leave();
  selectShift('tomorrow');
  fireEvent.change(screen.getByLabelText('Leave type'), { target: { value: 'EMERGENCY' } });
  expect((screen.getByLabelText('Assigned shift') as HTMLSelectElement).value).toBe('');
  expect((screen.getByLabelText('Start time') as HTMLInputElement).value).toBe('');
  expect(screen.queryByRole('option', { name: /2030-10-09/ })).toBeNull();
  expect(screen.getByRole('option', { name: /2030-10-07 · Night/ })).toBeTruthy();
  expect(screen.queryByRole('option', { name: /2030-10-07 · Morning/ })).toBeNull();
  selectShift('overnight');
  expect((screen.getByLabelText('Start time') as HTMLInputElement).value).toBe('07:30');
  expect((screen.getByLabelText('End time') as HTMLInputElement).value).toBe('08:00');
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Submit request' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  submit();
  await waitFor(() =>
    expect(api.requestAttendanceTime).toHaveBeenCalledWith(
      'synthetic',
      'site',
      expect.objectContaining({
        kind: 'LEAVE',
        noticeType: 'EMERGENCY',
        workerScheduleId: 'overnight',
        startsAt: '2030-10-08T00:30:00.000Z',
        endsAt: '2030-10-08T01:00:00.000Z',
      }),
    ),
  );
});

it('keeps the classification controls available when planned leave has no eligible schedules', async () => {
  const schedules = await api.listWorkerSchedules();
  api.listWorkerSchedules.mockResolvedValue({
    ...schedules,
    items: schedules.items.filter((s: { id: string }) => s.id !== 'tomorrow'),
    total: 3,
  });
  mount();
  await leave();
  expect(await screen.findByText(/No assigned shifts are at least 24 hours away/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Leave type'), { target: { value: 'EMERGENCY' } });
  expect(await screen.findByRole('option', { name: /2030-10-08 · Morning/ })).toBeTruthy();
});

it('blocks unverified and locked availability, retries the check and leaves overtime available', async () => {
  api.myWorkerRequests.mockRejectedValueOnce(new Error('unavailable'));
  mount();
  await leave();
  selectShift('tomorrow');
  await screen.findByRole('button', { name: 'Retry leave availability' });
  expect(
    (screen.getByRole('button', { name: 'Submit request' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  api.myWorkerRequests.mockResolvedValue({
    ...availability(),
    leaveAvailableAt: '2030-10-09T00:30:00Z',
  });
  fireEvent.click(screen.getByRole('button', { name: 'Retry leave availability' }));
  await screen.findByText(/You can submit another leave request from/);
  expect(
    (screen.getByRole('button', { name: 'Submit request' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  submit();
  await screen.findByText('A leave request can only be submitted once every 24 hours');
  expect(api.requestAttendanceTime).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Request Type'), { target: { value: 'OVERTIME' } });
  selectShift('today');
  submit();
  await waitFor(() => expect(api.requestAttendanceTime).toHaveBeenCalledTimes(1));
  expect(api.requestAttendanceTime.mock.calls[0]![2]).not.toHaveProperty('noticeType');
});

it('rechecks the exact 24-hour boundary on submit and preserves the draft when the deadline passes', async () => {
  vi.setSystemTime(new Date('2030-10-08T01:00:00Z'));
  mount();
  await leave();
  selectShift('tomorrow');
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Submit request' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  vi.setSystemTime(new Date('2030-10-08T01:00:00.001Z'));
  submit();
  await screen.findByText('Planned leave requires at least 24 hours before the shift starts.');
  expect(api.requestAttendanceTime).not.toHaveBeenCalled();
  expect((screen.getByLabelText('Reason') as HTMLInputElement).value).toBe(
    'Synthetic leave reason',
  );
});

it('displays leave classification and submission metadata to reviewers in both languages without querying self availability', async () => {
  api.attendanceDays.mockResolvedValue({
    items: [],
    total: 0,
    requests: [],
    canRequest: false,
    canReview: true,
  });
  api.listWorkers.mockResolvedValue({ items: [], total: 0 });
  api.attendanceTimeRequests.mockResolvedValue({
    items: [
      {
        id: 'leave',
        kind: 'LEAVE',
        noticeType: 'EMERGENCY',
        shortNotice: true,
        submittedOnBehalf: true,
        workerName: 'Synthetic worker',
        status: 'PENDING_MANAGER',
        startsAt: '2030-10-08T01:00:00Z',
        endsAt: '2030-10-08T10:00:00Z',
        createdAt: '2030-10-08T00:30:00Z',
        reason: 'Synthetic reason',
      },
    ],
    total: 1,
  });
  mount();
  await screen.findByText(/Emergency leave/);
  expect(screen.getByText(/Short notice/)).toBeTruthy();
  expect(api.myWorkerRequests).not.toHaveBeenCalled();
  await act(async () => {
    await i18n.changeLanguage('vi');
  });
  expect(screen.getByText(/Nghỉ khẩn cấp/)).toBeTruthy();
  expect(screen.getByText(/Báo nghỉ gấp/)).toBeTruthy();
  expect(screen.getByText(/Gửi thay công nhân/)).toBeTruthy();
});
