// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError, SmartSiteManagementClient, type AccountResponse } from '@smartsite/api-client';
import { AccountsView } from './AccountsView';
import i18n from '../../i18n';

const admin: AccountResponse = {
  id: 'admin',
  username: 'admin.test',
  displayName: 'Synthetic Admin',
  isActive: true,
  mustChangePassword: false,
  roleAssignments: [{ role: 'ADMIN', siteId: null }],
};
const manager: AccountResponse = {
  id: 'manager',
  username: 'manager.test',
  displayName: 'Synthetic Manager',
  isActive: true,
  mustChangePassword: false,
  roleAssignments: [
    { role: 'SITE_MANAGER', siteId: 'alpha' },
    { role: 'WORKER', siteId: 'beta' },
  ],
};
let actor: AccountResponse | undefined = admin;
let token: string | null = 'synthetic-token';
const logout = vi.fn();
vi.mock('../auth/auth-session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../auth/auth-session')>()),
  useAuth: () => ({ accessToken: token }),
  useCurrentUser: () => ({ data: actor, isPending: false, isError: false }),
  useLogout: () => ({ mutate: logout }),
}));
const clients: QueryClient[] = [];
function mount() {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(cache);
  render(
    <QueryClientProvider client={cache}>
      <AccountsView apiUrl="https://api.example.test" />
    </QueryClientProvider>,
  );
}
beforeEach(async () => {
  actor = admin;
  token = 'synthetic-token';
  logout.mockReset();
  await i18n.changeLanguage('en');
  vi.spyOn(SmartSiteManagementClient.prototype, 'listUsers').mockResolvedValue({
    items: [admin, manager],
    total: 2,
  });
  vi.spyOn(SmartSiteManagementClient.prototype, 'listSites').mockResolvedValue({
    items: [
      { id: 'alpha', name: 'Alpha', code: 'A', createdAt: '' },
      { id: 'beta', name: 'Beta', code: 'B', createdAt: '' },
    ],
    total: 2,
  });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
});

it.each([
  ['signed out', undefined, null],
  ['manager', manager, 'synthetic-token'],
  [
    'site-scoped Admin',
    { ...admin, roleAssignments: [{ role: 'ADMIN', siteId: 'alpha' }] },
    'synthetic-token',
  ],
  ['disabled Admin', { ...admin, isActive: false }, 'synthetic-token'],
  ['temporary Admin', { ...admin, mustChangePassword: true }, 'synthetic-token'],
] as const)('denies %s without requesting account or site data', async (_name, account, value) => {
  actor = account as AccountResponse | undefined;
  token = value;
  mount();
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(SmartSiteManagementClient.prototype.listUsers).not.toHaveBeenCalled();
  expect(SmartSiteManagementClient.prototype.listSites).not.toHaveBeenCalled();
});

it('filters role and site as one assignment and searches across all loaded pages', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.listUsers)
    .mockResolvedValueOnce({ items: [admin], total: 2 })
    .mockResolvedValueOnce({ items: [manager], total: 2 });
  mount();
  const user = userEvent.setup();
  await screen.findByText('Synthetic Manager');
  expect(SmartSiteManagementClient.prototype.listUsers).toHaveBeenNthCalledWith(
    2,
    'synthetic-token',
    { offset: 1, limit: 100 },
  );
  await user.selectOptions(screen.getByLabelText('Role'), 'SITE_MANAGER');
  await user.selectOptions(screen.getByLabelText('Site'), 'beta');
  expect(screen.queryByText('Synthetic Manager')).toBeNull();
  await user.selectOptions(screen.getByLabelText('Site'), 'alpha');
  expect(screen.getByText('Synthetic Manager')).toBeTruthy();
  await user.type(screen.getByLabelText('Search accounts'), 'manager.test');
  expect(screen.getByText('Synthetic Manager')).toBeTruthy();
  expect(screen.queryByText('Synthetic Admin')).toBeNull();
});

it('creates an account with site roles and a global Admin assignment', async () => {
  const create = vi
    .spyOn(SmartSiteManagementClient.prototype, 'createUser')
    .mockResolvedValue(manager);
  mount();
  const user = userEvent.setup();
  await screen.findByText('Synthetic Manager');
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  await user.type(screen.getByLabelText('Username'), 'New.Test');
  await user.type(screen.getByLabelText('Full name'), 'Synthetic New');
  await user.type(screen.getByLabelText('Temporary password'), 'NewPassword1!');
  await user.selectOptions(screen.getByLabelText('Site 1'), 'beta');
  await user.click(screen.getByRole('button', { name: 'Add role' }));
  await user.selectOptions(screen.getByLabelText('Role 2'), 'ADMIN');
  expect((screen.getByLabelText('Site 2') as HTMLSelectElement).disabled).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() =>
    expect(create).toHaveBeenCalledWith('synthetic-token', {
      username: 'new.test',
      displayName: 'Synthetic New',
      temporaryPassword: 'NewPassword1!',
      roleAssignments: [
        { role: 'SITE_MANAGER', siteId: 'beta' },
        { role: 'ADMIN', siteId: null },
      ],
    }),
  );
  await screen.findByText('Account updated successfully.');
});

