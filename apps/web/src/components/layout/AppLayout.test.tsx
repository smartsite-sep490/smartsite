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

it('shows the current workspace and workforce function in the header without global search', async () => {
  roles = ['CONTRACTOR_REPRESENTATIVE', 'WORKER'];
  render(
    <MemoryRouter initialEntries={['/workforce?tab=review']}>
      <AppLayout>Content</AppLayout>
    </MemoryRouter>,
  );
  const header = within(screen.getByRole('banner'));
  expect(header.queryByText('Workforce Operations · Shift Approvals')).toBeNull();
  expect(header.getByRole('heading', { name: 'Contractor Review' })).toBeTruthy();
  expect(header.queryByRole('textbox', { name: 'Search SmartSite' })).toBeNull();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Attendance' }));
  expect(header.getByText('Attendance')).toBeTruthy();
  expect(header.queryByText('Contractor Review')).toBeNull();
});

it('shows Site Operations Configuration in the manager header', () => {
  roles = ['SITE_MANAGER'];
  render(
    <MemoryRouter initialEntries={['/site-setup']}>
      <AppLayout>Content</AppLayout>
    </MemoryRouter>,
  );
  const header = within(screen.getByRole('banner'));
  expect(header.getByRole('heading', { name: 'Site Operations Configuration' })).toBeTruthy();
});

it('renders the complete Schedule Setup heading cluster in the global top header and localizes it', async () => {
  roles = ['SITE_MANAGER'];
  const { rerender } = render(
    <MemoryRouter initialEntries={['/schedule-setup']}>
      <AppLayout>Schedule Content</AppLayout>
    </MemoryRouter>,
  );
  const header = within(screen.getByRole('banner'));
  expect(header.getByRole('heading', { level: 1, name: 'Schedule Setup' })).toBeTruthy();
  expect(header.getByText('Workforce Management')).toBeTruthy();

  // Test Vietnamese localization in the header cluster
  await i18n.changeLanguage('vi');
  rerender(
    <MemoryRouter initialEntries={['/schedule-setup']}>
      <AppLayout>Schedule Content</AppLayout>
    </MemoryRouter>,
  );
  const viHeader = within(screen.getByRole('banner'));
  expect(viHeader.getByRole('heading', { level: 1, name: 'Thiết lập lịch làm việc' })).toBeTruthy();
  expect(viHeader.getByText('Quản lý nhân lực')).toBeTruthy();

  // Revert language back to English
  await i18n.changeLanguage('en');
});

it('keeps the Assigned work page title when opened through a notification link', () => {
  roles = ['CONTRACTOR_REPRESENTATIVE'];
  render(
    <MemoryRouter initialEntries={['/assigned-work?siteId=synthetic-site']}>
      <AppLayout>Assigned work content</AppLayout>
    </MemoryRouter>,
  );
  expect(within(screen.getByRole('banner')).getByText('Assigned work')).toBeTruthy();
  expect(screen.getByText('Assigned work content')).toBeTruthy();
});

it('uses the role-appropriate workforce default', () => {
  roles = ['CONTRACTOR_REPRESENTATIVE'];
  render(
    <MemoryRouter initialEntries={['/workforce']}>
      <AppLayout>Content</AppLayout>
    </MemoryRouter>,
  );
  expect(within(screen.getByRole('banner')).getByText('Contractor Review')).toBeTruthy();
});

it.each(['en', 'vi'])('shows the worker schedule title once in the %s header', async (language) => {
  await i18n.changeLanguage(language);
  roles = ['WORKER'];
  render(
    <MemoryRouter initialEntries={['/workforce?tab=schedule']}>
      <AppLayout>Content</AppLayout>
    </MemoryRouter>,
  );
  const header = within(screen.getByRole('banner'));
  expect(header.getAllByText(i18n.t('app_layout.my_schedule_requests'))).toHaveLength(1);
  expect(
    header.getByRole('heading', { level: 1, name: i18n.t('app_layout.my_schedule_requests') }),
  ).toBeTruthy();
});

