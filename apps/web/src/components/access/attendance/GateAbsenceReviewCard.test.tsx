// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import type { AttendanceDayDetailResponse } from '@smartsite/contracts';
import { GateAbsenceReviewCard } from './GateAbsenceReviewCard';
import i18n from '../../../i18n';
import {
  formatNotificationTitle,
  formatNotificationDisplayMessage,
  notificationHref,
} from '../../../features/notifications/notification-utils';

let detail: AttendanceDayDetailResponse, cache: QueryClient;
const props = {
  apiUrl: 'https://api.example.test',
  token: 'synthetic-token',
  siteId: 'site',
  sessionScope: 'session',
};
beforeEach(() => {
  cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  detail = {
    day: {
      id: 'day',
      workerId: 'worker',
      workerName: 'Synthetic Worker',
      workDate: '2026-11-23',
      timezone: 'UTC',
      scheduleId: 'schedule',
      shiftName: 'Synthetic shift',
      startsAt: '2026-11-23T08:00:00Z',
      endsAt: '2026-11-23T17:00:00Z',
      status: 'NEEDS_REVIEW',
      regularMinutes: 0,
      overtimeMinutes: 0,
      provisionalMinutes: 0,
      confirmedMinutes: null,
      presence: 'OUTSIDE',
      anomalies: ['ZONE_GATE_MISSING'],
      version: 3,
      canRequest: false,
    },
    sessions: [],
    gateAbsenceReview: {
      canConfirm: true,
      gateEventCount: 0,
      attendanceEventCount: 0,
      sessionCount: 0,
      status: 'PENDING',
      teamAttendance: {
        version: 2,
        status: 'PRESENT',
        recordedBy: 'leader',
        recordedAt: '2026-11-23T17:05:00Z',
      },
    },
  };
  vi.spyOn(SmartSiteManagementClient.prototype, 'confirmAttendanceAbsence').mockResolvedValue({
    id: 'day',
  });
});
afterEach(() => {
  cleanup();
  cache.clear();
  vi.restoreAllMocks();
});
function mount(unavailable = false) {
  const view = (data: AttendanceDayDetailResponse) => (
    <QueryClientProvider client={cache}>
      <GateAbsenceReviewCard {...props} detail={data} unavailable={unavailable} />
    </QueryClientProvider>
  );
  const result = render(view(detail));
  return {
    user: userEvent.setup(),
    change: (data: AttendanceDayDetailResponse) => result.rerender(view(data)),
  };
}
it.each([0, 2])(
  'requires a reason and sends the selected day and roll-call version %s',
  async (version) => {
    if (version === 0) {
      delete detail.gateAbsenceReview!.teamAttendance;
      detail.gateAbsenceReview!.expectedTeamAttendanceVersion = 0;
      detail.day.anomalies = ['ZONE_ATTENDANCE_PENDING'];
    }
    const { user } = mount();
    expect(screen.getByText(/Gate passages: 0/)).toBeTruthy();
    const submit = screen.getByRole('button', { name: 'Confirm absent — 0 hours' });
    expect(submit.hasAttribute('disabled')).toBe(true);
    await user.type(
      screen.getByLabelText('Reason for confirming absence'),
      'Verified absent with the Site',
    );
    await user.click(submit);
    expect(SmartSiteManagementClient.prototype.confirmAttendanceAbsence).toHaveBeenCalledWith(
      props.token,
      'site',
      'day',
      {
        requestId: expect.any(String),
        expectedVersion: 3,
        expectedTeamAttendanceVersion: version,
        reason: 'Verified absent with the Site',
      },
    );
  },
);
it('keeps failed input and the same command ID for an identical retry', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.confirmAttendanceAbsence).mockRejectedValueOnce(
    new Error('Unavailable'),
  );
  const { user } = mount();
  await user.type(
    screen.getByLabelText('Reason for confirming absence'),
    'Evidence checked; Worker absent',
  );
  await user.click(screen.getByRole('button', { name: 'Confirm absent — 0 hours' }));
  await screen.findByRole('alert');
  await user.click(screen.getByRole('button', { name: 'Confirm absent — 0 hours' }));
  const calls = vi.mocked(SmartSiteManagementClient.prototype.confirmAttendanceAbsence).mock.calls;
  expect(calls).toHaveLength(2);
  expect(calls[0]![3]).toEqual(calls[1]![3]);
});
it('does not rebase an edited reason onto a newer record', async () => {
  const { user, change } = mount();
  await user.type(
    screen.getByLabelText('Reason for confirming absence'),
    'Checked the original evidence',
  );
  change({ ...detail, day: { ...detail.day, version: 4 } });
  await screen.findByRole('alert');
  expect(
    screen.getByRole('button', { name: 'Confirm absent — 0 hours' }).hasAttribute('disabled'),
  ).toBe(true);
  expect(SmartSiteManagementClient.prototype.confirmAttendanceAbsence).not.toHaveBeenCalled();
});
it.each([false, true])(
  'respects a missing server capability or unavailable data (%s)',
  async (unavailable) => {
    if (!unavailable) detail.gateAbsenceReview!.canConfirm = false;
    mount(unavailable);
    if (!unavailable)
      expect(screen.queryByRole('button', { name: 'Confirm absent — 0 hours' })).toBeNull();
    else
      expect(
        screen.getByRole('button', { name: 'Confirm absent — 0 hours' }).hasAttribute('disabled'),
      ).toBe(true);
  },
);
it('shows the stored absence decision while retaining the original PRESENT roll call', async () => {
  detail = {
    ...detail,
    day: { ...detail.day, status: 'ABSENT' },
    gateAbsenceReview: {
      ...detail.gateAbsenceReview!,
      canConfirm: false,
      status: 'CONFIRMED_ABSENT',
      decision: {
        reviewedBy: 'rep',
        reviewedAt: '2026-11-23T18:00:00Z',
        reason: 'Worker verified absent',
      },
    },
  };
  mount();
  expect(screen.getByText(/Absence confirmed — 0 hours/)).toBeTruthy();
  expect(screen.getByText(/Leader recorded Present/)).toBeTruthy();
  expect(screen.getByText('Worker verified absent')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Confirm absent — 0 hours' })).toBeNull();
});
it('opens the correct day from the new notification and translates its message', async () => {
  await i18n.changeLanguage('vi');
  const notice = {
    id: 'notice',
    event: 'ABSENCE_REVIEW_REQUIRED' as const,
    siteId: 'site',
    siteName: 'Synthetic Site',
    title: 'ABSENCE REVIEW REQUIRED',
    message:
      'Worker Synthetic Worker (W000001) was marked present on 2026-11-23, but no Gate IN/OUT was recorded. Review attendance before confirming absence.',
    createdAt: '2026-11-23T18:00:00Z',
    readAt: null,
    target: { siteId: 'site', dayId: 'day', tab: 'attendance' as const },
  };
  expect(formatNotificationTitle(notice)).toContain('cần xác nhận vắng');
  expect(formatNotificationDisplayMessage(notice)).toContain('Synthetic Worker (W000001)');
  const url = new URL(notificationHref(notice), 'https://web.example.test');
  expect(url.pathname).toBe('/access');
  expect(url.searchParams.get('dayId')).toBe('day');
});

it('translates a missing-roll-call absence notice without claiming the leader marked present', async () => {
  await i18n.changeLanguage('vi');
  const message = formatNotificationDisplayMessage({
    event: 'ABSENCE_REVIEW_REQUIRED',
    message:
      'Worker Synthetic Worker (W01) has no leader roll call on 2026-11-23, and no Gate IN/OUT was recorded. Review attendance before confirming absence.',
  } as Parameters<typeof formatNotificationDisplayMessage>[0]);
  expect(message).toContain('chưa được đội trưởng điểm danh');
  expect(message).toContain('0 giờ');
});

it('explains why a rejected empty report does not block authorized absence review', async () => {
  await i18n.changeLanguage('en');
  delete detail.gateAbsenceReview!.teamAttendance;
  detail.gateAbsenceReview!.expectedTeamAttendanceVersion = 0;
  detail.gateAbsenceReview!.sessionCount = 1;
  detail.gateAbsenceReview!.emptyRejectedReportCount = 1;
  mount();
  expect(screen.getByText(/empty missing-attendance report/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Confirm absent — 0 hours' })).toBeTruthy();
});