it('rejects duplicate roles and preserves assignments when editing another site', async () => {
  const replace = vi
    .spyOn(SmartSiteManagementClient.prototype, 'replaceUserRoleAssignments')
    .mockResolvedValue(manager);
  mount();
  const user = userEvent.setup();
  await screen.findByText('Synthetic Manager');
  await user.click(
    within(screen.getByRole('group', { name: 'Actions for manager.test' })).getByRole('button', {
      name: 'Edit roles',
    }),
  );
  await user.click(screen.getByRole('button', { name: 'Add role' }));
  await user.selectOptions(screen.getByLabelText('Site 3'), 'beta');
  await user.click(screen.getByRole('button', { name: 'Confirm' }));
  expect(replace).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('duplicate');
  await user.click(screen.getByRole('button', { name: 'Remove role 3' }));
  await user.selectOptions(screen.getByLabelText('Site 1'), 'beta');
  await user.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() =>
    expect(replace).toHaveBeenCalledWith('synthetic-token', 'manager', [
      { role: 'SITE_MANAGER', siteId: 'beta' },
      { role: 'WORKER', siteId: 'beta' },
    ]),
  );
});

it('requires confirmation before disabling an account and prevents disabling yourself', async () => {
  const setActive = vi
    .spyOn(SmartSiteManagementClient.prototype, 'setUserActive')
    .mockResolvedValue({ ...manager, isActive: false });
  mount();
  const user = userEvent.setup();
  await screen.findByText('Synthetic Manager');
  expect(
    (
      within(screen.getByRole('group', { name: 'Actions for admin.test' })).getByRole('button', {
        name: 'Disable',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  await user.click(
    within(screen.getByRole('group', { name: 'Actions for manager.test' })).getByRole('button', {
      name: 'Disable',
    }),
  );
  expect(setActive).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(setActive).not.toHaveBeenCalled();
  await user.click(
    within(screen.getByRole('group', { name: 'Actions for manager.test' })).getByRole('button', {
      name: 'Disable',
    }),
  );
  await user.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(setActive).toHaveBeenCalledWith('synthetic-token', 'manager', false));
});

it('shows a translated conflict and keeps the form available for correction', async () => {
  vi.spyOn(SmartSiteManagementClient.prototype, 'replaceUserRoleAssignments').mockRejectedValue(
    new ApiError('http', 'Conflict', 409),
  );
  await i18n.changeLanguage('vi');
  mount();
  const user = userEvent.setup();
  await screen.findByText('Synthetic Manager');
  await user.click(
    within(screen.getByRole('group', { name: 'Thao tác với admin.test' })).getByRole('button', {
      name: 'Phân quyền',
    }),
  );
  await user.selectOptions(screen.getByLabelText('Vai trò 1'), 'WORKER');
  await user.selectOptions(screen.getByLabelText('Công trường 1'), 'alpha');
  await user.click(screen.getByRole('button', { name: 'Xác nhận' }));
  expect((await screen.findByRole('alert')).textContent).toBe(
    'Hệ thống phải có ít nhất một tài khoản Admin đang hoạt động.',
  );
  expect(screen.getByLabelText('Vai trò 1')).toBeTruthy();
  expect(logout).not.toHaveBeenCalled();
});

it('resets a password, validates its policy and ends your own session after success', async () => {
  const reset = vi
    .spyOn(SmartSiteManagementClient.prototype, 'resetUserPassword')
    .mockResolvedValue();
  mount();
  const user = userEvent.setup();
  await screen.findByText('Synthetic Admin');
  await user.click(
    within(screen.getByRole('group', { name: 'Actions for admin.test' })).getByRole('button', {
      name: 'Reset password',
    }),
  );
  await user.type(screen.getByLabelText('Temporary password'), 'weakpass');
  await user.click(screen.getByRole('button', { name: 'Confirm' }));
  expect(reset).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toContain('uppercase');
  await user.clear(screen.getByLabelText('Temporary password'));
  await user.type(screen.getByLabelText('Temporary password'), 'StrongPass1!');
  await user.click(screen.getByRole('button', { name: 'Confirm' }));
  await waitFor(() =>
    expect(reset).toHaveBeenCalledWith('synthetic-token', 'admin', 'StrongPass1!'),
  );
  await waitFor(() => expect(logout).toHaveBeenCalledOnce());
});

it('loads and paginates all accounts with status filtering', async () => {
  const accounts = Array.from({ length: 23 }, (_, index) => ({
    ...manager,
    id: `account-${index}`,
    username: `user.${index}`,
    displayName: `Person ${index}`,
    isActive: index !== 22,
  }));
  vi.mocked(SmartSiteManagementClient.prototype.listUsers).mockResolvedValue({
    items: accounts,
    total: accounts.length,
  });
  mount();
  const user = userEvent.setup();
  await screen.findByText('Person 0');
  expect(screen.queryByText('Person 22')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByText('Person 22')).toBeTruthy();
  await user.selectOptions(screen.getByLabelText('Status'), 'inactive');
  expect(screen.getByText('Person 22')).toBeTruthy();
  expect(screen.queryByText('Person 0')).toBeNull();
  expect(screen.getByText('Page 1 of 1')).toBeTruthy();
});

it('blocks role editing when sites are unavailable and supports retrying a failed list', async () => {
  vi.mocked(SmartSiteManagementClient.prototype.listSites).mockRejectedValue(new Error('network'));
  vi.mocked(SmartSiteManagementClient.prototype.listUsers).mockRejectedValueOnce(
    new Error('network'),
  );
  mount();
  const user = userEvent.setup();
  await screen.findAllByRole('alert');
  expect(
    (screen.getByRole('button', { name: 'Create account' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByText('Synthetic Manager');
  expect(
    (
      within(screen.getByRole('group', { name: 'Actions for manager.test' })).getByRole('button', {
        name: 'Edit roles',
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
});
