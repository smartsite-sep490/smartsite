// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import i18n from '../../../i18n';
import { AttendanceResolutionNotice } from './AttendanceResolutionNotice';
import { attendanceResolution } from './attendance-resolution';
import {
  formatNotificationDisplayMessage,
  notificationHref,
} from '../../../features/notifications/notification-utils';
import type { UserNotificationResponse } from '@smartsite/contracts';

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage('en');
});
it('directs missing OUT to Worker correction and missing roll call to Contractor hours review', async () => {
  await i18n.changeLanguage('en');
  render(<AttendanceResolutionNotice issues={['MISSING_OUT']} siteId="site" />);
  expect(screen.getByText(/A confirmed OUT is missing/)).toBeTruthy();
  expect(screen.getByRole('link').getAttribute('href')).toBe('#attendance-correction-form');
  cleanup();
  render(<AttendanceResolutionNotice issues={['ZONE_ATTENDANCE_PENDING']} siteId="site" />);
  expect(
    screen.getByText(/Contractor Representative reviews the evidence and confirms hours/),
  ).toBeTruthy();
  expect(screen.getByRole('link').getAttribute('href')).toBe('#zone-hours-review');
});
it('keeps the assignment action scoped and gives Vietnamese missing-attendance instructions', async () => {
  await i18n.changeLanguage('vi');
  render(<AttendanceResolutionNotice issues={['SCHEDULE_CHANGED']} siteId="site/1" />);
  expect(screen.getByRole('link', { name: 'Kiểm tra phân công' }).getAttribute('href')).toBe(
    '/workforce?siteId=site%2F1&tab=schedule',
  );
  expect(attendanceResolution(['ZONE_GATE_MISSING'])?.message).toContain(
    'chưa có lượt IN được xác nhận',
  );
  expect(attendanceResolution(['ZONE_GATE_MISSING'])?.message).toContain('Đại diện nhà thầu');
  const notice = {
    event: 'MISSING_ATTENDANCE',
    message: 'Synthetic missing evidence',
    workDate: '2026-11-23',
    target: { siteId: 'site', dayId: 'day', tab: 'attendance' },
  } as UserNotificationResponse;
  expect(formatNotificationDisplayMessage(notice)).toContain('Công nhân gửi đơn');
  expect(notificationHref(notice)).toContain('dayId=day');
});
