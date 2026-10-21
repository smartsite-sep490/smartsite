import { afterEach, describe, expect, it } from 'vitest';
import i18n, { translate } from '../../i18n';
import type { PpeAlertNotificationMetadata, UserNotificationResponse } from '@smartsite/api-client';
import {
  notificationHref,
  formatNotificationDisplayMessage,
  formatNotificationTitle,
} from './notification-utils';

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('notification-utils', () => {
  it.each(['SAFETY_CARD', 'HEALTH_CERTIFICATE', 'PERSONAL_INSURANCE'] as const)(
    'translates %s notification text without changing authored values',
    async (kind) => {
      const values = {
        name: 'Nguyễn Văn Test',
        code: 'W001',
        note: 'Giữ nguyên Approved & 012345678901',
        date: '2026-10-18',
      };
      for (const event of [
        'DOCUMENT_SUBMITTED',
        'DOCUMENT_APPROVED',
        'DOCUMENT_REJECTED',
        'DOCUMENT_EXPIRING',
        'DOCUMENT_EXPIRED',
      ] as const) {
        await i18n.changeLanguage('vi');
        const key = `documentNotifications.${kind}_${event}`;
        const message = translate(key, values),
          title = translate(`notifications.${event}`);
        await i18n.changeLanguage('en');
        expect(formatNotificationTitle({ event, title })).toBe(translate(`notifications.${event}`));
        expect(formatNotificationDisplayMessage({ event, message })).toBe(translate(key, values));
        expect(formatNotificationDisplayMessage({ event, message })).toContain(values.name);
        if (event === 'DOCUMENT_REJECTED')
          expect(formatNotificationDisplayMessage({ event, message })).toContain(values.note);
      }
    },
  );
  it('identifies the worker missing checkout in both languages without translating their name', async () => {
    const item = {
      event: 'MISSING_CHECKOUT' as const,
      message:
        'Worker Nguyễn An (W000001) is missing checkout for the shift on 2026-10-16. The shift ended more than five minutes ago. Hours remain provisional.',
    };
    await i18n.changeLanguage('vi');
    expect(formatNotificationDisplayMessage(item)).toBe(
      'Công nhân Nguyễn An (W000001) thiếu lượt check-out cho ca ngày 2026-10-16. Ca đã kết thúc hơn năm phút. Giờ làm hiện là tạm tính.',
    );
    await i18n.changeLanguage('en');
    expect(formatNotificationDisplayMessage(item)).toBe(item.message);
  });

  it('translates the exit-policy reminder from the server and preserves configured limits', async () => {
    const item = {
      event: 'EARLY_EXIT' as const,
      message:
        'You left the site before the shift ended. Temporary exits allow 15 minutes without deduction for up to 2 exits. Excess time is deducted; exits beyond the limit and final early departure are deducted in full.',
    };
    await i18n.changeLanguage('vi');
    expect(formatNotificationDisplayMessage(item)).toBe(
      'Bạn đã rời công trường trước khi hết ca. Mỗi lượt ra ngoài được miễn trừ 15 phút, tối đa 2 lượt. Phần vượt thời gian sẽ bị trừ; lượt vượt số lần cho phép và thời gian về sớm được trừ toàn bộ.',
    );
    expect(formatNotificationTitle({ event: item.event, title: 'EARLY EXIT' })).toBe('Ra sớm');
    await i18n.changeLanguage('en');
    expect(formatNotificationDisplayMessage(item)).toBe(item.message);
    expect(formatNotificationTitle({ event: item.event, title: 'EARLY EXIT' })).toBe('Early exit');
  });

  it.each([
    ['EXIT_DURATION_EXCEEDED', 'Ra ngoài quá thời gian cho phép', 'Exit time limit exceeded'],
    ['MAX_EXITS_EXCEEDED', 'Vượt số lần ra ngoài cho phép', 'Exit count limit exceeded'],
  ] as const)(
    'translates the %s title even for stored raw event codes',
    async (event, vietnamese, english) => {
      await i18n.changeLanguage('vi');
      expect(formatNotificationTitle({ event, title: event.replaceAll('_', ' ') })).toBe(
        vietnamese,
      );
      await i18n.changeLanguage('en');
      expect(formatNotificationTitle({ event, title: event })).toBe(english);
    },
  );

  it('translates stored violations without displaying transient duration details', async () => {
    const duration = {
      event: 'EXIT_DURATION_EXCEEDED' as const,
      message:
        'Công nhân Nguyễn An ra ngoài quá thời gian cho phép (15 phút) trong ca làm việc ngày 2026-10-16. Phần vượt quá đã bị trừ vào giờ làm. Lượt ra ngoài thứ 1, thời gian ngoài giờ nghỉ: 25 phút; thời gian bị trừ tính đến lần kiểm tra này: 10 phút.',
    };
    const count = {
      event: 'MAX_EXITS_EXCEEDED' as const,
      message:
        'Công nhân Nguyễn An đã vượt quá số lần ra ngoài cho phép (0 lần) trong ca làm việc ngày 2026-10-16. Toàn bộ thời gian ra ngoài này đã bị trừ vào giờ làm. Lượt ra ngoài thứ 1, thời gian ngoài giờ nghỉ: 10 phút; thời gian bị trừ tính đến lần kiểm tra này: 10 phút.',
    };
    expect(formatNotificationDisplayMessage(duration)).toBe(
      'Worker Nguyễn An exceeded the allowed exit time (15 minutes) during the shift on 2026-10-16. The excess time has been deducted from working hours.',
    );
    expect(formatNotificationDisplayMessage(count)).toBe(
      'Worker Nguyễn An exceeded the allowed exit count (0 exits) during the shift on 2026-10-16. The full duration of this exit has been deducted from working hours.',
    );
    await i18n.changeLanguage('vi');
    expect(formatNotificationDisplayMessage(duration)).toBe(
      duration.message.split(' Lượt ra ngoài thứ')[0],
    );
    expect(formatNotificationDisplayMessage(count)).toBe(
      count.message.split(' Lượt ra ngoài thứ')[0],
    );
  });

  it('hides a legacy zero-minute snapshot in both languages, including an English stored body', async () => {
    const message =
      'Worker An exceeded the allowed exit count (2 exits) during the shift on 2026-10-16. The full duration of this exit has been deducted from working hours.';
    const item = {
      event: 'MAX_EXITS_EXCEEDED' as const,
      message:
        message +
        ' Exit 3, time outside excluding breaks: 0 minutes; time deducted as of this check: 0 minutes.',
    };
    expect(formatNotificationDisplayMessage(item)).toBe(message);
    await i18n.changeLanguage('vi');
    expect(formatNotificationDisplayMessage(item)).toBe(
      'Công nhân An đã vượt quá số lần ra ngoài cho phép (2 lần) trong ca làm việc ngày 2026-10-16. Toàn bộ thời gian ra ngoài này đã bị trừ vào giờ làm.',
    );
  });

  it('translates older violation notices without detail suffixes', async () => {
    expect(
      formatNotificationDisplayMessage({
        event: 'MAX_EXITS_EXCEEDED',
        message:
          'Công nhân An đã vượt quá số lần ra ngoài cho phép (2 lần) trong ca làm việc ngày 2026-10-16. Toàn bộ thời gian ra ngoài này đã bị trừ vào giờ làm.',
      }),
    ).toBe(
      'Worker An exceeded the allowed exit count (2 exits) during the shift on 2026-10-16. The full duration of this exit has been deducted from working hours.',
    );
  });

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

it('opens a document notification in the worker documents view with its Site and Worker ID', () => {
  expect(
    notificationHref({
      id: 'notice',
      event: 'DOCUMENT_EXPIRING',
      siteId: 'site-a',
      siteName: 'Synthetic site',
      title: 'Giấy tờ sắp hết hạn',
      message: 'Worker A - Thẻ an toàn lao động nhóm 3 sắp hết hạn',
      createdAt: '2026-10-17T00:00:00Z',
      readAt: null,
      target: { siteId: 'site-a', workerId: 'worker-1', tab: 'documents' },
    }),
  ).toBe('/worker-documents?siteId=site-a&workerId=worker-1&tab=documents');
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

it('switches generated time-request notices both ways without translating authored names and reasons', async () => {
  const name = 'Shift change awaiting review';
  const reason = 'Checklist report recorded\n<keep this reason>';
  const request = {
    event: 'TIME_REQUESTED' as const,
    message: `${name} requested overtime: ${reason}`,
  };
  const review = {
    event: 'TIME_REJECTED' as const,
    message: `Attendance correction rejected: ${reason}`,
  };
  await i18n.changeLanguage('vi');
  expect(formatNotificationDisplayMessage(request)).toBe(`${name} gửi yêu cầu tăng ca: ${reason}`);
  expect(formatNotificationDisplayMessage(review)).toBe(`Sửa công: Bị từ chối Lý do: ${reason}`);
  expect(
    formatNotificationDisplayMessage({
      event: 'TIME_APPROVED',
      message: `Duplicate IN ignored: ${reason}`,
    }),
  ).toBe(`Đã loại lượt vào trùng: ${reason}`);
  expect(formatNotificationTitle({ event: 'TIME_REQUESTED', title: 'TIME REQUESTED' })).toBe(
    translate('notifications.TIME_REQUESTED'),
  );
  await i18n.changeLanguage('en');
  expect(formatNotificationDisplayMessage(request)).toBe(request.message);
  expect(formatNotificationDisplayMessage(review)).toBe(
    `Attendance correction: Rejected Reason: ${reason}`,
  );
  expect(formatNotificationTitle({ event: 'TIME_REQUESTED', title: 'TIME REQUESTED' })).toBe(
    'Time request',
  );
});

it.each([
  ['PPE_HARD_HAT_MISSING', 'Possible missing hard hat', 'Dấu hiệu thiếu mũ bảo hộ'],
  ['PPE_SAFETY_VEST_MISSING', 'Possible missing safety vest', 'Dấu hiệu thiếu áo phản quang'],
  ['PPE_GLOVES_MISSING', 'Possible missing safety gloves', 'Dấu hiệu thiếu găng tay bảo hộ'],
  ['PPE_BOOTS_MISSING', 'Possible missing safety boots', 'Dấu hiệu thiếu giày bảo hộ'],
  ['PPE_GOGGLES_MISSING', 'Possible missing safety goggles', 'Dấu hiệu thiếu kính bảo hộ'],
] as const)(
  'formats PPE_ALERT_CREATED notifications for %s in English and Vietnamese',
  async (candidateSubtype, enSubtype, viSubtype) => {
    const item = {
      event: 'PPE_ALERT_CREATED' as const,
      title: 'PPE_ALERT_CREATED',
      message: 'Stored fallback message',
      safetyAlert: {
        cameraId: '11111111-1111-4111-8111-111111111111',
        cameraName: 'Gate Camera 01',
        zoneId: '22222222-2222-4222-8222-222222222222',
        zoneName: 'Excavation North',
        candidateSubtype,
      },
    };

    await i18n.changeLanguage('en');
    expect(formatNotificationTitle(item)).toBe('PPE alert requires review');
    expect(formatNotificationDisplayMessage(item)).toBe(
      `Gate Camera 01 · Excavation North: ${enSubtype}. Review the evidence.`,
    );

    await i18n.changeLanguage('vi');
    expect(formatNotificationTitle({ event: item.event, title: 'PPE alert requires review' })).toBe(
      'Cảnh báo PPE cần xem xét',
    );
    expect(formatNotificationDisplayMessage(item)).toBe(
      `Gate Camera 01 · Excavation North: ${viSubtype}. Vui lòng xem xét bằng chứng.`,
    );
  },
);

it('uses noZone copy when PPE alert zoneName is absent and neutral fallback when safetyAlert metadata is missing', async () => {
  const withoutZone = {
    event: 'PPE_ALERT_CREATED' as const,
    message: 'Stored fallback message',
    safetyAlert: {
      cameraId: '11111111-1111-4111-8111-111111111111',
      cameraName: 'Cam West 02',
      zoneId: null,
      zoneName: null,
      candidateSubtype: 'PPE_GLOVES_MISSING' as const,
    },
  };
  const withoutMetadata = {
    event: 'PPE_ALERT_CREATED' as const,
    message: 'Unstructured fallback text',
  };
  const malformedSubtype = {
    event: 'PPE_ALERT_CREATED' as const,
    message: 'Unstructured fallback text',
    safetyAlert: {
      cameraId: '11111111-1111-4111-8111-111111111111',
      cameraName: 'Cam West 02',
      zoneId: null,
      zoneName: null,
      candidateSubtype: 'body' as PpeAlertNotificationMetadata['candidateSubtype'],
    },
  };

  await i18n.changeLanguage('en');
  expect(formatNotificationDisplayMessage(withoutZone)).toBe(
    'Cam West 02 · Unspecified Zone: Possible missing safety gloves. Review the evidence.',
  );
  expect(formatNotificationDisplayMessage(withoutMetadata)).toBe('PPE alert requires review');
  expect(formatNotificationDisplayMessage(malformedSubtype)).toBe('PPE alert requires review');

  await i18n.changeLanguage('vi');
  expect(formatNotificationDisplayMessage(withoutZone)).toBe(
    'Cam West 02 · Chưa xác định Zone: Dấu hiệu thiếu găng tay bảo hộ. Vui lòng xem xét bằng chứng.',
  );
  expect(formatNotificationDisplayMessage(withoutMetadata)).toBe('Cảnh báo PPE cần xem xét');
  expect(formatNotificationDisplayMessage(malformedSubtype)).toBe('Cảnh báo PPE cần xem xét');
});

it('routes alertId notification targets to /incidents regardless of assignedWork while preserving existing routes', () => {
  const ppeAlertNotification: UserNotificationResponse = {
    id: 'notice-ppe-1',
    event: 'PPE_ALERT_CREATED',
    siteId: 'site/a',
    siteName: 'Synthetic site',
    title: 'PPE alert requires review',
    message:
      'Gate Camera 01 · Excavation North: Possible missing safety boots. Review the evidence.',
    safetyAlert: {
      cameraId: '11111111-1111-4111-8111-111111111111',
      cameraName: 'Gate Camera 01',
      zoneId: '22222222-2222-4222-8222-222222222222',
      zoneName: 'Excavation North',
      candidateSubtype: 'PPE_BOOTS_MISSING',
    },
    createdAt: '2026-10-21T01:00:00Z',
    readAt: null,
    target: { siteId: 'site/a', alertId: 'alert/1', tab: 'alerts' },
  };
  expect(notificationHref(ppeAlertNotification, false)).toBe(
    '/incidents?siteId=site%2Fa&alertId=alert%2F1&tab=alerts',
  );
  expect(notificationHref(ppeAlertNotification, true)).toBe(
    '/incidents?siteId=site%2Fa&alertId=alert%2F1&tab=alerts',
  );

  const checklistNotification: UserNotificationResponse = {
    id: 'notice-checklist-1',
    event: 'CHECKLIST_ASSIGNED',
    siteId: 'site-a',
    siteName: 'Synthetic site',
    title: 'Checklist assigned',
    message: 'Inspect scaffolding',
    createdAt: '2026-10-21T01:00:00Z',
    readAt: null,
    target: { siteId: 'site-a', checklistId: 'checklist-1', tab: 'checklists' },
  };
  expect(notificationHref(checklistNotification, false)).toBe(
    '/incidents?siteId=site-a&checklistId=checklist-1&tab=checklists',
  );
  expect(notificationHref(checklistNotification, true)).toBe(
    '/assigned-work?siteId=site-a&checklistId=checklist-1&tab=checklists',
  );
});
