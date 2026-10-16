// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SessionExpiredModal } from './auth-session';
import i18n from '../../i18n';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});
afterEach(async () => {
  cleanup();
  await i18n.changeLanguage('en');
});

it('announces an expired-session dialog and moves focus to its sign-in action', () => {
  render(<SessionExpiredModal open onReLogin={vi.fn()} />);
  const dialog = screen.getByRole('alertdialog', { name: 'Your session has expired' });
  expect(dialog.getAttribute('aria-modal')).toBe('true');
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Sign in again' }));
});

it('keeps keyboard focus in the expired-session dialog until sign-in is chosen', async () => {
  const action = vi.fn();
  render(
    <>
      <button>Background control</button>
      <SessionExpiredModal open onReLogin={action} />
    </>,
  );
  const user = userEvent.setup();
  const signIn = screen.getByRole('button', { name: 'Sign in again' });
  signIn.focus();
  await user.tab();
  expect(document.activeElement).toBe(signIn);
  await user.tab({ shift: true });
  expect(document.activeElement).toBe(signIn);
  await user.keyboard('{Enter}');
  expect(action).toHaveBeenCalledTimes(1);
});

it('restores prior focus when closed and removes its keyboard listener', async () => {
  const view = render(
    <>
      <button>Background control</button>
      <SessionExpiredModal open={false} onReLogin={vi.fn()} />
    </>,
  );
  const background = screen.getByRole('button', { name: 'Background control' });
  background.focus();
  view.rerender(
    <>
      <button>Background control</button>
      <SessionExpiredModal open onReLogin={vi.fn()} />
    </>,
  );
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Sign in again' }));
  view.rerender(
    <>
      <button>Background control</button>
      <SessionExpiredModal open={false} onReLogin={vi.fn()} />
    </>,
  );
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(document.activeElement).toBe(background);
  await userEvent.setup().tab();
  expect(document.activeElement).not.toBe(background);
});

it('retranslates the open expired-session dialog without replacing its focused action', async () => {
  const action = vi.fn();
  render(<SessionExpiredModal open onReLogin={action} />);
  const signIn = screen.getByRole('button', { name: 'Sign in again' });
  expect(document.activeElement).toBe(signIn);
  await act(async () => {
    await i18n.changeLanguage('vi');
  });
  expect(screen.getByRole('alertdialog', { name: 'Phiên đăng nhập đã hết hạn' })).toBeTruthy();
  expect(document.activeElement).toBe(signIn);
  expect(screen.getByRole('button', { name: 'Đăng nhập lại' })).toBe(signIn);
  await userEvent.setup().keyboard('{Enter}');
  expect(action).toHaveBeenCalledOnce();
});
