// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import i18n from '../../i18n';
import { AppLayout } from './AppLayout';

interface MockProfile {
  id: string;
  username: string;
  mustChangePassword?: boolean;
  roleAssignments: { role: string; siteId: string | null }[];
}

interface NotificationBellProbeProps {
  apiUrl: string;
  userId: string;
  enabled?: boolean;
  assignedWork?: boolean;
}

function createDefaultProfile(): MockProfile {
  return {
    id: 'user-safety-1',
    username: 'safety-officer',
    mustChangePassword: false,
    roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: 'site-a' }],
  };
}

const profileState = vi.hoisted(() => ({
  data: {
    id: 'user-safety-1',
    username: 'safety-officer',
    mustChangePassword: false,
    roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: 'site-a' }],
  } as MockProfile | undefined,
  isError: false,
  isPending: false,
}));

const bellState = vi.hoisted(() => ({
  lastProps: null as NotificationBellProbeProps | null,
  renders: [] as NotificationBellProbeProps[],
}));

vi.mock('../../features/auth/auth-session', () => ({
  useLogout: () => ({ mutate: vi.fn(), isPending: false }),
  useCurrentUser: () => profileState,
}));

vi.mock('../../features/notifications/NotificationBell', () => ({
  NotificationBell: (props: NotificationBellProbeProps) => {
    const snapshot: NotificationBellProbeProps = {
      apiUrl: props.apiUrl,
      userId: props.userId,
      enabled: Boolean(props.enabled),
      assignedWork: props.assignedWork,
    };
    bellState.lastProps = snapshot;
    bellState.renders.push(snapshot);
    return (
      <div
        data-testid="notification-bell-probe"
        data-api-url={props.apiUrl}
        data-user-id={props.userId}
        data-enabled={String(Boolean(props.enabled))}
      />
    );
  },
}));

async function resetLanguageAndStorage() {
  await act(async () => {
    await i18n.changeLanguage('en');
  });
  localStorage.clear();
  sessionStorage.clear();
}

beforeEach(async () => {
  await resetLanguageAndStorage();
  profileState.data = createDefaultProfile();
  profileState.isError = false;
  profileState.isPending = false;
  bellState.lastProps = null;
  bellState.renders = [];
});

afterEach(async () => {
  cleanup();
  await resetLanguageAndStorage();
  profileState.data = createDefaultProfile();
  profileState.isError = false;
  profileState.isPending = false;
  bellState.lastProps = null;
  bellState.renders = [];
});

function navigationFor(
  userRoles: string[],
  options?: { id?: string; username?: string; mustChangePassword?: boolean },
) {
  profileState.data = {
    id: options?.id ?? 'synthetic-user',
    username: options?.username ?? 'contractor.demo',
    mustChangePassword: options?.mustChangePassword ?? false,
    roleAssignments: userRoles.map((role) => ({
      role,
      siteId: role === 'ADMIN' ? null : 'synthetic-site',
    })),
  };
  profileState.isError = false;
  profileState.isPending = false;
  render(
    <MemoryRouter>
      <AppLayout>Content</AppLayout>
    </MemoryRouter>,
  );
  return within(screen.getByRole('navigation', { name: 'Main navigation' }));
}

it.each([
  [['CONTRACTOR_REPRESENTATIVE'], true],
  [['CONTRACTOR_REPRESENTATIVE', 'SAFETY_OFFICER'], false],
  [['SAFETY_OFFICER'], false],
])('routes notifications using actual workspace capabilities for %j', (roles, assignedWork) => {
  navigationFor(roles as string[]);
  expect(bellState.lastProps?.assignedWork).toBe(assignedWork);
});