it.each([
  ['/dashboard', 'SITE_MANAGER', 'common.site_management_overview'],
  ['/accounts', 'ADMIN', 'accounts.title'],
  ['/contractor-teams', 'CONTRACTOR_REPRESENTATIVE', 'shell.contractorTeams'],
  ['/worker-onboarding', 'CONTRACTOR_REPRESENTATIVE', 'shell.workerOnboarding'],
  ['/worker-documents', 'WORKER', 'documents.title'],
  ['/workforce?tab=schedule', 'WORKER', 'app_layout.my_schedule_requests'],
  ['/workforce?tab=review', 'CONTRACTOR_REPRESENTATIVE', 'common.contractor_review'],
  ['/site-setup', 'ADMIN', 'shell.siteSetup'],
  ['/site-setup', 'SITE_MANAGER', 'siteOps.titleManage'],
  ['/schedule-setup', 'SITE_MANAGER', 'common.schedule_setup'],
  ['/access', 'SITE_MANAGER', 'access.tabs.attendance.label'],
  ['/access', 'SECURITY_OFFICER', 'shell.access'],
  ['/live-monitoring', 'SAFETY_OFFICER', 'shell.live'],
  ['/camera-setup', 'SITE_MANAGER', 'shell.cameraSetup'],
  ['/ppe', 'SAFETY_OFFICER', 'shell.ppe'],
  ['/zones', 'SAFETY_OFFICER', 'shell.zones'],
  ['/incidents', 'SAFETY_OFFICER', 'shell.incidents'],
  ['/assigned-work', 'CONTRACTOR_REPRESENTATIVE', 'shell.assignedWork'],
  ['/account/password', 'WORKER', 'auth.password.title'],
])(
  'renders a uniform header with a decorative function icon at %s for %s',
  (path, role, titleKey) => {
    roles = [role];
    render(
      <MemoryRouter initialEntries={[path]}>
        <AppLayout>Content</AppLayout>
      </MemoryRouter>,
    );
    const header = within(screen.getByRole('banner'));
    expect(header.getByText(i18n.t(titleKey))).toBeTruthy();
    const icon = header.getByTestId('workspace-header-icon');
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(icon.querySelector('svg')).toBeTruthy();
  },
);

it.each([
  ['CONTRACTOR_REPRESENTATIVE'],
  ['CONTRACTOR_REPRESENTATIVE', 'WORKER'],
  ['CONTRACTOR_REPRESENTATIVE', 'SITE_MANAGER'],
])('shows the union of contractor workspace permissions for %j', (...userRoles) => {
  const navigation = navigationFor(userRoles);
  expect(navigation.getByRole('button', { name: 'Attendance' })).toBeTruthy();
  expect(navigation.getByRole('button', { name: 'Workforce' })).toBeTruthy();
  expect(navigation.getByRole('button', { name: 'Schedule Setup' })).toBeTruthy();
  expect(navigation.getByRole('button', { name: 'Assigned work' })).toBeTruthy();
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

it('gives pure Admin only management navigation and mixed representative its attendance workspace', () => {
  const adminNav = navigationFor(['ADMIN']);
  expect(adminNav.queryByRole('button', { name: 'Site Access' })).toBeNull();
  cleanup();
  expect(
    navigationFor(['ADMIN', 'CONTRACTOR_REPRESENTATIVE']).getByRole('button', {
      name: 'Attendance',
    }),
  ).toBeTruthy();
});

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

it('does not show My Overview in Worker navigation', () => {
  const navigation = navigationFor(['WORKER']);
  expect(navigation.queryByRole('button', { name: i18n.t('shell.workerSummary') })).toBeNull();
  expect(navigation.getByRole('button', { name: i18n.t('shell.mySchedule') })).toBeTruthy();
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

it('shows Safety operation submenus with a selected route instead of duplicate top-level pages', () => {
  roles = ['SAFETY_OFFICER'];
  render(
    <MemoryRouter initialEntries={['/incidents?tab=incidents&siteId=synthetic-site']}>
      <AppLayout>Safety content</AppLayout>
    </MemoryRouter>,
  );
  const nav = within(screen.getByRole('navigation', { name: 'Main navigation' }));
  expect(nav.getByRole('link', { name: 'Incidents' }).getAttribute('aria-current')).toBe('page');
  expect(nav.getByRole('link', { name: 'Alerts' }).getAttribute('href')).toContain('tab=alerts');
  expect(nav.getByRole('link', { name: 'Checklists' })).toBeTruthy();
  expect(nav.getByRole('link', { name: 'Safety tasks' })).toBeTruthy();
});
