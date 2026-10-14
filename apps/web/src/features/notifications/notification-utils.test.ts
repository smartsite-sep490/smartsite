import { afterEach, describe, expect, it } from 'vitest';
import i18n, { translate } from '../../i18n';
import type { UserNotificationResponse } from '@smartsite/api-client';
import {
  notificationHref,
  formatNotificationDisplayMessage,
  formatNotificationTitle,
} from './notification-utils';

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('notification-utils', () => {
  it('opens the worker schedule for a denied entry without inventing an attendance day', () => {
    const notification: UserNotificationResponse = {
      id: 'notice',
      event: 'ENTRY_DENIED_NO_SCHEDULE',
      siteId: 'site',
      siteName: 'Synthetic site',
      title: 'ENTRY DENIED NO SCHEDULE',
      message: 'No shift assigned',
      createdAt: '2026-10-11T03:00:00Z',
      readAt: null,
      target: { siteId: 'site', workDate: '2026-10-11', tab: 'schedule' },
    };
    expect(notificationHref(notification)).toBe(
      '/workforce?siteId=site&workDate=2026-10-11&tab=schedule',
    );
  });

  it('normalizes legacy Vietnamese ENTRY_DENIED_NO_SCHEDULE messages to English', () => {
    expect(
      formatNotificationDisplayMessage({
        event: 'ENTRY_DENIED_NO_SCHEDULE',
        message:
          'Bạn chưa được phân công ca làm cho ngày 2026-10-11 tại công trường này nên không được phép vào. Vui lòng liên hệ đại diện nhà thầu.',
        workDate: '2026-10-11',
      }),
    ).toBe(
      'You are not scheduled for a shift on 2026-10-11 at this site and entry is not permitted. Please contact your contractor representative.',
    );
  });

  it('preserves existing English messages', () => {
    expect(
      formatNotificationDisplayMessage({
        event: 'ENTRY_DENIED_NO_SCHEDULE',
        message:
          'You are not scheduled for a shift on 2026-10-11 at this site and entry is not permitted.',
        workDate: '2026-10-11',
      }),
    ).toBe(
      'You are not scheduled for a shift on 2026-10-11 at this site and entry is not permitted.',
    );
  });
});

it('opens a checklist notification in the shared Safety workspace with its Site', () => {
  expect(
    notificationHref({
      id: 'notice',
      event: 'CHECKLIST_RETURNED',
      siteId: 'site/a',
      siteName: 'Synthetic site',
      title: 'Update checklist',
      message: 'Add evidence',
      createdAt: '2026-10-13T01:00:00Z',
      readAt: null,
      target: { siteId: 'site/a', checklistId: 'checklist/a', tab: 'checklists' },
    }),
  ).toBe('/incidents?siteId=site%2Fa&checklistId=checklist%2Fa&tab=checklists');
});

it('preserves authored Safety bodies even when they exactly match known system copy', async () => {
  const message = 'Checklist report recorded';
  await i18n.changeLanguage('vi');
  expect(translate('safety_workspace.checklist_report_recorded')).not.toBe(message);
  for (const event of [
    'SAFETY_HANDOVER',
    'CHECKLIST_ASSIGNED',
    'CHECKLIST_SUBMITTED',
    'CHECKLIST_RETURNED',
    'CHECKLIST_RECORDED',
  ] as const) {
    expect(formatNotificationDisplayMessage({ event, message })).toBe(message);
    expect(
      formatNotificationDisplayMessage({ event, message: '  Ghi chú do người dùng nhập\nα <>&  ' }),
    ).toBe('  Ghi chú do người dùng nhập\nα <>&  ');
  }
  expect(formatNotificationTitle({ event: 'CHECKLIST_RECORDED', title: message })).toBe(
    'Đã ghi nhận báo cáo phiếu kiểm tra',
  );
  await i18n.changeLanguage('en');
  expect(formatNotificationDisplayMessage({ event: 'CHECKLIST_RECORDED', message })).toBe(message);
  expect(formatNotificationTitle({ event: 'CHECKLIST_RECORDED', title: message })).toBe(message);
});