describe('Operations navigation accessibility', () => {
  it('removes cached identity and operational navigation after profile failure, and restores only after recovery', () => {
    const app = (
      <MemoryRouter initialEntries={['/ppe']}>
        <AppLayout>
          <h1>Profile recovery</h1>
        </AppLayout>
      </MemoryRouter>
    );
    const result = render(app);
    expect(screen.getByRole('button', { name: 'PPE Monitoring' })).toBeDefined();
    expect(screen.getByTestId('notification-bell-probe').getAttribute('data-user-id')).toBe(
      'user-safety-1',
    );
    expect(screen.getByTestId('notification-bell-probe').getAttribute('data-enabled')).toBe('true');
    expect(bellState.lastProps).toMatchObject({ userId: 'user-safety-1', enabled: true });

    // Cached profile remains in profileState.data while isError becomes true
    profileState.isError = true;
    result.rerender(
      <MemoryRouter initialEntries={['/ppe']}>
        <AppLayout>
          <h1>Profile recovery</h1>
        </AppLayout>
      </MemoryRouter>,
    );
    expect(screen.queryByText('safety-officer')).toBeNull();
    expect(screen.queryByText('Safety Officer')).toBeNull();
    expect(screen.queryByRole('button', { name: 'PPE Monitoring' })).toBeNull();
    expect(screen.getByText('Access not verified')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Logout' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Public SmartSite Homepage' })).toBeDefined();
    expect(screen.getByTestId('notification-bell-probe').getAttribute('data-user-id')).toBe('');
    expect(screen.getByTestId('notification-bell-probe').getAttribute('data-enabled')).toBe(
      'false',
    );
    expect(bellState.lastProps).toMatchObject({ userId: '', enabled: false });

    // Same-user recovery
    profileState.isError = false;
    result.rerender(
      <MemoryRouter initialEntries={['/ppe']}>
        <AppLayout>
          <h1>Profile recovery</h1>
        </AppLayout>
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'PPE Monitoring' })).toBeDefined();
    expect(screen.getByText('Safety Officer')).toBeDefined();
    expect(screen.getByTestId('notification-bell-probe').getAttribute('data-user-id')).toBe(
      'user-safety-1',
    );
    expect(screen.getByTestId('notification-bell-probe').getAttribute('data-enabled')).toBe('true');
    expect(bellState.lastProps).toMatchObject({ userId: 'user-safety-1', enabled: true });
  });

  it('does not present unverified access or operational navigation before a profile is available', () => {
    profileState.data = undefined;
    profileState.isPending = true;
    render(
      <MemoryRouter initialEntries={['/ppe']}>
        <AppLayout>
          <h1>Loading profile</h1>
        </AppLayout>
      </MemoryRouter>,
    );
    expect(screen.getByText('Access not verified')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'PPE Monitoring' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Logout' })).toBeDefined();
    expect(screen.getByTestId('notification-bell-probe').getAttribute('data-user-id')).toBe('');
    expect(screen.getByTestId('notification-bell-probe').getAttribute('data-enabled')).toBe(
      'false',
    );
    expect(bellState.lastProps).toMatchObject({ userId: '', enabled: false });
  });

  it('lets keyboard users skip the navigation and reach the current page', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/ppe']}>
        <AppLayout>
          <h1>PPE monitoring</h1>
        </AppLayout>
      </MemoryRouter>,
    );
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Skip to main content' }));
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(screen.getByRole('main'));
    expect(screen.getByText('Safety Officer')).toBeDefined();
  });

  it('keeps navigation controls named and the current route identified after collapsing the rail', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/ppe']}>
        <AppLayout>
          <h1>PPE monitoring</h1>
        </AppLayout>
      </MemoryRouter>,
    );
    const current = document.querySelector<HTMLButtonElement>('[aria-current="page"]');
    expect(current?.getAttribute('aria-label')).toBeTruthy();
    expect(current?.getAttribute('title')).toBe(current?.getAttribute('aria-label'));
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(document.querySelector('[aria-current="page"]')?.getAttribute('aria-label')).toBe(
      current?.getAttribute('aria-label'),
    );
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Logout' })).toBeDefined();
  });
});

