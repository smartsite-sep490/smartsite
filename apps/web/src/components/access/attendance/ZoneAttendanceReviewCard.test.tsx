// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SmartSiteManagementClient } from '@smartsite/api-client';
import type { AttendanceDayDetailResponse } from '@smartsite/contracts';
import { ZoneAttendanceReviewCard } from './ZoneAttendanceReviewCard';
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
beforeEach(async () => {
  await i18n.changeLanguage('en');
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
      anomalies: ['ZONE_ATTENDANCE_PENDING'],
      version: 3,
      canRequest: false,
    },
    sessions: [],
    zoneAttendanceReview: {
      canConfirm: true,
      status: 'PENDING',
      evidenceHash: 'a'.repeat(64),
      gateInCount: 1,
      gateOutCount: 1,
      sessionCount: 1,
      regularMinutes: 60,
      overtimeMinutes: 0,
      teamAttendanceStatus: 'NOT_YET',
    },
  };
  vi.spyOn(SmartSiteManagementClient.prototype, 'confirmAttendanceZoneHours').mockResolvedValue({
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
      <ZoneAttendanceReviewCard {...props} detail={data} unavailable={unavailable} />
    </QueryClientProvider>
  );
  const result = render(view(detail));
  return {
    user: userEvent.setup(),
    change: (data: AttendanceDayDetailResponse) => result.rerender(view(data)),
  };
}
it('requires a reason and sends the selected day and roll-call versions', async () => {
  const { user } = mount();
  expect(screen.getByText(/Gate IN: 1/)).toBeTruthy();
  const submit = screen.getByRole('button', { name: 'Confirm working hours' });
  expect(submit.hasAttribute('disabled')).toBe(true);
  await user.type(
    screen.getByLabelText('Reason for confirming working hours'),
    'Verified Gate hours; leader missing roll call',
  );
  await user.click(submit);
  expect(SmartSiteManagementClient.prototype.confirmAttendanceZoneHours).toHaveBeenCalledWith(
    props.token,
    'site',
    'day',
    {
      requestId: expect.any(String),
      expectedVersion: 3,
      evidenceHash: 'a'.repeat(64),
      reason: 'Verified Gate hours; leader missing roll call',
    },
  );
});
it('keeps failed input and the same command ID for an identical retry', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.confirmAttendanceZoneHours).mockRejectedValueOnce(
    new Error('Unavailable'),
  );
  const { user } = mount();
  await user.type(
    screen.getByLabelText('Reason for confirming working hours'),
    'Gate intervals checked; leader did not record roll call',
  );
  await user.click(screen.getByRole('button', { name: 'Confirm working hours' }));
  await screen.findByRole('alert');
  await user.click(screen.getByRole('button', { name: 'Confirm working hours' }));
  const calls = vi.mocked(SmartSiteManagementClient.prototype.confirmAttendanceZoneHours).mock
    .calls;
  expect(calls).toHaveLength(2);
  expect(calls[0]![3]).toEqual(calls[1]![3]);
});
it('does not rebase an edited reason onto a newer record', async () => {
  const { user, change } = mount();
  await user.type(
    screen.getByLabelText('Reason for confirming working hours'),
    'Checked the original evidence',
  );
  change({ ...detail, day: { ...detail.day, version: 4 } });
  await screen.findByRole('alert');
  expect(
    screen.getByRole('button', { name: 'Confirm working hours' }).hasAttribute('disabled'),
  ).toBe(true);
  expect(SmartSiteManagementClient.prototype.confirmAttendanceZoneHours).not.toHaveBeenCalled();
});
it('requires a new review when evidence changes without a day-version change', async () => {
  const { user, change } = mount();
  await user.type(
    screen.getByLabelText('Reason for confirming working hours'),
    'Checked original Gate evidence',
  );
  change({
    ...detail,
    zoneAttendanceReview: { ...detail.zoneAttendanceReview!, evidenceHash: 'b'.repeat(64) },
  });
  await screen.findByRole('alert');
  expect(
    screen.getByRole('button', { name: 'Confirm working hours' }).hasAttribute('disabled'),
  ).toBe(true);
});
it('allows a fresh review of completed changed evidence while showing the conflict', async () => {
  detail.zoneAttendanceReview!.status = 'CONFLICTED';
  mount();
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Confirm working hours' })).toBeTruthy();
});
it.each([false, true])(
  'respects a missing server capability or unavailable data (%s)',
  async (unavailable) => {
    if (!unavailable) detail.zoneAttendanceReview!.canConfirm = false;
    mount(unavailable);
    if (!unavailable)
      expect(screen.queryByRole('button', { name: 'Confirm working hours' })).toBeNull();
    else
      expect(
        screen.getByRole('button', { name: 'Confirm working hours' }).hasAttribute('disabled'),
      ).toBe(true);
  },
);
it('shows the confirmed hours while retaining the missing roll call', async () => {
  detail = {
    ...detail,
    day: { ...detail.day, status: 'CONFIRMED' },
    zoneAttendanceReview: {
      ...detail.zoneAttendanceReview!,
      canConfirm: false,
      status: 'CONFIRMED',
      decision: {
        reviewedBy: 'rep',
        reviewedAt: '2026-11-23T18:00:00Z',
        reason: 'Gate hours checked by representative',
      },
    },
  };
  mount();
  expect(screen.getByText(/Working hours confirmed by/)).toBeTruthy();
  expect(screen.getByText(/Not yet/)).toBeTruthy();
  expect(screen.getByText('Gate hours checked by representative')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Confirm working hours' })).toBeNull();
});
it('opens the correct day from the new notification and translates its message', async () => {
  await i18n.changeLanguage('vi');
  const notice = {
    id: 'notice',
    event: 'ZONE_REVIEW_REQUIRED' as const,
    siteId: 'site',
    siteName: 'Synthetic Site',
    title: 'ABSENCE REVIEW REQUIRED',
    message:
      'Worker Synthetic Worker (W000001) has complete Gate IN/OUT on 2026-11-23, but no team leader roll call was recorded. Review recorded hours before confirming attendance.',
    createdAt: '2026-11-23T18:00:00Z',
    readAt: null,
    target: { siteId: 'site', dayId: 'day', tab: 'attendance' as const },
  };
  expect(formatNotificationTitle(notice)).toContain('cần chốt giờ công');
  expect(formatNotificationDisplayMessage(notice)).toContain('Synthetic Worker (W000001)');
  const url = new URL(notificationHref(notice), 'https://web.example.test');
  expect(url.pathname).toBe('/access');
  expect(url.searchParams.get('dayId')).toBe('day');
});
