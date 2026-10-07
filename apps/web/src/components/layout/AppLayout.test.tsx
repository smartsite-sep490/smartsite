// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppLayout } from './AppLayout';

let roles: string[] = [];
vi.mock('../../features/auth/auth-session', () => ({
  useCurrentUser: () => ({
    data: {
      id: 'synthetic-user',
      username: 'contractor.demo',
      roleAssignments: roles.map((role) => ({ role, siteId: 'synthetic-site' })),
    },
  }),
  useLogout: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('../../features/notifications/NotificationBell', () => ({
  NotificationBell: () => null,
}));

afterEach(cleanup);

function navigationFor(userRoles: string[]) {
  roles = userRoles;
  render(<MemoryRouter><AppLayout>Content</AppLayout></MemoryRouter>);
  return within(screen.getByRole('navigation', { name: 'Main navigation' }));
}

it.each([
  ['CONTRACTOR_REPRESENTATIVE'],
  ['CONTRACTOR_REPRESENTATIVE', 'WORKER'],
  ['CONTRACTOR_REPRESENTATIVE', 'SITE_MANAGER'],
])('hides Site Access for contractor roles %j while retaining scheduling navigation', (...userRoles) => {
  const navigation = navigationFor(userRoles);
  expect(navigation.queryByRole('button', { name: 'Site Access' })).toBeNull();
  expect(navigation.getByRole('button', { name: 'Contractor Review' })).toBeTruthy();
  expect(navigation.getByRole('button', { name: 'Schedule Setup' })).toBeTruthy();
});

it.each([['ADMIN'], ['ADMIN', 'CONTRACTOR_REPRESENTATIVE']])(
  'retains Site Access for Admin roles %j',
  (...userRoles) => {
    expect(navigationFor(userRoles).getByRole('button', { name: 'Site Access' })).toBeTruthy();
  },
);
