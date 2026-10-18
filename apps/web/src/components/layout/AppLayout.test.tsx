// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AppLayout } from './AppLayout';
import i18n from '../../i18n';
import userEvent from '@testing-library/user-event';

let roles: string[] = [];
vi.mock('../../features/auth/auth-session', () => ({
  useCurrentUser: () => ({
    data: {
      id: 'synthetic-user',
      username: 'contractor.demo',
      roleAssignments: roles.map((role) => ({
        role,
        siteId: role === 'ADMIN' ? null : 'synthetic-site',
      })),
    },
  }),
  useLogout: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../../features/notifications/NotificationBell', () => ({
  NotificationBell: () => null,
}));

afterEach(cleanup);
beforeEach(async () => {
  await i18n.changeLanguage('en');
});

function navigationFor(userRoles: string[]) {
  roles = userRoles;
  render(
    <MemoryRouter>
      <AppLayout>Content</AppLayout>
    </MemoryRouter>,
  );
  return within(screen.getByRole('navigation', { name: 'Main navigation' }));
}

it.each([
  ['CONTRACTOR_REPRESENTATIVE'],
  ['CONTRACTOR_REPRESENTATIVE', 'WORKER'],
  ['CONTRACTOR_REPRESENTATIVE', 'SITE_MANAGER'],
])('shows the union of contractor workspace permissions for %j', (...userRoles) => {
  const navigation = navigationFor(userRoles);
  expect(navigation.getByRole('button', { name: 'Site Access' })).toBeTruthy();
  expect(navigation.getByRole('button', { name: 'Workforce' })).toBeTruthy();
  expect(navigation.getByRole('button', { name: 'Schedule Setup' })).toBeTruthy();
  expect(navigation.getByRole('button', { name: i18n.t('shell.contractorTeams') })).toBeTruthy();
  expect(navigation.getByRole('button', { name: i18n.t('shell.workerOnboarding') })).toBeTruthy();
  if (!userRoles.includes('SITE_MANAGER')) {
    expect(navigation.queryByRole('button', { name: 'Dashboard' })).toBeNull();
    expect(navigation.queryByRole('button', { name: 'PPE Monitoring' })).toBeNull();
  }
});

it.each(['WORKER', 'SECURITY_OFFICER', 'ADMIN'])(
  'hides contractor team management from a %s-only account',
  (role) => {
    expect(
      navigationFor([role]).queryByRole('button', { name: i18n.t('shell.contractorTeams') }),
    ).toBeNull();
  },
);

it.each([['ADMIN'], ['ADMIN', 'CONTRACTOR_REPRESENTATIVE']])(
  'retains Site Access for Admin roles %j',
  (...userRoles) => {
    expect(navigationFor(userRoles).getByRole('button', { name: 'Site Access' })).toBeTruthy();
  },
);

it.each([['ADMIN'], ['ADMIN', 'SITE_MANAGER']])(
  'shows account management only for global Admin %j',
  (...userRoles) => {
    expect(
      navigationFor(userRoles).getByRole('button', { name: 'Account management' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Choose language' })).toBeTruthy();
  },
);

it('hides workforce and schedule setup for an Admin-only account', () => {
  const navigation = navigationFor(['ADMIN']);
  expect(navigation.queryByRole('button', { name: 'Workforce' })).toBeNull();
  expect(navigation.queryByRole('button', { name: 'Schedule Setup' })).toBeNull();
});

it('retains explicitly assigned Site Manager workspaces for an Admin with that additional role', () => {
  const navigation = navigationFor(['ADMIN', 'SITE_MANAGER']);
  expect(navigation.getByRole('button', { name: 'Workforce' })).toBeTruthy();
  expect(navigation.getByRole('button', { name: 'Schedule Setup' })).toBeTruthy();
});

it.each([
  ['SITE_MANAGER'],
  ['WORKER'],
  ['SECURITY_OFFICER'],
  ['SAFETY_OFFICER'],
  ['CONTRACTOR_REPRESENTATIVE'],
])('hides account management for %j', (...userRoles) => {
  expect(navigationFor(userRoles).queryByRole('button', { name: 'Account management' })).toBeNull();
});

it('switches header and navigation language and persists the choice', async () => {
  navigationFor(['ADMIN']);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Choose language' }));
  await user.click(screen.getByRole('button', { name: 'Tiếng Việt' }));
  expect(screen.getByRole('button', { name: 'Chọn ngôn ngữ' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Quản lý tài khoản' })).toBeTruthy();
  expect(screen.getByRole('navigation', { name: 'Điều hướng chính' })).toBeTruthy();
  expect(localStorage.getItem('smartsite-language')).toBe('vi');
});

it('limits a Security-only account to site access and identifies its role', () => {
  const navigation = navigationFor(['SECURITY_OFFICER']);
  expect(navigation.getAllByRole('button')).toHaveLength(1);
  expect(navigation.getByRole('button', { name: 'Site Access' })).toBeTruthy();
  expect(screen.getByText('Security Officer')).toBeTruthy();
});

it('keeps Safety navigation scoped and opens the password action from main', async () => {
  roles = ['SAFETY_OFFICER'];
  render(
    <MemoryRouter initialEntries={['/incidents']}>
      <AppLayout>
        <Routes>
          <Route path="/incidents" element={<h1>Safety workspace</h1>} />
          <Route path="/account/password" element={<h1>Password form</h1>} />
        </Routes>
      </AppLayout>
    </MemoryRouter>,
  );
  const navigation = within(screen.getByRole('navigation', { name: 'Main navigation' }));
  expect(navigation.getAllByRole('button')).toHaveLength(6);
  for (const name of [
    'Dashboard',
    'Live Monitoring',
    'PPE Monitoring',
    'Restricted Zones',
    'Safety Operations',
    'Worker documents',
  ]) {
    expect(navigation.getByRole('button', { name })).toBeTruthy();
  }
  expect(screen.getByText('Safety Officer')).toBeTruthy();
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: i18n.t('auth.password.title') }));
  expect(screen.getByRole('heading', { name: 'Password form' })).toBeTruthy();
});

it.each(['WORKER', 'CONTRACTOR_REPRESENTATIVE', 'SECURITY_OFFICER'])(
  'hides every safety tab for %s',
  (role) => {
    const navigation = navigationFor([role]);
    for (const name of [
      'Dashboard',
      'Live Monitoring',
      'PPE Monitoring',
      'Restricted Zones',
      'Safety Operations',
    ]) {
      expect(navigation.queryByRole('button', { name })).toBeNull();
    }
    expect(screen.queryByText('Safety', { exact: true })).toBeNull();
  },
);