describe('Role-specific navigation and NotificationBell integration', () => {
  it.each([
    ['CONTRACTOR_REPRESENTATIVE'],
    ['CONTRACTOR_REPRESENTATIVE', 'WORKER'],
    ['CONTRACTOR_REPRESENTATIVE', 'SITE_MANAGER'],
  ])('unions contractor workspaces and Site Access for roles %j', (...userRoles) => {
    const navigation = navigationFor(userRoles);
    expect(navigation.getByRole('button', { name: 'Site Access' })).toBeTruthy();
    expect(navigation.getByRole('button', { name: 'Worker teams' })).toBeTruthy();
    expect(navigation.getByRole('button', { name: 'Schedule Setup' })).toBeTruthy();
    expect(navigation.getByRole('button', { name: 'Worker profiles & accounts' })).toBeTruthy();
    expect(navigation.getByRole('button', { name: 'Workforce' })).toBeTruthy();
    expect(bellState.lastProps).toMatchObject({ userId: 'synthetic-user', enabled: true });
  });

  it.each([['ADMIN'], ['ADMIN', 'CONTRACTOR_REPRESENTATIVE']])(
    'retains Site Access for Admin roles %j',
    (...userRoles) => {
      const navigation = navigationFor(userRoles);
      expect(navigation.getByRole('button', { name: 'Site Access' })).toBeTruthy();
      expect(navigation.getByRole('button', { name: 'Site Setup' })).toBeTruthy();
      expect(
        Boolean(navigation.queryByRole('button', { name: 'Worker profiles & accounts' })),
      ).toBe(userRoles.includes('CONTRACTOR_REPRESENTATIVE'));
      expect(Boolean(navigation.queryByRole('button', { name: 'Workforce' }))).toBe(
        userRoles.includes('CONTRACTOR_REPRESENTATIVE'),
      );
      expect(bellState.lastProps).toMatchObject({ userId: 'synthetic-user', enabled: true });
    },
  );

  it('Site Manager sees Main setup, workforce and Site Access without Contractor onboarding', () => {
    const navigation = navigationFor(['SITE_MANAGER']);
    expect(navigation.getByRole('button', { name: 'Site Setup' })).toBeTruthy();
    expect(navigation.getByRole('button', { name: 'Schedule Setup' })).toBeTruthy();
    expect(navigation.getByRole('button', { name: 'Site Access' })).toBeTruthy();
    expect(navigation.getByRole('button', { name: 'Workforce' })).toBeTruthy();
    expect(navigation.getByRole('button', { name: 'Camera setup' })).toBeTruthy();
    expect(navigation.queryByRole('button', { name: 'Worker profiles & accounts' })).toBeNull();
    expect(bellState.lastProps).toMatchObject({ userId: 'synthetic-user', enabled: true });
  });

  it('Contractor Representative retains Main Workforce workspace', () => {
    expect(
      navigationFor(['CONTRACTOR_REPRESENTATIVE']).getByRole('button', {
        name: 'Workforce',
      }),
    ).toBeTruthy();
  });

  it('Worker-only account sees My overview, My Schedule & Requests and My QR Pass, and disables NotificationBell when mustChangePassword is true', () => {
    profileState.data = {
      id: 'worker-user-1',
      username: 'worker.demo',
      mustChangePassword: false,
      roleAssignments: [{ role: 'WORKER', siteId: 'site-a' }],
    };
    const result = render(
      <MemoryRouter initialEntries={['/workforce']}>
        <AppLayout>Worker content</AppLayout>
      </MemoryRouter>,
    );
    const navigation = within(screen.getByRole('navigation', { name: 'Main navigation' }));
    expect(navigation.getByRole('button', { name: 'My Schedule & Requests' })).toBeTruthy();
    expect(navigation.getByRole('button', { name: 'My QR Pass' })).toBeTruthy();
    expect(navigation.getByRole('button', { name: 'My overview' })).toBeTruthy();
    expect(navigation.queryByRole('button', { name: 'Dashboard' })).toBeNull();
    expect(navigation.queryByRole('button', { name: 'Site Access' })).toBeNull();
    expect(navigation.queryByRole('button', { name: 'PPE Monitoring' })).toBeNull();
    expect(navigation.queryByRole('button', { name: 'Safety Operations' })).toBeNull();
    expect(navigation.queryByRole('button', { name: 'Safety Alerts' })).toBeNull();
    expect(bellState.lastProps).toMatchObject({ userId: 'worker-user-1', enabled: true });

    profileState.data = {
      ...profileState.data,
      mustChangePassword: true,
    };
    result.rerender(
      <MemoryRouter initialEntries={['/workforce']}>
        <AppLayout>Worker content</AppLayout>
      </MemoryRouter>,
    );
    expect(screen.getByTestId('notification-bell-probe').getAttribute('data-user-id')).toBe(
      'worker-user-1',
    );
    expect(screen.getByTestId('notification-bell-probe').getAttribute('data-enabled')).toBe(
      'false',
    );
    expect(bellState.lastProps).toMatchObject({ userId: 'worker-user-1', enabled: false });
  });
});

