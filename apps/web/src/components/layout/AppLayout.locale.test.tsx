// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { LocaleProvider } from '../../i18n/locale';
import { AppLayout } from './AppLayout';
import i18n from '../../i18n';

const state = vi.hoisted(() => ({ error: false, logout: vi.fn() }));
vi.mock('../../features/auth/auth-session', () => ({
  useLogout: () => ({ mutate: state.logout, isPending: false }),
  useCurrentUser: () => ({
    data: {
      username: 'synthetic-safety',
      roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: 'site-a' }],
    },
    isError: state.error,
  }),
}));
vi.mock('../../features/notifications/NotificationBell', () => ({
  NotificationBell: () => null,
}));

beforeEach(async () => {
  await i18n.changeLanguage('vi');
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  state.error = false;
  state.logout.mockClear();
});

function Shell() {
  return (
    <LocaleProvider>
      <MemoryRouter initialEntries={['/ppe']}>
        <AppLayout>
          <input aria-label="Site draft" defaultValue="site-a" />
        </AppLayout>
      </MemoryRouter>
    </LocaleProvider>
  );
}

describe('localized operational navigation preserves scope and fail-closed access', () => {
  it('changes visible copy without remounting the working draft or invoking logout', async () => {
    const user = userEvent.setup();
    render(<Shell />);
    const draft = screen.getByLabelText('Site draft') as HTMLInputElement;
    await user.clear(draft);
    await user.type(draft, 'site-b-unsaved');
    expect(screen.getByText('Cán bộ an toàn')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Chọn ngôn ngữ' }));
    await user.click(screen.getByRole('button', { name: 'English' }));
    expect(screen.getByText('Safety Officer')).toBeDefined();
    expect(screen.getByRole('button', { name: 'PPE Monitoring' })).toBeDefined();
    expect(screen.getByLabelText('Site draft')).toBe(draft);
    expect(draft.value).toBe('site-b-unsaved');
    expect(state.logout).not.toHaveBeenCalled();
  });

  it('does not expose cached operational navigation after profile failure in either language', async () => {
    const user = userEvent.setup();
    state.error = true;
    render(<Shell />);
    expect(screen.queryByText('Cán bộ an toàn')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Giám sát bảo hộ' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Chọn ngôn ngữ' }));
    await user.click(screen.getByRole('button', { name: 'English' }));
    expect(screen.queryByRole('button', { name: 'PPE Monitoring' })).toBeNull();
    expect(screen.getByText('Access not verified')).toBeDefined();
  });
});
