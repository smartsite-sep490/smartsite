// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AttendanceDaysView } from './AttendanceDaysView';
import { AttendanceView } from './AttendanceView';
import i18n from '../../../i18n';

const api = vi.hoisted(() => ({
  attendanceDays: vi.fn(),
  attendanceTimeRequests: vi.fn(),
  listWorkerSchedules: vi.fn(),
  listShifts: vi.fn(),
  listWorkers: vi.fn(),
  attendanceDayDetail: vi.fn(),
  attendanceTimesheets: vi.fn(),
  requestAttendanceTime: vi.fn(),
  reviewAttendanceTime: vi.fn(),
  confirmAttendanceDay: vi.fn(),
  attendanceOverview: vi.fn(),
  requestAttendanceCorrection: vi.fn(),
  reviewAttendanceCorrection: vi.fn(),
  ignoreDuplicateAttendance: vi.fn(),
}));
vi.mock('@smartsite/api-client', () => ({
  SmartSiteManagementClient: class {
    constructor() {
      return api;
    }
  },
}));
const day = {
  id: 'day-1',
  workerId: 'worker-1',
  workerName: 'Synthetic Worker',
  workDate: '2030-10-08',
  timezone: 'Asia/Ho_Chi_Minh',
  scheduleId: 'schedule-101',
  shiftName: 'Day shift',
  startsAt: '2030-10-08T01:00:00Z',
  endsAt: '2030-10-08T10:00:00Z',
  status: 'NEEDS_REVIEW',
  regularMinutes: 180,
  overtimeMinutes: 0,
  provisionalMinutes: 180,
  confirmedMinutes: null,
  presence: 'OUTSIDE',
  anomalies: ['EARLY_CHECKOUT'],
  version: 3,
  canRequest: false,
};
let cache: QueryClient;
function mount(withCorrections = false, isWorker = false) {
  cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const View = withCorrections ? AttendanceView : AttendanceDaysView;
  return render(
    <QueryClientProvider client={cache}>
      <View
        apiUrl="https://synthetic.test"
        token="synthetic-token"
        siteId="site-1"
        sessionScope="session-1"
        isWorker={isWorker}
      />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/');
  api.attendanceTimesheets.mockResolvedValue({ items: [] });
  api.attendanceTimeRequests.mockResolvedValue({ items: [], total: 0 });
  api.listWorkers.mockResolvedValue({ items: [], total: 0 });
  api.listWorkerSchedules.mockResolvedValue({ items: [], total: 0 });
  api.listShifts.mockResolvedValue({
    items: [
      {
        id: 'shift-1',
        name: 'Morning',
        startsAt: '2030-10-08T01:00:00Z',
        endsAt: '2030-10-08T10:00:00Z',
        timezone: 'Asia/Ho_Chi_Minh',
      },
    ],
    total: 1,
  });
  api.attendanceDayDetail.mockResolvedValue({ day: { ...day, version: 7 }, sessions: [] });
  api.requestAttendanceTime.mockResolvedValue({ id: 'request-1' });
  api.reviewAttendanceTime.mockResolvedValue({ id: 'request-1' });
  api.confirmAttendanceDay.mockResolvedValue({ id: 'day-1' });
});
afterEach(async () => {
  cleanup();
  cache?.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
  await i18n.changeLanguage('en');
});