describe('Shared runtime language switching in AppLayout', () => {
  it('preserves role-filtered navigation, collapsed rail state, and current route semantics across EN/VI language switches', async () => {
    const user = userEvent.setup();
    profileState.data = {
      id: 'contractor-manager-1',
      username: 'contractor.manager',
      mustChangePassword: false,
      roleAssignments: [
        { role: 'SITE_MANAGER', siteId: 'site-a' },
        { role: 'CONTRACTOR_REPRESENTATIVE', siteId: 'site-a' },
      ],
    };

    render(
      <MemoryRouter initialEntries={['/ppe']}>
        <AppLayout>
          <h1>Operations view</h1>
        </AppLayout>
      </MemoryRouter>,
    );

    const enNav = within(screen.getByRole('navigation', { name: 'Main navigation' }));
    expect(enNav.getByRole('button', { name: 'Worker teams' })).toBeDefined();
    expect(enNav.getByRole('button', { name: 'Schedule Setup' })).toBeDefined();
    expect(enNav.getByRole('button', { name: 'Worker profiles & accounts' })).toBeDefined();
    expect(enNav.getByRole('button', { name: 'Site Setup' })).toBeDefined();
    expect(enNav.getByRole('button', { name: 'Workforce' })).toBeDefined();
    expect(enNav.getByRole('button', { name: 'Site Access' })).toBeDefined();
    expect(screen.getByText('Site Manager')).toBeDefined();

    // Collapse the navigation rail before switching language
    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeDefined();

    // Switch to Vietnamese via the rendered LanguageSwitcher
    await user.click(screen.getByRole('button', { name: 'Choose language' }));
    await user.click(screen.getByRole('button', { name: /Tiếng Việt/i }));

    const viNav = within(screen.getByRole('navigation', { name: 'Điều hướng chính' }));
    expect(viNav.getByRole('button', { name: 'Nhóm công nhân' })).toBeDefined();
    expect(viNav.getByRole('button', { name: 'Thiết lập lịch' })).toBeDefined();
    expect(viNav.getByRole('button', { name: 'Hồ sơ & tài khoản công nhân' })).toBeDefined();
    expect(viNav.getByRole('button', { name: 'Thiết lập công trường' })).toBeDefined();
    expect(viNav.getByRole('button', { name: 'Nhân sự' })).toBeDefined();
    expect(viNav.getByRole('button', { name: 'Kiểm soát ra vào' })).toBeDefined();

    // Collapsed rail state, active route semantics, skip link, and role badge update in place
    expect(screen.getByRole('button', { name: 'Mở rộng thanh bên' })).toBeDefined();
    const activeViButton = document.querySelector<HTMLButtonElement>('[aria-current="page"]');
    expect(activeViButton?.getAttribute('aria-label')).toBe('Giám sát bảo hộ');
    expect(activeViButton?.getAttribute('title')).toBe('Giám sát bảo hộ');
    expect(screen.getByRole('link', { name: 'Chuyển đến nội dung chính' })).toBeDefined();
    expect(screen.getByText('Quản lý công trường')).toBeDefined();
    expect(bellState.lastProps).toMatchObject({ userId: 'contractor-manager-1', enabled: true });
  });

  it('keeps profile-error fail-closed state, hides cached profile, and keeps NotificationBell disabled across EN/VI language switches', async () => {
    const user = userEvent.setup();
    profileState.data = createDefaultProfile();
    profileState.isError = true;

    const result = render(
      <MemoryRouter initialEntries={['/ppe']}>
        <AppLayout>
          <h1>Fail-closed language test</h1>
        </AppLayout>
      </MemoryRouter>,
    );

    expect(screen.queryByText('safety-officer')).toBeNull();
    expect(screen.queryByText('Safety Officer')).toBeNull();
    expect(screen.queryByRole('button', { name: 'PPE Monitoring' })).toBeNull();
    expect(screen.getByText('Access not verified')).toBeDefined();
    expect(screen.getByText('Account')).toBeDefined();
    expect(bellState.lastProps).toMatchObject({ userId: '', enabled: false });

    // Switch to Vietnamese while profileState.isError is true and cached data is still present
    await user.click(screen.getByRole('button', { name: 'Choose language' }));
    await user.click(screen.getByRole('button', { name: /Tiếng Việt/i }));

    expect(screen.queryByText('safety-officer')).toBeNull();
    expect(screen.queryByText('Cán bộ an toàn')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Giám sát bảo hộ' })).toBeNull();
    expect(screen.getByText('Chưa xác minh quyền truy cập')).toBeDefined();
    expect(screen.getByText('Tài khoản')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Đăng xuất' })).toBeDefined();
    expect(bellState.lastProps).toMatchObject({ userId: '', enabled: false });

    // Recover profile while in Vietnamese
    profileState.isError = false;
    result.rerender(
      <MemoryRouter initialEntries={['/ppe']}>
        <AppLayout>
          <h1>Fail-closed language test</h1>
        </AppLayout>
      </MemoryRouter>,
    );

    expect(screen.getByText('safety-officer')).toBeDefined();
    expect(screen.getByText('Cán bộ an toàn')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Giám sát bảo hộ' })).toBeDefined();
    expect(bellState.lastProps).toMatchObject({ userId: 'user-safety-1', enabled: true });
  });
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
  profileState.data = {
    ...createDefaultProfile(),
    roleAssignments: [{ role: 'SAFETY_OFFICER', siteId: 'site-alpha' }],
  };
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
