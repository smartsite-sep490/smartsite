import { afterEach, expect, it } from 'vitest';
import { setLanguage, translate, uiLocale } from './index';
import {
  localizeMessage,
  localizedLabel,
  notificationMessage,
  notificationTitle,
} from './messages';
import { displayTime, minutes } from '../features/shared/data';

afterEach(async () => {
  await setLanguage('vi');
});
it('translates the missing roll-call review message while preserving Worker identity and work date', async () => {
  await setLanguage('vi');
  const notice = {
    event: 'ZONE_REVIEW_REQUIRED' as const,
    title: 'ZONE REVIEW REQUIRED',
    message:
      'Worker Synthetic Worker (WTEST) has complete Gate IN/OUT on 2026-11-23, but no team leader roll call was recorded. Review recorded hours before confirming attendance.',
  };
  expect(notificationTitle(notice)).toBe(translate('notifications.ZONE_REVIEW_REQUIRED'));
  expect(notificationMessage(notice)).toContain('Synthetic Worker (WTEST)');
  expect(notificationMessage(notice)).toContain('2026-11-23');
  expect(notificationMessage(notice)).not.toContain('no team leader');
});

it('translates a missing Gate review notice without changing the Worker or work date', async () => {
  const notice = {
    event: 'ABSENCE_REVIEW_REQUIRED' as const,
    title: 'Attendance review required',
    message:
      'Worker Synthetic A (WTEST) was marked present on 2030-01-01, but no Gate IN/OUT was recorded. Review attendance before confirming absence.',
  };
  await setLanguage('vi');
  expect(notificationTitle(notice)).toBe(translate('notifications.ABSENCE_REVIEW_REQUIRED'));
  expect(notificationMessage(notice)).toContain('Synthetic A');
  expect(notificationMessage(notice)).toContain('2030-01-01');
  expect(notificationMessage(notice)).not.toContain('was marked present');
});

it('changes stored validation messages, enum labels and time formatting with the selected language', async () => {
  await setLanguage('vi');
  const stored = translate('validation.calendarDate');
  expect(minutes(95)).toBe('1g 35p');
  await setLanguage('en');
  expect(localizeMessage(stored)).toBe(translate('validation.calendarDate'));
  expect(localizedLabel('PENDING')).toBe('Pending');
  expect(uiLocale()).toBe('en-GB');
  expect(minutes(95)).toBe('1h 35m');
  expect(displayTime('2026-10-18T08:00:00Z')).toBe(
    new Date('2026-10-18T08:00:00Z').toLocaleString('en-GB'),
  );
  expect(localizeMessage('Synthetic authored note')).toBe('Synthetic authored note');
});

it.each(['SAFETY_CARD', 'HEALTH_CERTIFICATE', 'PERSONAL_INSURANCE'] as const)(
  'translates %s notification envelopes while preserving names and review notes',
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
      await setLanguage('vi');
      const key = `documentNotifications.${kind}_${event}`;
      const message = translate(key, values);
      const title = translate(`notifications.${event}`);
      await setLanguage('en');
      expect(notificationTitle({ event, title })).toBe(translate(`notifications.${event}`));
      expect(notificationMessage({ event, message })).toBe(translate(key, values));
      expect(notificationMessage({ event, message })).toContain(values.name);
      if (event === 'DOCUMENT_REJECTED')
        expect(notificationMessage({ event, message })).toContain(values.note);
    }
  },
);
