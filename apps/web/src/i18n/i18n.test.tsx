// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n, { LANGUAGE_STORAGE_KEY, translate as tr, uiLocale } from './index';
import { LanguageSwitcher } from './LanguageSwitcher';
import { localizedLabel } from './labels';
import { localizeMessage, localizedError } from './messages';
import en from './locales/en.json';
import vi from './locales/vi.json';
import { SmartDatePicker } from '../components/ui/SmartFormControls';
import {
  formatNotificationDisplayMessage,
  formatNotificationTitle,
} from '../features/notifications/notification-utils';
import {
  attendanceHours,
  attendanceDate,
} from '../components/access/attendance/attendance-display';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(async () => {
  cleanup();
  await i18n.changeLanguage('en');
});

it('has complete, nonempty catalogs with matching interpolation variables', () => {
  expect(Object.keys(vi).sort()).toEqual(Object.keys(en).sort());
  for (const key of Object.keys(en) as Array<keyof typeof en>) {
    expect(vi[key].trim(), key).not.toBe('');
    const variables = (text: string) => [...text.matchAll(/{{(\w+)}}/g)].map((m) => m[1]).sort();
    expect(variables(vi[key]), key).toEqual(variables(en[key]));
    expect(en[key], key).not.toMatch(/&(?:amp|quot|apos|lt|gt|nbsp);/);
    expect(vi[key], key).not.toMatch(/&(?:amp|quot|apos|lt|gt|nbsp);/);
  }
});

it('switches with keyboard, persists the choice, updates document metadata and keeps a draft', async () => {
  function Draft() {
    useTranslation();
    const [name, setName] = useState('');
    return (
      <>
        <LanguageSwitcher />
        <label>
          {tr('common.full_name')}
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <p>{localizedLabel('CONTRACTOR_REPRESENTATIVE')}</p>
      </>
    );
  }
  render(<Draft />);
  const user = userEvent.setup();
  await user.type(screen.getByRole('textbox'), 'Nguyễn Văn Test');
  screen.getByRole('button', { name: 'Choose language' }).focus();
  await user.keyboard('{Enter}');
  await user.click(screen.getByRole('button', { name: /Tiếng Việt/ }));
  expect(document.documentElement.lang).toBe('vi');
  expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('vi');
  expect(document.title).toBe(vi['app.documentTitle']);
  expect(screen.getByText('Đại diện nhà thầu')).toBeTruthy();
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Nguyễn Văn Test');
  await user.click(screen.getByRole('button', { name: 'Chọn ngôn ngữ' }));
  await user.click(screen.getByRole('button', { name: /English/ }));
  expect(document.documentElement.lang).toBe('en');
  expect(screen.getByText('Contractor representative')).toBeTruthy();
  expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('Nguyễn Văn Test');
});

it.each(['en', 'vi'] as const)(
  'formats plural counts, dates and current system messages in %s',
  async (language) => {
    await i18n.changeLanguage(language);
    expect(tr('counts.members', { count: 2 })).toBe(
      language === 'vi' ? '2 thành viên' : '2 members',
    );
    expect(tr('counts.members', { count: 1 })).toBe(
      language === 'vi' ? '1 thành viên' : '1 member',
    );
    expect(attendanceHours(125)).toBe(language === 'vi' ? '2 giờ 5 phút' : '2h 5m');
    expect(uiLocale()).toBe(language === 'vi' ? 'vi-VN' : 'en-GB');
    expect(attendanceDate(new Date('2026-10-12T18:00:00Z'), 'Asia/Ho_Chi_Minh')).toBe('2026-10-13');
    expect(localizeMessage('Username already exists')).not.toMatch(/^common\./);
    expect(localizedError('Unrecognized server failure')).toBe(
      language === 'vi' ? vi['errors.unexpected'] : 'Unrecognized server failure',
    );
    expect(localizedLabel('PRIVATE_NEW_ENUM')).toBe('PRIVATE_NEW_ENUM');
    const notification = {
      event: 'CHANGE_REQUESTED' as const,
      title: 'Shift change awaiting review',
      message: 'Nguyễn Văn Test requested a change from Day to Night.',
      workDate: '2026-10-13',
    };
    expect(formatNotificationTitle(notification)).toBe(
      language === 'vi' ? 'Đề nghị đổi ca chờ xem xét' : notification.title,
    );
    expect(formatNotificationDisplayMessage(notification)).toBe(
      language === 'vi' ? 'Nguyễn Văn Test đề nghị đổi từ Day sang Night.' : notification.message,
    );
    expect(
      formatNotificationDisplayMessage({
        ...notification,
        event: 'SAFETY_HANDOVER',
        message: 'User authored incident title',
      }),
    ).toBe('User authored incident title');
  },
);

it('changes a calendar locale while retaining the selected ISO date', async () => {
  render(<SmartDatePicker label="Test date" value="2026-10-13" onChange={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Test date' }));
  await i18n.changeLanguage('vi');
  await waitFor(() => expect(document.body.textContent).toContain('Tháng Mười'));
  expect(document.body.textContent).toContain('13/10/2026');
});

it('renders interpolated values as text, keeping markup out of the DOM', () => {
  render(<p>{tr('common.shift_value', { value1: '<img src=x onerror=alert(1)>' })}</p>);
  expect(document.querySelector('img')).toBeNull();
  expect(document.body.textContent).toContain('<img src=x');
});