describe('MF03 interactive UI', () => {
  it.each(['OVERTIME', 'LEAVE'] as const)(
    'opens a rejection form for %s and requires a reason before sending',
    async (kind) => {
      api.attendanceDays.mockResolvedValue({
        items: [],
        total: 0,
        requests: [],
        canReview: true,
        canRequest: false,
      });
      api.attendanceTimeRequests.mockResolvedValue({
        items: [
          {
            id: 'request-1',
            kind,
            workerName: 'Synthetic Worker',
            status: kind === 'LEAVE' ? 'PENDING_MANAGER' : 'PENDING',
            startsAt: day.startsAt,
            endsAt: day.endsAt,
            reason: 'Request for workday',
            reviewNote: null,
          },
        ],
        total: 1,
      });
      mount();
      expect(await screen.findByText(kind === 'OVERTIME' ? 'Overtime' : 'Leave')).toBeTruthy();
      await act(async () => {
        await i18n.changeLanguage('vi');
      });
      expect(
        screen.getByText(kind === 'OVERTIME' ? 'Tăng ca' : 'Nghỉ phép', { selector: 'span' }),
      ).toBeTruthy();
      expect(screen.queryByText(kind)).toBeNull();
      expect(screen.getByText('Request for workday')).toBeTruthy();
      await act(async () => {
        await i18n.changeLanguage('en');
      });
      await userEvent.click(await screen.findByRole('button', { name: 'Reject' }));
      expect(api.reviewAttendanceTime).not.toHaveBeenCalled();
      expect(
        (screen.getByRole('button', { name: 'Confirm rejection' }) as HTMLButtonElement).disabled,
      ).toBe(true);
      fireEvent.change(screen.getByLabelText('Reason for rejection'), { target: { value: '   ' } });
      expect(
        (screen.getByRole('button', { name: 'Confirm rejection' }) as HTMLButtonElement).disabled,
      ).toBe(true);
      await userEvent.click(screen.getByRole('button', { name: 'Cancel rejection' }));
      expect(screen.queryByRole('form', { name: 'Reject request' })).toBeNull();
      expect(api.reviewAttendanceTime).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
      fireEvent.change(screen.getByLabelText('Reason for rejection'), {
        target: { value: '  No additional work needed  ' },
      });
      await userEvent.click(screen.getByRole('button', { name: 'Confirm rejection' }));
      await waitFor(() =>
        expect(api.reviewAttendanceTime).toHaveBeenCalledWith(
          'synthetic-token',
          'site-1',
          'request-1',
          kind,
          { approve: false, reviewNote: 'No additional work needed' },
        ),
      );
      await waitFor(() =>
        expect(screen.queryByRole('form', { name: 'Reject request' })).toBeNull(),
      );
    },
  );
  it.each(['APPROVED', 'REJECTED'] as const)(
    'shows the submitted request and refreshes its %s result without reopening the form',
    async (result) => {
      let sent = false;
      let status: string = 'PENDING';
      const record = {
        id: 'request-1',
        kind: 'OVERTIME',
        workerId: 'worker-1',
        workerName: 'Synthetic Worker',
        scheduleId: 'schedule-101',
        startsAt: '2030-10-08T10:00:00Z',
        endsAt: '2030-10-08T11:00:00Z',
        reason: 'Finish assigned work',
        reviewNote: null,
      };
      api.attendanceDays.mockResolvedValue({
        items: [],
        total: 0,
        requests: [],
        canReview: false,
        canRequest: true,
      });
      api.listWorkerSchedules.mockResolvedValue({
        items: [{ id: 'schedule-101', shiftId: 'shift-1', workDate: '2030-10-08', isActive: true }],
        total: 1,
      });
      api.attendanceTimeRequests.mockImplementation(async () => ({
        items: sent
          ? [
              {
                ...record,
                status,
                reviewNote: status === 'PENDING' ? null : 'Reviewed by contractor',
              },
            ]
          : [],
        total: sent ? 1 : 0,
      }));
      api.requestAttendanceTime.mockImplementation(async () => {
        sent = true;
        return { id: record.id };
      });
      mount(true, true);
      await screen.findByRole('option', { name: /2030-10-08 · Morning/ });
      fireEvent.change(screen.getByLabelText('Assigned shift'), {
        target: { value: 'schedule-101' },
      });
      fireEvent.change(screen.getByLabelText('Reason'), { target: { value: record.reason } });
      await userEvent.click(screen.getByRole('button', { name: 'Submit request' }));
      const card = within(await screen.findByRole('region', { name: 'Submitted request' }));
      await card.findByText('Pending approval');
      expect(screen.queryByRole('button', { name: 'Submit request' })).toBeNull();
      expect(card.getByText(/Waiting for your Site Manager/)).toBeTruthy();
      expect(api.requestAttendanceTime).toHaveBeenCalledTimes(1);
      status = result;
      await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
      await card.findByText(result === 'APPROVED' ? 'Approved' : 'Rejected');
      expect(card.getByText('Review: Reviewed by contractor')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Submit request' })).toBeNull();
      await userEvent.click(card.getByRole('button', { name: 'New request' }));
      expect(await screen.findByRole('button', { name: 'Submit request' })).toBeTruthy();
      expect(api.requestAttendanceTime).toHaveBeenCalledTimes(1);
    },
  );
  it('hides past workdays and exposes separate overtime dates and times with shift defaults', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-10-08T03:00:00Z'));
    api.attendanceDays.mockResolvedValue({
      items: [],
      total: 0,
      requests: [],
      canRequest: true,
      canReview: false,
    });
    api.listWorkerSchedules.mockResolvedValue({
      items: [
        { id: 'past', shiftId: 'shift-1', workDate: '2030-10-07', isActive: true },
        { id: 'today', shiftId: 'shift-1', workDate: '2030-10-08', isActive: true },
        { id: 'future', shiftId: 'shift-1', workDate: '2030-10-09', isActive: true },
        { id: 'inactive', shiftId: 'shift-1', workDate: '2030-10-10', isActive: false },
      ],
      total: 4,
    });
    mount();
    await screen.findByRole('option', { name: /2030-10-08 · Morning/ });
    expect(screen.queryByRole('option', { name: /2030-10-07/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /2030-10-10/ })).toBeNull();
    expect(screen.getByRole('option', { name: /2030-10-09 · Morning/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Assigned shift'), { target: { value: 'today' } });
    expect((screen.getByLabelText('Start date') as HTMLInputElement).value).toBe('2030-10-08');
    expect((screen.getByLabelText('Start time') as HTMLInputElement).type).toBe('time');
    expect((screen.getByLabelText('Start time') as HTMLInputElement).value).toBe('17:00');
    expect((screen.getByLabelText('End time') as HTMLInputElement).value).toBe('18:00');
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '16:00' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Finish work' } });
    await userEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    await screen.findAllByText('Overtime must start in the future, outside regular shift hours.');
    expect(api.requestAttendanceTime).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Request Type'), { target: { value: 'LEAVE' } });
    expect((screen.getByLabelText('Start time') as HTMLInputElement).value).toBe('08:00');
    expect((screen.getByLabelText('End time') as HTMLInputElement).value).toBe('17:00');
  });

  it('fails closed when shift hours cannot be loaded and retries the form data', async () => {
    api.attendanceDays.mockResolvedValue({
      items: [],
      total: 0,
      requests: [],
      canRequest: true,
      canReview: false,
    });
    api.listWorkerSchedules.mockResolvedValue({
      items: [{ id: 'schedule', shiftId: 'shift-1', workDate: '2030-10-08', isActive: true }],
      total: 1,
    });
    api.listShifts.mockRejectedValueOnce(new Error('offline'));
    mount();
    await screen.findByText('Assigned shifts unavailable.');
    expect(screen.queryByRole('button', { name: 'Submit request' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Retry assigned shifts' }));
    await screen.findByRole('option', { name: /2030-10-08 · Morning/ });
  });
  it('keeps Worker overtime and leave forms while hiding management controls', async () => {
    api.attendanceDays.mockResolvedValue({
      items: [day],
      total: 1,
      requests: [],
      canRequest: true,
      canReview: false,
    });
    api.attendanceOverview.mockResolvedValue({
      sessions: [],
      corrections: [],
      canRequestCorrection: true,
      canReviewCorrection: false,
    });
    api.listWorkerSchedules.mockResolvedValue({
      items: [{ id: 'schedule-101', shiftId: 'shift-1', workDate: day.workDate, isActive: true }],
      total: 1,
    });
    mount(true, true);
    await screen.findByRole('heading', { name: 'Request Overtime or Leave' });
    expect(screen.getAllByRole('option', { name: 'Overtime' }).length).toBeGreaterThan(0);
    expect(
      await screen.findByRole('option', { name: 'Leave (whole or partial shift)' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Submit request' })).toBeTruthy();
    expect(screen.queryByText('+ Enrol Worker')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(api.attendanceOverview).toHaveBeenCalled();
    expect(
      await screen.findByRole('heading', { name: 'Request an attendance correction' }),
    ).toBeTruthy();
  });
  it('compares a changed schedule with the original shift and blocks early-departure confirmation', async () => {
    const changed = { ...day, anomalies: ['SCHEDULE_CHANGED', 'EARLY_CHECKOUT'] };
    api.attendanceDays.mockResolvedValue({
      items: [changed],
      total: 1,
      requests: [],
      canRequest: false,
      canReview: true,
    });
    api.attendanceDayDetail.mockResolvedValue({
      day: changed,
      sessions: [],
      currentSchedule: {
        id: 'schedule-101',
        shiftName: 'Changed shift',
        workDate: day.workDate,
        timezone: day.timezone,
        isActive: false,
        startsAt: day.startsAt,
        endsAt: '2030-10-08T11:00:00Z',
      },
    });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'View' }));
    await screen.findByText(/Changed shift/);
    expect(screen.getByText(/Inactive schedule/)).not.toBeNull();
    expect(screen.getByText('Original shift used for attendance')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Open workforce schedule' }).getAttribute('href')).toBe(
      '/workforce?siteId=site-1&tab=schedule',
    );
    expect(
      screen.queryByRole('button', { name: 'Confirm actual hours for early departure' }),
    ).toBeNull();
    expect(api.confirmAttendanceDay).not.toHaveBeenCalled();
  });
  it('pages the request queue independently, resets filters and retries a failed page', async () => {
    api.attendanceDays.mockResolvedValue({
      items: [],
      total: 0,
      requests: [],
      canRequest: false,
      canReview: true,
    });
    const item = {
      id: 'request-101',
      kind: 'OVERTIME',
      workerName: 'Synthetic Worker',
      startsAt: '2030-10-08T10:00:00Z',
      endsAt: '2030-10-08T11:00:00Z',
      reason: 'Request beyond the old limit',
      status: 'PENDING',
      reviewNote: null,
    };
    api.attendanceTimeRequests.mockImplementation(async (_token, _site, query) => ({
      items: query.offset === 100 ? [item] : [],
      total: 101,
    }));
    mount();
    await screen.findByText('101 requests');
    for (let page = 1; page <= 5; page++) {
      await userEvent.click(screen.getByRole('button', { name: 'Next requests' }));
      await waitFor(() =>
        expect(api.attendanceTimeRequests).toHaveBeenLastCalledWith('synthetic-token', 'site-1', {
          kind: 'OVERTIME',
          offset: page * 20,
          limit: 20,
        }),
      );
      await waitFor(() => expect(screen.queryByText('Loading time requests…')).toBeNull());
    }
    await screen.findByText(item.reason);
    expect(
      (screen.getByRole('button', { name: 'Next requests' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    api.attendanceTimeRequests.mockRejectedValueOnce(new Error('Queue unavailable'));
    fireEvent.change(screen.getByLabelText('Queue type'), { target: { value: 'LEAVE' } });
    await screen.findByText('Queue unavailable');
    await userEvent.click(screen.getByRole('button', { name: 'Retry time requests' }));
    await waitFor(() => expect(screen.queryByText('Queue unavailable')).toBeNull());
    fireEvent.change(screen.getByLabelText('Request status'), { target: { value: 'PENDING' } });
    await waitFor(() =>
      expect(api.attendanceTimeRequests).toHaveBeenLastCalledWith('synthetic-token', 'site-1', {
        kind: 'LEAVE',
        status: 'PENDING',
        offset: 0,
        limit: 20,
      }),
    );
  });
  it('keeps missing entry blank and preserves the recorded exit timestamp when requesting a correction', async () => {
    const recordedOut = '2030-10-08T09:47:29.628Z';
    api.attendanceOverview.mockResolvedValue({
      canRequestCorrection: true,
      canReviewCorrection: false,
      corrections: [],
      sessions: [
        {
          id: 'missing-in',
          workerName: 'Synthetic Worker',
          version: 1,
          status: 'MISSING_IN',
          effectiveInAt: null,
          effectiveOutAt: recordedOut,
          workedMinutes: null,
        },
      ],
    });
    api.attendanceDays.mockResolvedValue({
      items: [],
      total: 0,
      requests: [],
      canRequest: true,
      canReview: false,
    });
    api.requestAttendanceCorrection.mockResolvedValue({ id: 'correction-1' });
    mount(true);
    await screen.findByRole('option', { name: /Synthetic Worker/ });
    fireEvent.change(screen.getByLabelText('Session'), { target: { value: 'missing-in' } });
    const entry = screen.getByLabelText('Proposed in hour') as HTMLSelectElement;
    expect(entry.value).toBe('');
    expect((screen.getByLabelText('Proposed out hour') as HTMLSelectElement).value).toBe(
      String(new Date(recordedOut).getHours()).padStart(2, '0'),
    );
    expect(
      (
        screen.getByRole('button', {
          name: 'Send to Site Manager',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.change(entry, { target: { value: '08' } });
    fireEvent.change(screen.getByLabelText('Proposed in minute'), { target: { value: '00' } });
    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: 'Actual entry confirmed' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Send to Site Manager' }));
    await waitFor(() =>
      expect(api.requestAttendanceCorrection).toHaveBeenCalledWith(
        'synthetic-token',
        'site-1',
        'missing-in',
        expect.objectContaining({ proposedOutAt: recordedOut, reason: 'Actual entry confirmed' }),
      ),
    );
  });
  it('requires a reason to ignore duplicate IN and keeps missing evidence out of active presence', async () => {
    api.attendanceDays.mockResolvedValue({
      items: [day],
      total: 1,
      requests: [],
      canReview: true,
      canRequest: false,
    });
    let ignored = false;
    api.attendanceDayDetail.mockImplementation(async () => ({
      day,
      sessions: [
        {
          id: 'duplicate-1',
          status: ignored ? 'IGNORED' : 'NEEDS_REVIEW',
          effectiveInAt: null,
          effectiveOutAt: '2030-10-08T09:38:00Z',
          rawInAt: '2030-10-08T09:38:00Z',
          rawOutAt: null,
          version: 2,
          canIgnoreDuplicate: !ignored,
          ignoreReason: ignored ? 'Confirmed repeated scan' : null,
        },
        {
          id: 'missing-1',
          status: 'MISSING_IN',
          effectiveInAt: null,
          effectiveOutAt: '2030-10-08T09:47:00Z',
          version: 1,
        },
      ],
    }));
    api.ignoreDuplicateAttendance.mockImplementation(async () => {
      ignored = true;
      return { id: 'duplicate-1' };
    });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'View' }));
    const button = await screen.findByRole('button', { name: 'Ignore duplicate IN' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText('Inside site · interval open')).toBeNull();
    expect(screen.getByText(/Missing IN: request a correction/)).not.toBeNull();
    fireEvent.change(screen.getByLabelText('Review note'), {
      target: { value: 'Confirmed repeated scan' },
    });
    await userEvent.click(button);
    await screen.findByText(/Ignored — no work hours added/);
    expect(api.ignoreDuplicateAttendance).toHaveBeenCalledWith(
      'synthetic-token',
      'site-1',
      'duplicate-1',
      { expectedSessionVersion: 2, reason: 'Confirmed repeated scan' },
    );
    expect(screen.queryByRole('button', { name: 'Ignore duplicate IN' })).toBeNull();
  });
  it('immediately refreshes confirmed hours when a worker requests a correction', async () => {
    let pending = false;
    api.attendanceOverview.mockResolvedValue({
      canRequestCorrection: true,
      canReviewCorrection: false,
      corrections: [],
      sessions: [
        {
          id: 'session-1',
          workerName: 'Synthetic Worker',
          version: 4,
          status: 'MATCHED',
          effectiveInAt: day.startsAt,
          effectiveOutAt: day.endsAt,
          workedMinutes: 420,
        },
      ],
    });
    api.attendanceDays.mockImplementation(async () => ({
      items: [
        {
          ...day,
          confirmedMinutes: pending ? null : 420,
          status: pending ? 'NEEDS_REVIEW' : 'CONFIRMED',
        },
      ],
      total: 1,
      requests: [],
      canRequest: true,
      canReview: false,
    }));
    api.attendanceTimesheets.mockImplementation(async () => ({
      items: pending
        ? []
        : [
            {
              workerId: 'worker-1',
              workerName: 'Synthetic Worker',
              confirmedDays: 1,
              regularMinutes: 420,
              overtimeMinutes: 0,
              totalMinutes: 420,
            },
          ],
    }));
    api.requestAttendanceCorrection.mockImplementation(async () => {
      pending = true;
      return { id: 'correction-1' };
    });
    mount(true);
    await screen.findByText(/1 confirmed days/);
    await userEvent.click(screen.getByRole('button', { name: 'View' }));
    await waitFor(() =>
      expect(api.attendanceOverview).toHaveBeenCalledWith('synthetic-token', 'site-1', {
        dayId: 'day-1',
      }),
    );
    fireEvent.change(screen.getByLabelText('Session'), { target: { value: 'session-1' } });
    fireEvent.change(screen.getByLabelText('Proposed in hour'), {
      target: { value: '08' },
    });
    fireEvent.change(screen.getByLabelText('Proposed in minute'), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('Proposed out hour'), {
      target: { value: '17' },
    });
    fireEvent.change(screen.getByLabelText('Proposed out minute'), { target: { value: '00' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Correct late start' } });
    await userEvent.click(screen.getByRole('button', { name: 'Send to Site Manager' }));
    await screen.findByText('Awaiting confirmation');
    await screen.findByText('No confirmed hours in this range.');
    expect(api.requestAttendanceCorrection).toHaveBeenCalledWith(
      'synthetic-token',
      'site-1',
      'session-1',
      expect.objectContaining({ expectedSessionVersion: 4, reason: 'Correct late start' }),
    );
  });
  it('loads assigned schedules beyond page 100 and submits worker overtime with entered times', async () => {
    api.attendanceDays.mockResolvedValue({
      items: [],
      total: 0,
      requests: [],
      canReview: false,
      canRequest: true,
    });
    const first = Array.from({ length: 100 }, (_, i) => ({
      id: `schedule-${i}`,
      shiftId: 'shift-1',
      workDate: '2000-10-01',
      isActive: true,
    }));
    api.listWorkerSchedules.mockImplementation(async (_token, _site, options) => ({
      items:
        options.offset === 0
          ? first
          : [{ id: 'schedule-101', shiftId: 'shift-1', workDate: '2030-10-08', isActive: true }],
      total: 101,
    }));
    mount();
    await screen.findByRole('option', { name: /2030-10-08 · Morning/ });
    expect(api.listWorkerSchedules).toHaveBeenCalledWith('synthetic-token', 'site-1', {
      offset: 100,
      limit: 100,
      status: 'ACTIVE',
    });
    fireEvent.change(screen.getByLabelText('Assigned shift'), {
      target: { value: 'schedule-101' },
    });
    fireEvent.change(screen.getByLabelText('Start time'), { target: { value: '17:00' } });
    fireEvent.change(screen.getByLabelText('End time'), { target: { value: '18:00' } });
    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: 'Finish assigned work' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Submit request' }));
    await screen.findByText('Request submitted.');
    expect(api.requestAttendanceTime).toHaveBeenCalledWith(
      'synthetic-token',
      'site-1',
      expect.objectContaining({
        workerScheduleId: 'schedule-101',
        kind: 'OVERTIME',
        reason: 'Finish assigned work',
        startsAt: '2030-10-08T10:00:00.000Z',
        endsAt: '2030-10-08T11:00:00.000Z',
        requestId: expect.any(String),
      }),
    );
    expect(screen.queryByText('Review note')).toBeNull();
  });
  it('approves a time request without a note but keeps early-departure confirmation notes', async () => {
    api.attendanceTimeRequests.mockResolvedValue({
      total: 1,
      items: [
        {
          id: 'request-1',
          kind: 'LEAVE',
          workerName: 'Synthetic Worker',
          status: 'PENDING_MANAGER',
          startsAt: day.startsAt,
          endsAt: day.endsAt,
          reason: 'Synthetic leave',
          reviewNote: null,
        },
      ],
    });
    api.attendanceDays.mockResolvedValue({
      items: [day],
      total: 1,
      requests: [
        {
          id: 'request-1',
          kind: 'LEAVE',
          workerName: 'Synthetic Worker',
          status: 'PENDING_MANAGER',
          startsAt: day.startsAt,
          endsAt: day.endsAt,
          reason: 'Synthetic leave',
          reviewNote: null,
        },
      ],
      canReview: true,
      canRequest: false,
    });
    mount();
    await screen.findByText('Synthetic leave');
    expect(screen.queryByLabelText('Review note')).toBeNull();
    expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(api.reviewAttendanceTime).toHaveBeenCalledWith(
        'synthetic-token',
        'site-1',
        'request-1',
        'LEAVE',
        { approve: true },
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: 'View' }));
    await waitFor(() => expect(api.attendanceDayDetail).toHaveBeenCalled());
    fireEvent.change(screen.getByLabelText('Review note'), {
      target: { value: 'Verified actual departure' },
    });
    await userEvent.click(
      await screen.findByRole('button', { name: 'Confirm actual hours for early departure' }),
    );
    await waitFor(() =>
      expect(api.confirmAttendanceDay).toHaveBeenCalledWith('synthetic-token', 'site-1', 'day-1', {
        expectedVersion: 7,
        reviewNote: 'Verified actual departure',
      }),
    );
    expect(screen.queryByRole('button', { name: 'Submit request' })).toBeNull();
  });
  it.each([['EARLY_CHECKOUT'], ['EARLY_CHECKOUT', 'EXIT_DURATION_EXCEEDED']])(
    'shows a version conflict and reloads early departure with anomalies %j',
    async (...anomalies) => {
      const reviewDay = { ...day, anomalies };
      api.attendanceDays.mockResolvedValue({
        items: [reviewDay],
        total: 1,
        requests: [],
        canReview: true,
        canRequest: false,
      });
      api.attendanceDayDetail.mockResolvedValue({
        day: { ...reviewDay, version: 7 },
        sessions: [],
      });
      api.confirmAttendanceDay.mockRejectedValue(
        new Error('Attendance changed; reload before reviewing'),
      );
      mount();
      await userEvent.click(await screen.findByRole('button', { name: 'View' }));
      await waitFor(() => expect(api.attendanceDayDetail).toHaveBeenCalled());
      fireEvent.change(screen.getByLabelText('Review note'), {
        target: { value: 'Verified departure' },
      });
      await userEvent.click(
        screen.getByRole('button', { name: 'Confirm actual hours for early departure' }),
      );
      expect(await screen.findByRole('alert')).toHaveProperty(
        'textContent',
        'Attendance changed; reload before reviewing',
      );
      const before = api.attendanceDayDetail.mock.calls.length;
      await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
      await waitFor(() =>
        expect(api.attendanceDayDetail.mock.calls.length).toBeGreaterThan(before),
      );
    },
  );
});
